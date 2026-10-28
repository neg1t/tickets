import { useEffect, useMemo, useState } from 'react';
import type { PricingAssignmentDocument } from '@hall-platform/domain';
import { SeatView, type SeatSelectionItem } from '@hall-platform/seat-view';
import { PricingEditor } from '@hall-platform/pricing-editor';
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
  const [document, setDocument] = useState<PricingAssignmentDocument | null>(
    () => props.session?.document ?? null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSelection, setPreviewSelection] = useState<SeatSelectionItem[]>([]);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const session = props.session;
  const dirty = Boolean(session && document && !sameAssignments(document, session.baseline));

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
      updatedAt: Date.now(),
    };
    let live = true;
    void demoBookingRepository.savePricingRecovery(recovery)
      .then(() => { if (live) setRecoveryError(null); })
      .catch((error: unknown) => {
        if (live) setRecoveryError(error instanceof Error ? error.message : String(error));
      });
    return () => { live = false; };
  }, [session, document, dirty]);

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
    if (!session || !document) return { prices: { seats: {} }, error: null as string | null };
    try {
      return {
        prices: buildDemoPricingPrices({
          occurrence: session.occurrence,
          catalog: session.catalog,
          document,
        }),
        error: null,
      };
    } catch (error) {
      return {
        prices: { seats: {} },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [session, document]);

  function canLeave(): boolean {
    return !dirty || window.confirm('Есть несохранённые изменения цен. Продолжить?');
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
          layout={session.occurrence.layout}
          value={document}
          catalog={session.catalog}
          onChange={(next) => setDocument(next)}
          onSave={async (next) => { await props.onSave({ session, document: next }); }}
          saving={props.saving}
          error={null}
          locale="ru-RU"
        />
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
              <SeatView
                layout={session.occurrence.layout}
                occurrenceId={session.occurrence.id}
                availability={getDemoAvailability(session.occurrence)}
                prices={preview.prices}
                selection={previewSelection}
                locale="ru-RU"
                purchaseDisabled
                onSelectionChange={setPreviewSelection}
                onBuyClick={() => undefined}
              />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
