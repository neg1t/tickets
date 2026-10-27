import { useEffect, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import type { HallLayoutDraft } from '@hall-platform/hall-editor';
import {
  createRecoveryRepository,
  HallStorageError,
  type HallExportPackage,
  type RecoveryDraft,
} from '@hall-platform/local-storage';
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
  createPerformanceHallFx,
  cancelDemoFx,
  catalogOpened,
  confirmDemoFx,
  exportHallPackageFx,
  demoEventsOpened,
  draftChanged,
  editorOpened,
  holdDemoFx,
  initializeFx,
  newHallRequested,
  openBuyerFx,
  openDemoEventFx,
  requestOpenHall,
  requestCreatePerformanceHall,
  requestImportDraft,
  requestImportHallPackage,
  requestSaveDraft,
  requestPublishDraft,
  recoveryRestored,
  previewOpened,
  publishDraftFx,
  requestDeleteHall,
  requestDuplicateHall,
  requestOpenPublished,
  requestResetDemoData,
  requestRestoreFixtures,
  sampleHallRequested,
  saveDraftFx,
  seatSelectionChanged,
  seedDemoOccurrencesFx,
} from '../model/dashboard.model.js';
import {
  createRecoveryAutosave,
  type RecoveryAutosaveStatus,
} from '../model/recoveryAutosave.js';

const recoveryRepository = createRecoveryRepository();

