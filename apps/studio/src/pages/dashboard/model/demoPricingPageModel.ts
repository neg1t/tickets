import type {
  PricingAssignmentDocument,
  PricingCatalog,
} from '@hall-platform/domain';
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
    recovery.document.catalogRevision === catalog.revision
  );
}

export async function loadDemoPricingSession(
  occurrenceId: string,
): Promise<DemoPricingSession> {
  const occurrence = await demoBookingRepository.get(occurrenceId);
  if (!occurrence) throw new Error('Демо-мероприятие не найдено');
  const catalog = createDemoPricingCatalog(occurrence);
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
    return { occurrence, catalog, document: recovery.document, baseline, restoredRecovery: true };
  }
  if (recovery) await demoBookingRepository.clearPricingRecovery(occurrenceId);
  return { occurrence, catalog, document: baseline, baseline, restoredRecovery: false };
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
