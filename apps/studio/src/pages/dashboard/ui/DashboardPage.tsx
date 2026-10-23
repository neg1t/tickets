import { useEffect, useRef } from 'react';
import { useUnit } from 'effector-react';
import type { HallLayoutDraft } from '@hall-platform/hall-editor';
import { CatalogPage } from '../../catalog/ui/CatalogPage.js';
import { EditorPage } from '../../editor/ui/EditorPage.js';
import { BuyerPage } from './BuyerPage.js';
import {
  $activeHoldId,
  $bookingError,
  $buyerOccurrence,
  $catalog,
  $changeCount,
  $demoEvents,
  $dirty,
  $draft,
  $error,
  $mode,
  $notice,
  $publishedDraft,
  $ready,
  $receipt,
  $revision,
  $seatSelection,
  $versions,
  cancelDemoFx,
  catalogOpened,
  confirmDemoFx,
  deleteHallFx,
  demoEventsOpened,
  draftChanged,
  duplicateHallFx,
  editorOpened,
  holdDemoFx,
  importDraftFx,
  initializeFx,
  newHallRequested,
  openBuyerFx,
  openDemoEventFx,
  openHallFx,
  openPublishedFx,
  previewOpened,
  publishDraftFx,
  resetDemoDataFx,
  restoreFixturesFx,
  sampleHallRequested,
  saveDraftFx,
  seatSelectionChanged,
  seedDemoOccurrencesFx,
} from '../model/dashboard.model.js';

