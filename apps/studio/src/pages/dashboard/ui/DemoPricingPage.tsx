import { useEffect, useMemo, useState } from 'react';
import type { PricingAssignmentDocument } from '@hall-platform/domain';
import { HallEditor, type HallLayoutDraft } from '@hall-platform/hall-editor';
import { SeatView, type SeatSelectionItem } from '@hall-platform/seat-view';
import { PricingEditor } from '@hall-platform/pricing-editor';
import { withoutBackgrounds } from '@hall-platform/domain';
import { getDemoAvailability } from '../model/demoBooking.js';
import type { DemoPricingSession } from '../model/demoPricingPageModel.js';
import { buildDemoPricingPrices } from '../model/demoPricing.js';
import { demoBookingRepository } from '../model/demoBookingRepository.js';
import './demo-pricing-page.css';

export type DemoPricingPageProps = Readonly<{
  session: DemoPricingSession | null;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onBuyer: () => void;
  onSave: (input: {
    session: DemoPricingSession;
    document: PricingAssignmentDocument;
  }) => Promise<unknown>;
  onSaveLayout: (input: {
    session: DemoPricingSession;
    layout: HallLayoutDraft;
    document: PricingAssignmentDocument;
  }) => Promise<unknown>;
}>;

function sameAssignments(
  first: PricingAssignmentDocument,
  second: PricingAssignmentDocument,
): boolean {
  const sameMap = (a: Record<string, string>, b: Record<string, string>) =>
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([id, segmentId]) => b[id] === segmentId);
  return (
    first.catalogRevision === second.catalogRevision &&
    sameMap(first.assignments.seatSegments, second.assignments.seatSegments) &&
    sameMap(first.assignments.gaZoneSegments, second.assignments.gaZoneSegments)
  );
}

