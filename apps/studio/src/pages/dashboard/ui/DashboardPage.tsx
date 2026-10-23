import { useEffect, useRef } from 'react';
import { useUnit } from 'effector-react';
import {
  HallEditor,
  PdfHallViewer,
  type HallLayoutDraft,
} from '@hall-platform/hall-editor';
import { SeatView } from '@hall-platform/seat-view';
import { getDemoAvailability, getDemoTotal } from '../model/demoBooking';
import {
  $changeCount,
  $catalog,
  $buyerOccurrence,
  $demoEvents,
  $activeHoldId,
  $receipt,
  $bookingError,
  $draft,
  $dirty,
  $error,
  $mode,
  $notice,
  $publishedDraft,
  $ready,
  $revision,
  $seatSelection,
  $versions,
  deleteHallFx,
  demoEventsOpened,
  seedDemoOccurrencesFx,
  openBuyerFx,
  openDemoEventFx,
  holdDemoFx,
  confirmDemoFx,
  cancelDemoFx,
  draftChanged,
  duplicateHallFx,
  editorOpened,
  importDraftFx,
  initializeFx,
  newHallRequested,
  openHallFx,
  openPublishedFx,
  previewOpened,
  publishDraftFx,
  resetDemoDataFx,
  restoreFixturesFx,
  sampleHallRequested,
  saveDraftFx,
  seatSelectionChanged,
} from '../model/dashboard.model';

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
  ]);
  const [
    importDraft,
    initialize,
    saveDraft,
    publishDraft,
    duplicateHall,
    openHall,
    deleteHall,
    restoreFixtures,
    resetDemoData,
    openPublished,
    seedDemoOccurrences,
    openBuyer,
    openDemoEvent,
    holdDemo,
    confirmDemo,
    cancelDemo,
  ] = useUnit([
    importDraftFx,
    initializeFx,
    saveDraftFx,
    publishDraftFx,
    duplicateHallFx,
    openHallFx,
    deleteHallFx,
    restoreFixturesFx,
    resetDemoDataFx,
    openPublishedFx,
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
    createHall,
    openSample,
    openDemoEvents,
    changeSeatSelection,
  ] = useUnit([
    draftChanged,
    editorOpened,
    previewOpened,
    newHallRequested,
    sampleHallRequested,
    demoEventsOpened,
    seatSelectionChanged,
  ]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void initialize()
      .then(() => seedDemoOccurrences())
      .catch(() => undefined);
  }, [initialize, seedDemoOccurrences]);

  const saved = catalog.some((hall) => hall.id === draft.snapshot.id);
  const latestVersion = versions[0];
  const saving = savePending || publishPending;

  function canSwitchHall() {
    return (
      !dirty ||
      window.confirm('Есть несохранённые изменения. Продолжить без сохранения?')
    );
  }

  function handleRestoreFixtures() {
    if (!canSwitchHall()) return;
    if (!window.confirm('Восстановить исходные схемы примеров?')) return;
    void restoreFixtures().catch(() => undefined);
  }

  function handleDeleteHall() {
    if (!saved || !window.confirm(`Удалить зал «${draft.hallName}»?`)) return;
    void deleteHall(draft.snapshot.id).catch(() => undefined);
  }

  function handleResetDemoData() {
    if (!window.confirm('Удалить все локальные залы и восстановить примеры?'))
      return;
    void resetDemoData().catch(() => undefined);
  }

  return (
    <main>
      <header>
        <p>Hall Platform</p>

        <h1>Hall Studio</h1>

        <p>Создание и управление схемами залов</p>
      </header>

      <section aria-labelledby="halls-title">
        <h2 id="halls-title">Мои залы</h2>

        <p>Текущий зал: {draft.hallName}</p>

        <p role="status">{dirty ? 'Есть несохранённые изменения' : notice}</p>

        <div className="dashboard-actions">
          <button
            type="button"
            onClick={() => {
              if (canSwitchHall()) createHall();
            }}
            disabled={!ready || saving}
          >
            Новый зал
          </button>

          <button
            type="button"
            onClick={() => {
              if (canSwitchHall()) openSample();
            }}
            disabled={!ready || saving}
          >
            Открыть тестовый зал
          </button>

          <button type="button" onClick={() => downloadDraft(draft)}>
            Экспорт JSON
          </button>

          <button
            type="button"
            onClick={() => {
              if (!canSwitchHall()) return;
              void duplicateHall(draft).catch(() => undefined);
            }}
            disabled={!ready || saving}
          >
            Создать копию
          </button>

          <button
            type="button"
            onClick={handleRestoreFixtures}
            disabled={!ready || saving}
          >
            Восстановить примеры
          </button>

          <button
            type="button"
            onClick={handleResetDemoData}
            disabled={!ready || saving}
          >
            Сбросить демо-данные
          </button>

          {saved && (
            <button type="button" onClick={handleDeleteHall} disabled={saving}>
              Удалить зал
            </button>
          )}

          <label>
            Открыть JSON
            <input
              aria-label="Открыть JSON"
              type="file"
              accept="application/json,.json"
              disabled={!ready || saving}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file && canSwitchHall())
                  void importDraft(file).catch(() => undefined);
              }}
            />
          </label>

          <button type="button" onClick={openEditor}>
            Редактор
          </button>

          <button type="button" onClick={openPreview}>
            Просмотр
          </button>

          <button
            type="button"
            onClick={() => {
              openDemoEvents();
              void seedDemoOccurrences().catch(() => undefined);
            }}
          >
            Демо-мероприятия
          </button>

          {latestVersion && (
            <button
              type="button"
              onClick={() => {
                const version =
                  mode === 'published' && publishedDraft
                    ? (versions.find(
                        (item) =>
                          item.layout.snapshot.id ===
                          publishedDraft.snapshot.id,
                      ) ?? latestVersion)
                    : latestVersion;
                void openBuyer(version).catch(() => undefined);
              }}
            >
              Покупательская схема
            </button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}

        <div className="hall-catalog" aria-label="Каталог залов">
          {catalog.map((hall) => (
            <article className="hall-card" key={hall.id}>
              <h3>{hall.name}</h3>

              <p>
                {hall.zones} зон · {hall.seats} мест ·{' '}
                {hall.publishedVersionNumber > 0
                  ? `Опубликована версия ${hall.publishedVersionNumber}`
                  : 'Черновик'}
              </p>

              <button
                type="button"
                onClick={() => {
                  if (!canSwitchHall()) return;
                  void openHall(hall.id).catch(() => undefined);
                }}
                disabled={!ready || saving}
              >
                Открыть черновик
              </button>
            </article>
          ))}
        </div>
      </section>
      <section aria-labelledby="stage-title">
        <h2 id="stage-title">
          {mode === 'editor'
            ? 'Редактор зала'
            : mode === 'events'
              ? 'Демо-мероприятия'
              : mode === 'buyer'
                ? 'Покупательская схема'
                : mode === 'published'
                  ? 'Опубликованная схема'
                  : 'Рабочая область зала'}
        </h2>
        {mode === 'published' && publishedDraft && (
          <p>Опубликовано: {publishedDraft.snapshot.seats.length} мест</p>
        )}
        {versions.length > 0 && (
          <div
            className="published-versions"
            aria-label="Опубликованные версии"
          >
            {versions.map((version) => (
              <button
                type="button"
                key={version.versionId}
                onClick={() => {
                  void openPublished(version.versionId).catch(() => undefined);
                }}
              >
                Версия {version.versionNumber}
              </button>
            ))}
          </div>
        )}
        {!ready ? (
          <p role="status">Загрузка локальных залов…</p>
        ) : mode === 'events' ? (
          <div className="demo-events" aria-label="Демо-мероприятия">
            {demoEvents.map((event) => (
              <article key={event.id} className="hall-card">
                <h3>{event.title}</h3>

                <p>
                  {new Intl.DateTimeFormat('ru-RU', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(event.startsAt))}
                </p>

                <p>Подтверждено заказов: {event.orders.length}</p>

                <button
                  type="button"
                  onClick={() =>
                    void openDemoEvent(event.id).catch(() => undefined)
                  }
                >
                  Выбрать билеты
                </button>
              </article>
            ))}
          </div>
        ) : mode === 'buyer' && buyerOccurrence ? (
          <>
            <h3>{buyerOccurrence.title}</h3>

            {bookingError && <p role="alert">{bookingError}</p>}

            {receipt && (
              <div className="demo-checkout" role="status">
                <h3>Покупка подтверждена</h3>

                <p>Заказ № {receipt.id}</p>

                <p>
                  Билетов:{' '}
                  {receipt.selection.reduce(
                    (sum, item) =>
                      sum + (item.kind === 'seat' ? 1 : item.quantity),
                    0,
                  )}
                </p>

                <p>
                  Итого:{' '}
                  {getDemoTotal(
                    buyerOccurrence,
                    receipt.selection,
                  ).toLocaleString('ru-RU')}{' '}
                  ₽
                </p>

                <button
                  type="button"
                  onClick={() =>
                    void openDemoEvent(buyerOccurrence.id).catch(
                      () => undefined,
                    )
                  }
                >
                  Выбрать ещё билеты
                </button>
              </div>
            )}

            {activeHoldId && !receipt && (
              <div className="demo-checkout" aria-label="Оформление заказа">
                <h3>Подтверждение покупки</h3>

                <p>
                  Билеты удерживаются 5 минут. Оплата в демо-режиме не
                  требуется.
                </p>

                <p>
                  Итого:{' '}
                  {getDemoTotal(
                    buyerOccurrence,
                    buyerOccurrence.holds.find(
                      (hold) => hold.id === activeHoldId,
                    )?.selection ?? [],
                  ).toLocaleString('ru-RU')}{' '}
                  ₽
                </p>

                <button
                  type="button"
                  onClick={() =>
                    void confirmDemo({
                      id: buyerOccurrence.id,
                      holdId: activeHoldId,
                    }).catch(() => undefined)
                  }
                >
                  Подтвердить покупку
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void cancelDemo({
                      id: buyerOccurrence.id,
                      holdId: activeHoldId,
                    }).catch(() => undefined)
                  }
                >
                  Отменить
                </button>
              </div>
            )}

            {!activeHoldId && !receipt && (
              <SeatView
                layout={buyerOccurrence.layout}
                occurrenceId={buyerOccurrence.id}
                availability={getDemoAvailability(buyerOccurrence)}
                prices={buyerOccurrence.prices}
                selection={seatSelection}
                onSelectionChange={changeSeatSelection}
                onBuyClick={(data) =>
                  holdDemo({
                    id: data.occurrenceId,
                    selection: [...data.selection],
                  }).then(() => undefined)
                }
              />
            )}
          </>
        ) : mode === 'editor' ? (
          <>
            <p>Изменений через onChange: {changeCount}</p>

            <HallEditor
              value={draft}
              publishedSeatIds={versions.flatMap((version) =>
                version.layout.snapshot.seats.map((seat) => seat.id),
              )}
              onChange={changeDraft}
              saving={saving}
              onSave={async (layout) => {
                await saveDraft({ draft: layout, revision });
              }}
              onPublish={async (layout, warningsAcknowledged) => {
                await publishDraft({
                  draft: layout,
                  revision,
                  warningsAcknowledged,
                });
              }}
            />
          </>
        ) : (
          <PdfHallViewer
            draft={
              mode === 'published' && publishedDraft ? publishedDraft : draft
            }
          />
        )}
      </section>
    </main>
  );
}