function downloadDraft(draft: HallLayoutDraft) {
  const blob = new Blob([JSON.stringify(draft, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${draft.hallName.trim().replace(/\s+/g, '-').toLowerCase() || 'hall'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function DashboardPage() {
  const booted = useRef(false);
  const [
    draft, mode, changeCount, catalog, dirty, revision, notice, error, versions,
    publishedDraft, ready, buyerOccurrence, demoEvents, activeHoldId, receipt,
    bookingError, seatSelection, savePending, publishPending,
  ] = useUnit([
    $draft, $mode, $changeCount, $catalog, $dirty, $revision, $notice, $error,
    $versions, $publishedDraft, $ready, $buyerOccurrence, $demoEvents,
    $activeHoldId, $receipt, $bookingError, $seatSelection,
    saveDraftFx.pending, publishDraftFx.pending,
  ]);
  const [
    importDraft, initialize, saveDraft, publishDraft, duplicateHall, openHall,
    deleteHall, restoreFixtures, resetDemoData, openPublished,
    seedDemoOccurrences, openBuyer, openDemoEvent, holdDemo, confirmDemo,
    cancelDemo,
  ] = useUnit([
    importDraftFx, initializeFx, saveDraftFx, publishDraftFx, duplicateHallFx,
    openHallFx, deleteHallFx, restoreFixturesFx, resetDemoDataFx,
    openPublishedFx, seedDemoOccurrencesFx, openBuyerFx, openDemoEventFx,
    holdDemoFx, confirmDemoFx, cancelDemoFx,
  ]);
  const [
    changeDraft, openEditor, openPreview, openCatalog, createHall, openSample,
    openDemoEvents, changeSeatSelection,
  ] = useUnit([
    draftChanged, editorOpened, previewOpened, catalogOpened, newHallRequested,
    sampleHallRequested, demoEventsOpened, seatSelectionChanged,
  ]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void initialize().then(() => seedDemoOccurrences()).catch(() => undefined);
  }, [initialize, seedDemoOccurrences]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [mode]);

  const saving = savePending || publishPending;
  const saved = catalog.some((hall) => hall.id === draft.snapshot.id);
  const latestVersion = versions[0];

  function canSwitchHall() {
    return !dirty || window.confirm('Есть несохранённые изменения. Продолжить без сохранения?');
  }

  async function handleCatalog() {
    if (!canSwitchHall()) return;
    if (dirty) {
      const storedId = localStorage.getItem('hall-platform-active-hall');
      if (storedId) await openHall(storedId).catch(() => undefined);
    }
    openCatalog();
  }

  function handleBuyer() {
    if (!latestVersion) return;
    const version = mode === 'published' && publishedDraft
      ? versions.find((item) => item.layout.snapshot.id === publishedDraft.snapshot.id) ?? latestVersion
      : latestVersion;
    void openBuyer(version).catch(() => undefined);
  }

  if (mode === 'catalog') {
    return (
      <CatalogPage
        catalog={catalog}
        currentHallName={draft.hallName}
        dirty={dirty}
        ready={ready}
        saving={saving}
        notice={notice}
        error={error}
        hasSavedHall={saved}
        hasPublishedVersion={Boolean(latestVersion)}
        onCreate={() => { if (canSwitchHall()) createHall(); }}
        onOpen={(id) => { if (canSwitchHall()) void openHall(id).catch(() => undefined); }}
        onEditor={openEditor}
        onPreview={openPreview}
        onBuyer={handleBuyer}
        onEvents={() => { openDemoEvents(); void seedDemoOccurrences().catch(() => undefined); }}
        onSample={() => { if (canSwitchHall()) openSample(); }}
        onDuplicate={() => { if (canSwitchHall()) void duplicateHall(draft).catch(() => undefined); }}
        onRestore={() => { if (canSwitchHall() && window.confirm('Восстановить исходные схемы примеров?')) void restoreFixtures().catch(() => undefined); }}
        onReset={() => { if (window.confirm('Удалить все локальные залы и восстановить примеры?')) void resetDemoData().catch(() => undefined); }}
        onDelete={() => { if (saved && window.confirm(`Удалить зал «${draft.hallName}»?`)) void deleteHall(draft.snapshot.id).catch(() => undefined); }}
        onExport={() => downloadDraft(draft)}
        onImport={(file) => { if (canSwitchHall()) void importDraft(file).catch(() => undefined); }}
      />
    );
  }

  if (mode === 'editor' || mode === 'preview' || mode === 'published') {
    return (
      <EditorPage
        draft={draft}
        mode={mode}
        publishedDraft={publishedDraft}
        versions={versions}
        dirty={dirty}
        notice={notice}
        error={error}
        saving={saving}
        changeCount={changeCount}
        onCatalog={handleCatalog}
        onEditor={openEditor}
        onPreview={openPreview}
        onBuyer={handleBuyer}
        onExport={() => downloadDraft(draft)}
        onSample={() => { if (canSwitchHall()) openSample(); }}
        onDuplicate={() => { if (canSwitchHall()) void duplicateHall(draft).catch(() => undefined); }}
        onRestore={() => { if (canSwitchHall() && window.confirm('Восстановить исходные схемы примеров?')) void restoreFixtures().catch(() => undefined); }}
        onReset={() => { if (window.confirm('Удалить все локальные залы и восстановить примеры?')) void resetDemoData().catch(() => undefined); }}
        onDelete={() => { if (saved && window.confirm(`Удалить зал «${draft.hallName}»?`)) void deleteHall(draft.snapshot.id).catch(() => undefined); }}
        hasSavedHall={saved}
        onPublished={(id) => { void openPublished(id).catch(() => undefined); }}
        onChange={changeDraft}
        onSave={async (layout) => { await saveDraft({ draft: layout, revision }); }}
        onPublish={async (layout, warningsAcknowledged) => { await publishDraft({ draft: layout, revision, warningsAcknowledged }); }}
      />
    );
  }

  if (mode === 'events') {
    return (
      <main className="studio-events-page">
        <header className="studio-buyer-top"><button type="button" onClick={handleCatalog}>‹ Все залы</button><span>Hall Studio</span></header>
        <div className="studio-buyer-content"><span className="studio-eyebrow">Демо</span><h1>Демо-мероприятия</h1><div className="demo-events" aria-label="Демо-мероприятия">
          {demoEvents.map((event) => <article key={event.id} className="hall-card"><h2>{event.title}</h2><p>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.startsAt))}</p><p>Подтверждено заказов: {event.orders.length}</p><button type="button" className="studio-button" onClick={() => void openDemoEvent(event.id).catch(() => undefined)}>Выбрать билеты</button></article>)}
        </div></div>
      </main>
    );
  }

  return (
    <BuyerPage
      occurrence={buyerOccurrence}
      activeHoldId={activeHoldId}
      receipt={receipt}
      error={bookingError}
      selection={seatSelection}
      onBack={handleCatalog}
      onSelectionChange={changeSeatSelection}
      onHold={(id, selection) => holdDemo({ id, selection })}
      onConfirm={(id, holdId) => confirmDemo({ id, holdId })}
      onCancel={(id, holdId) => cancelDemo({ id, holdId })}
      onReopen={(id) => openDemoEvent(id)}
    />
  );
}
