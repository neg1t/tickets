import { describe, expect, it } from 'vitest';
import { layoutDocumentSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json';
import { createDemoOccurrence } from './demoBooking.js';
import {
  createDemoPricingCatalog,
  createDemoPricingDocument,
  type DemoPricingRecoveryRecord,
} from './demoPricing.js';
import { isDemoPricingRecoveryUsable } from './demoPricingPageModel.js';

describe('demo pricing recovery guard', () => {
  it('restores only when occurrence, layout, catalog and saved baseline still match', () => {
    const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
    const occurrence = createDemoOccurrence('demo-pricing', { hallName: 'Hall', snapshot });
    const catalog = createDemoPricingCatalog(occurrence);
    const baseline = createDemoPricingDocument(occurrence, catalog);
    const recovery: DemoPricingRecoveryRecord = {
      schemaVersion: 1,
      occurrenceId: occurrence.id,
      layoutVersionId: occurrence.layout.snapshot.layoutVersionId,
      baseRevision: baseline.revision,
      catalogRevision: catalog.revision,
      document: { ...baseline, assignments: { seatSegments: { 'seat-1': 'demo:premium' }, gaZoneSegments: {} } },
      updatedAt: 100,
    };

    expect(isDemoPricingRecoveryUsable({ recovery, occurrence, catalog, baseline })).toBe(true);
    expect(isDemoPricingRecoveryUsable({
      recovery: { ...recovery, baseRevision: baseline.revision + 1 },
      occurrence,
      catalog,
      baseline,
    })).toBe(false);
  });
});