function downloadDraft(draft: HallLayoutDraft) {
  downloadJson(
    draft,
    `${draft.hallName.trim().replace(/\s+/g, '-').toLowerCase() || 'hall'}.json`,
  );
}

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function DashboardPage() {
  const booted = useRef(false);
  const [autosave] = useState(() => createRecoveryAutosave(recoveryRepository));
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryAutosaveStatus>({
    state: 'idle',
  });
  const [recoveryDrafts, setRecoveryDrafts] = useState<RecoveryDraft[]>([]);
  const [
    draft,
    mode,
    changeCount,
    catalog,
    dirty,
    revision,
    notice,
    error,
    versions,
    publishedDraft,
    ready,
    buyerOccurrence,
    demoEvents,
    activeHoldId,
    receipt,
    bookingError,
    seatSelection,
    savePending,
    publishPending,
    performanceHallPending,
  ] = useUnit([
    $draft,
    $mode,
    $changeCount,
    $catalog,
    $dirty,
    $revision,
    $notice,
    $error,
    $versions,
    $publishedDraft,
    $ready,
    $buyerOccurrence,
    $demoEvents,
    $activeHoldId,
    $receipt,
    $bookingError,
    $seatSelection,
    saveDraftFx.pending,
    publishDraftFx.pending,
    createPerformanceHallFx.pending,
  ]);
  const [
    initialize,
    exportPackage,
    seedDemoOccurrences,
    openBuyer,
    openDemoEvent,
    holdDemo,
    confirmDemo,
    cancelDemo,
  ] = useUnit([
    initializeFx,
    exportHallPackageFx,
    seedDemoOccurrencesFx,
    openBuyerFx,
    openDemoEventFx,
    holdDemoFx,
    confirmDemoFx,
    cancelDemoFx,
  ]);
  const [
    changeDraft,
    openEditor,
    openPreview,
    openCatalog,
    createHall,
    openSample,
    openDemoEvents,
    changeSeatSelection,
  ] = useUnit([
    draftChanged,
    editorOpened,
    previewOpened,
    catalogOpened,
    newHallRequested,
    sampleHallRequested,
    demoEventsOpened,
    seatSelectionChanged,
  ]);
  const restoreRecovery = useUnit(recoveryRestored);

  useEffect(() => autosave.subscribe(setRecoveryStatus), [autosave]);
  useEffect(() => {
    if (dirty) autosave.schedule(draft, revision ?? 0);
    else autosave.cancel();
  }, [autosave, draft, dirty, revision]);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void recoveryRepository
      .list()
      .then((items) => {
        if (live) setRecoveryDrafts(items);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ready, catalog]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void initialize()
      .then(() => seedDemoOccurrences())
      .catch(() => undefined);
  }, [initialize, seedDemoOccurrences]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [mode]);

  const saving = savePending || publishPending;
  const saved = catalog.some((hall) => hall.id === draft.snapshot.id);
  const latestVersion = versions[0];
  const visibleRecoveries = recoveryDrafts.filter((item) => {
    if (dirty && item.hallId === draft.snapshot.id) return false;
    const savedHall = catalog.find((hall) => hall.id === item.hallId);
    return (
      !savedHall ||
      item.baseRevision !== savedHall.revision ||
      item.updatedAt > savedHall.updatedAt
    );
  });

  function canSwitchHall() {
    return (
      !dirty ||
      window.confirm('Есть несохранённые изменения. Продолжить без сохранения?')
    );
  }

  function handleExportPackage() {
    if (!saved || dirty) return;
    void exportPackage(draft.snapshot.id)
      .then((value: HallExportPackage) =>
        downloadJson(
          value,
          `${draft.hallName.trim().replace(/\s+/g, '-').toLowerCase() || 'hall'}-package.json`,
        ),
      )
      .catch(() => undefined);
  }

  function handleImportPackage(file: File) {
    if (!canSwitchHall()) return;
    void requestImportHallPackage(file).catch((error: unknown) => {
      if (
        error instanceof HallStorageError &&
        error.code === 'conflict' &&
        window.confirm(
          'Зал из пакета уже существует. Заменить локальный зал и опубликованные версии?',
        )
      )
        void requestImportHallPackage(file, true).catch(() => undefined);
    });
  }

  async function handleCatalog() {
    if (!canSwitchHall()) return;
    if (dirty) {
      let storedId: string | null = null;
      try {
        storedId = localStorage.getItem('hall-platform-active-hall');
      } catch {
        /* optional */
      }
      if (storedId) await requestOpenHall(storedId).catch(() => undefined);
    }
    openCatalog();
  }

  function handleBuyer() {
    if (!latestVersion) return;
    const version =
      mode === 'published' && publishedDraft
        ? (versions.find(
            (item) => item.snapshotId === publishedDraft.snapshot.id,
          ) ?? latestVersion)
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
        recoveryStatus={recoveryStatus}
        recoveryDrafts={visibleRecoveries}
        error={error}
        hasSavedHall={saved}
        hasPublishedVersion={Boolean(latestVersion)}
        onCreate={() => {
          if (canSwitchHall()) createHall();
        }}
        creatingPerformanceHall={performanceHallPending}
        onCreatePerformanceHall={(seatCount) => {
          if (canSwitchHall())
            void requestCreatePerformanceHall(seatCount).catch(() => undefined);
        }}
        onOpen={(id) => {
          if (canSwitchHall()) void requestOpenHall(id).catch(() => undefined);
        }}
        onEditor={openEditor}
        onPreview={openPreview}
        onBuyer={handleBuyer}
        onEvents={() => {
          openDemoEvents();
          void seedDemoOccurrences().catch(() => undefined);
        }}
        onSample={() => {
          if (canSwitchHall()) openSample();
        }}
        onDuplicate={() => {
          if (canSwitchHall())
            void requestDuplicateHall(draft).catch(() => undefined);
        }}
        onRestore={() => {
          if (
            canSwitchHall() &&
            window.confirm('Восстановить исходные схемы примеров?')
          )
            void requestRestoreFixtures().catch(() => undefined);
        }}
        onReset={() => {
          if (
            window.confirm('Удалить все локальные залы и восстановить примеры?')
          )
            void requestResetDemoData().catch(() => undefined);
        }}
        onDelete={() => {
          if (saved && window.confirm(`Удалить зал «${draft.hallName}»?`))
            void requestDeleteHall(draft.snapshot.id).catch(() => undefined);
        }}
        onExport={() => downloadDraft(draft)}
        onExportPackage={handleExportPackage}
        onImportPackage={handleImportPackage}
        onImport={(file) => {
          if (canSwitchHall())
            void requestImportDraft(file).catch(() => undefined);
        }}
        onRetry={() => {
          void initialize()
            .then(() => seedDemoOccurrences())
            .catch(() => undefined);
        }}
        onRestoreRecovery={(item) => {
          const savedHall = catalog.find((hall) => hall.id === item.hallId);
          if (savedHall && savedHall.revision !== item.baseRevision) return;
          restoreRecovery({
            draft: item.draft,
            baseRevision: item.baseRevision,
          });
          setRecoveryDrafts((items) =>
            items.filter((candidate) => candidate.hallId !== item.hallId),
          );
        }}
        onExportRecovery={(item) => downloadDraft(item.draft)}
        onDiscardRecovery={(item) => {
          void recoveryRepository
            .delete(item.hallId)
            .then(() =>
              setRecoveryDrafts((items) =>
                items.filter((candidate) => candidate.hallId !== item.hallId),
              ),
            )
            .catch(() => undefined);
        }}
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
        recoveryStatus={recoveryStatus}
        error={error}
        saving={saving}
        changeCount={changeCount}
        onCatalog={handleCatalog}
        onEditor={openEditor}
        onPreview={openPreview}
        onBuyer={handleBuyer}
        onExport={() => downloadDraft(draft)}
        onExportPackage={handleExportPackage}
        onSample={() => {
          if (canSwitchHall()) openSample();
        }}
        onDuplicate={() => {
          if (canSwitchHall())
            void requestDuplicateHall(draft).catch(() => undefined);
        }}
        onRestore={() => {
          if (
            canSwitchHall() &&
            window.confirm('Восстановить исходные схемы примеров?')
          )
            void requestRestoreFixtures().catch(() => undefined);
        }}
        onReset={() => {
          if (
            window.confirm('Удалить все локальные залы и восстановить примеры?')
          )
            void requestResetDemoData().catch(() => undefined);
        }}
        onDelete={() => {
          if (saved && window.confirm(`Удалить зал «${draft.hallName}»?`))
            void requestDeleteHall(draft.snapshot.id).catch(() => undefined);
        }}
        hasSavedHall={saved}
        onPublished={(id) => {
          void requestOpenPublished(id).catch(() => undefined);
        }}
        onChange={changeDraft}
        onSave={async (layout) => {
          await autosave.flush().catch(() => undefined);
          await requestSaveDraft(layout, revision);
        }}
        onPublish={async (layout, warningsAcknowledged) => {
          await autosave.flush().catch(() => undefined);
          await requestPublishDraft(layout, revision, warningsAcknowledged);
        }}
      />
    );
  }

  if (mode === 'events') {
    return (
      <main className="studio-events-page">
        <header className="studio-buyer-top">
          <button type="button" onClick={handleCatalog}>
            ‹ Все залы
          </button>
          <span>Hall Studio</span>
        </header>
        <div className="studio-buyer-content">
          <span className="studio-eyebrow">Демо</span>
          <h1>Демо-мероприятия</h1>
          <div className="demo-events" aria-label="Демо-мероприятия">
            {demoEvents.map((event) => (
              <article key={event.id} className="hall-card">
                <h2>{event.title}</h2>
                <p>
                  {new Intl.DateTimeFormat('ru-RU', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(event.startsAt))}
                </p>
                <p>Подтверждено заказов: {event.orders.length}</p>
                <button
                  type="button"
                  className="studio-button"
                  onClick={() =>
                    void openDemoEvent(event.id).catch(() => undefined)
                  }
                >
                  Выбрать билеты
                </button>
              </article>
            ))}
          </div>
        </div>
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