export function DemoPricingPage(props: DemoPricingPageProps) {
  const session = props.session;
  const sessionKey = session
    ? `${session.occurrence.id}:${session.occurrence.revision}:${session.baseline.revision}`
    : 'loading';
  const [documentState, setDocumentState] = useState({
    key: sessionKey,
    value: session?.document ?? null,
  });
  const [layoutDraftState, setLayoutDraftState] = useState({
    key: sessionKey,
    value: session?.layoutDraft ?? null,
  });
  const [layoutDirtyState, setLayoutDirtyState] = useState({ key: sessionKey, value: false });
  const [previewSelectionState, setPreviewSelectionState] = useState<{
    key: string;
    value: SeatSelectionItem[];
  }>({ key: sessionKey, value: [] });
  const document = documentState.key === sessionKey ? documentState.value : session?.document ?? null;
  const layoutDraft = layoutDraftState.key === sessionKey ? layoutDraftState.value : session?.layoutDraft ?? null;
  const layoutDirty = layoutDirtyState.key === sessionKey && layoutDirtyState.value;
  const previewSelection = previewSelectionState.key === sessionKey ? previewSelectionState.value : [];
  const setDocument = (value: PricingAssignmentDocument) => setDocumentState({ key: sessionKey, value });
  const setLayoutDraft = (value: HallLayoutDraft) => setLayoutDraftState({ key: sessionKey, value });
  const setLayoutDirty = (value: boolean) => setLayoutDirtyState({ key: sessionKey, value });
  const setPreviewSelection = (value: SeatSelectionItem[]) => setPreviewSelectionState({ key: sessionKey, value });
  const [layoutEditorState, setLayoutEditorState] = useState({
    key: sessionKey,
    open: false,
    mounted: false,
  });
  const currentLayoutEditorState = layoutEditorState.key === sessionKey
    ? layoutEditorState
    : { key: sessionKey, open: false, mounted: false };
  const layoutEditorOpen = currentLayoutEditorState.open;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const dirty = Boolean(session && document && (!sameAssignments(document, session.baseline) || layoutDirty));

  useEffect(() => {
    if (!session || !document || !dirty) {
      if (session) void demoBookingRepository.clearPricingRecovery(session.occurrence.id).catch(() => undefined);
      return;
    }
    const recovery = {
      schemaVersion: 1 as const,
      occurrenceId: session.occurrence.id,
      layoutVersionId: session.occurrence.layout.snapshot.layoutVersionId,
      baseRevision: session.baseline.revision,
      catalogRevision: document.catalogRevision,
      document,
      ...(layoutDirty && layoutDraft ? { layoutDraft } : {}),
      updatedAt: Date.now(),
    };
    let live = true;
    void demoBookingRepository.savePricingRecovery(recovery)
      .then(() => { if (live) setRecoveryError(null); })
      .catch((error: unknown) => {
        if (live) setRecoveryError(error instanceof Error ? error.message : String(error));
      });
    return () => { live = false; };
  }, [session, document, dirty, layoutDraft, layoutDirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const preview = useMemo(() => {
    if (!session || !document || !layoutDraft)
      return { occurrence: null, prices: { seats: {} }, error: null as string | null };
    try {
      const snapshot = withoutBackgrounds(layoutDraft.snapshot);
      const occurrence = {
        ...session.occurrence,
        layout: {
          hallName: layoutDraft.hallName,
          snapshot,
          ...(Object.keys(layoutDraft.zoneBounds).length > 0
            ? { zoneBounds: layoutDraft.zoneBounds }
            : {}),
        },
        initialSeats: Object.fromEntries(
          snapshot.seats.map((seat) => [seat.id, session.occurrence.initialSeats[seat.id] ?? 'available']),
        ),
        zoneCapacity: Object.fromEntries(
          snapshot.zones
            .filter((zone) => zone.kind === 'ga')
            .map((zone) => [zone.id, zone.capacity ?? session.occurrence.zoneCapacity[zone.id] ?? 20]),
        ),
      };
      return {
        occurrence,
        prices: buildDemoPricingPrices({
          occurrence,
          catalog: session.catalog,
          document,
        }),
        error: null,
      };
    } catch (error) {
      return {
        occurrence: null,
        prices: { seats: {} },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [session, document, layoutDraft]);

  function canLeave(): boolean {
    return !dirty || window.confirm('Есть несохранённые изменения схемы или цен. Продолжить?');
  }

  if (!session || !document) {
    return (
      <main className="studio-demo-pricing-page">
        <header className="studio-demo-pricing-top">
          <button type="button" onClick={props.onBack}>‹ Демо-мероприятия</button>
          <span>Hall Studio</span>
        </header>
        <div className="studio-demo-pricing-content">
          <p role={props.error ? 'alert' : 'status'}>{props.error ?? 'Загрузка назначения цен…'}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="studio-demo-pricing-page">
      <header className="studio-demo-pricing-top">
        <button type="button" onClick={() => { if (canLeave()) props.onBack(); }}>‹ Демо-мероприятия</button>
        <span>Hall Studio</span>
        <button type="button" disabled={props.saving} onClick={() => { if (canLeave()) props.onBuyer(); }}>Покупательская схема</button>
      </header>
      <div className="studio-demo-pricing-content">
        <span className="studio-eyebrow">Демо-мероприятие</span>
        <h1>Настройка цен · {session.occurrence.title}</h1>
        <p className="studio-demo-pricing-help">
          Каталог демонстрационный и доступен только для чтения. До первого сохранения покупательская схема продолжает использовать прежние демо-цены.
        </p>
        {session.restoredRecovery && <p role="status" className="studio-demo-pricing-notice">Восстановлен черновик цен для текущей версии схемы и базовой ревизии.</p>}
        {recoveryError && <p role="alert" className="studio-demo-pricing-notice is-error">Не удалось сохранить копию черновика: {recoveryError}</p>}
        {props.error && <p role="alert" className="studio-demo-pricing-notice is-error">{props.error}</p>}
        <PricingEditor
          layout={{
            hallName: layoutDraft?.hallName ?? session.occurrence.layout.hallName,
            snapshot: layoutDraft?.snapshot ?? session.occurrence.layout.snapshot,
            ...((layoutDraft?.zoneBounds ?? session.occurrence.layout.zoneBounds)
              ? { zoneBounds: layoutDraft?.zoneBounds ?? session.occurrence.layout.zoneBounds }
              : {}),
          }}
          value={document}
          catalog={session.catalog}
          onChange={(next) => setDocument(next)}
          onSave={async (next) => {
            if (layoutDirty) throw new Error('Сохраните схему мероприятия вместе с назначениями цен.');
            await props.onSave({ session, document: next });
          }}
          saving={props.saving}
          error={null}
          locale="ru-RU"
        />
        <section className="studio-demo-preview" aria-labelledby="demo-layout-editor-heading">
          <div className="studio-demo-preview-heading">
            <div>
              <h2 id="demo-layout-editor-heading">Схема мероприятия</h2>
              <p>Изменения относятся только к этому мероприятию.</p>
            </div>
            <button type="button" aria-expanded={layoutEditorOpen} onClick={() => setLayoutEditorState({
              key: sessionKey,
              open: !layoutEditorOpen,
              mounted: true,
            })}>
              {layoutEditorOpen ? 'Скрыть редактор' : 'Редактировать схему мероприятия'}
            </button>
          </div>
          {currentLayoutEditorState.mounted && layoutDraft && (
            <div
              className="studio-demo-layout-editor-shell"
              data-open={layoutEditorOpen}
              aria-hidden={!layoutEditorOpen}
            >
            <HallEditor
              value={layoutDraft}
              onChange={(next) => { setLayoutDraft(next); setLayoutDirty(true); }}
              locale="ru-RU"
              onSave={async (next) => {
                await props.onSaveLayout({ session, layout: next, document });
                setLayoutDirty(false);
              }}
              onError={(cause) => setRecoveryError(cause.message)}
            />
            </div>
          )}
        </section>
        <section className="studio-demo-preview" aria-labelledby="demo-pricing-preview-heading">
          <div className="studio-demo-preview-heading">
            <div>
              <h2 id="demo-pricing-preview-heading">Предпросмотр покупателя</h2>
              <p>Предпросмотр использует текущий черновик. Создание удержаний и заказов отключено.</p>
            </div>
            <button type="button" aria-expanded={previewOpen} onClick={() => setPreviewOpen((open) => !open)}>
              {previewOpen ? 'Скрыть' : 'Открыть'}
            </button>
          </div>
          {previewOpen && (
            <>
              {preview.error && <p role="alert" className="studio-demo-pricing-notice is-error">{preview.error}</p>}
              {preview.occurrence && (
                <SeatView
                  layout={preview.occurrence.layout}
                  occurrenceId={session.occurrence.id}
                  availability={getDemoAvailability(preview.occurrence)}
                  prices={preview.prices}
                  selection={previewSelection.filter((item) =>
                    item.kind === 'seat'
                      ? preview.occurrence?.layout.snapshot.seats.some((seat) => seat.id === item.seatId)
                      : preview.occurrence?.layout.snapshot.zones.some((zone) => zone.id === item.zoneId && zone.kind === 'ga'),
                  )}
                  locale="ru-RU"
                  purchaseDisabled
                  onSelectionChange={setPreviewSelection}
                  onBuyClick={() => undefined}
                />
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
