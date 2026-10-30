import type {
  PricingAssignmentDocument,
  PricingCatalog,
} from '@hall-platform/domain';
import { createDraftFromSnapshot } from '@hall-platform/domain';
import type { HallLayoutDraft } from '@hall-platform/hall-editor';
import type { DemoOccurrence } from './demoBooking.js';
import {
  createDemoPricingCatalog,
  createDemoPricingDocument,
  type DemoPricingRecoveryRecord,
} from './demoPricing.js';
import { demoBookingRepository } from './demoBookingRepository.js';

export type DemoPricingSession = Readonly<{
  occurrence: DemoOccurrence;
  catalog: PricingCatalog;
  document: PricingAssignmentDocument;
  baseline: PricingAssignmentDocument;
  restoredRecovery: boolean;
  layoutDraft: HallLayoutDraft;
}>;

export function isDemoPricingRecoveryUsable(input: {
  recovery: DemoPricingRecoveryRecord;
  occurrence: DemoOccurrence;
  catalog: PricingCatalog;
  baseline: PricingAssignmentDocument;
}): boolean {
  const { recovery, occurrence, catalog, baseline } = input;
  return (
    recovery.occurrenceId === occurrence.id &&
    recovery.layoutVersionId === occurrence.layout.snapshot.layoutVersionId &&
    recovery.baseRevision === baseline.revision &&
    recovery.catalogRevision === catalog.revision &&
    recovery.document.occurrenceId === occurrence.id &&
    recovery.document.layoutVersionId === occurrence.layout.snapshot.layoutVersionId &&
    recovery.document.revision === baseline.revision &&
    recovery.document.catalogRevision === catalog.revision &&
    (!recovery.layoutDraft || recovery.layoutDraft.snapshot.layoutVersionId === occurrence.layout.snapshot.layoutVersionId)
  );
}

export async function loadDemoPricingSession(
  occurrenceId: string,
): Promise<DemoPricingSession> {
  const occurrence = await demoBookingRepository.get(occurrenceId);
  if (!occurrence) throw new Error('Демо-мероприятие не найдено');
  const catalog = createDemoPricingCatalog(occurrence);
  const layoutDraftBase = occurrence.editorLayout ?? createDraftFromSnapshot(
    occurrence.layout.hallName,
    occurrence.layout.snapshot,
  );
  const defaultLayoutDraft: HallLayoutDraft = {
    ...layoutDraftBase,
    zoneBounds: occurrence.layout.zoneBounds ?? {},
  };
  const saved = await demoBookingRepository.getPricingAssignments(occurrenceId);
  const baseline = saved?.document ?? createDemoPricingDocument(occurrence, catalog);
  if (
    baseline.occurrenceId !== occurrence.id ||
    baseline.layoutVersionId !== occurrence.layout.snapshot.layoutVersionId
  ) throw new Error('Назначения цен относятся к другой версии схемы');

  const recovery = await demoBookingRepository.getPricingRecovery(occurrenceId);
  if (
    recovery &&
    isDemoPricingRecoveryUsable({ recovery, occurrence, catalog, baseline })
  ) {
    return { occurrence, catalog, document: recovery.document, baseline, restoredRecovery: true, layoutDraft: recovery.layoutDraft ?? defaultLayoutDraft };
  }
  if (recovery) await demoBookingRepository.clearPricingRecovery(occurrenceId);
  return { occurrence, catalog, document: baseline, baseline, restoredRecovery: false, layoutDraft: defaultLayoutDraft };
}

export async function saveDemoOccurrenceLayout(input: {
  session: DemoPricingSession;
  layout: HallLayoutDraft;
  document: PricingAssignmentDocument;
}) {
  return demoBookingRepository.saveOccurrenceLayout({
    occurrenceId: input.session.occurrence.id,
    expectedOccurrenceRevision: input.session.occurrence.revision,
    expectedAssignmentRevision: input.session.baseline.revision,
    expectedLayoutVersionId: input.session.occurrence.layout.snapshot.layoutVersionId,
    catalog: input.session.catalog,
    layout: input.layout,
    document: input.document,
  });
}

export async function saveDemoPricingSession(input: {
  session: DemoPricingSession;
  document: PricingAssignmentDocument;
}) {
  const { session, document } = input;
  return demoBookingRepository.savePricingAssignments({
    occurrenceId: session.occurrence.id,
    expectedAssignmentRevision: session.baseline.revision,
    expectedOccurrenceRevision: session.occurrence.revision,
    catalog: session.catalog,
    document,
  });
}
