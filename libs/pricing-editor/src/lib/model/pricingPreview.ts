import {
  pricingMoneyToMajor,
  validatePricingAssignments,
  type LayoutSnapshot,
  type PricingAssignmentDocument,
  type PricingCatalog,
} from '@hall-platform/domain';
import type { SpatialBounds } from '@hall-platform/geometry';
import { createPricingTargetResolver } from './resolvePricingTargets.js';

export type PricingPreviewPrice = Readonly<{
  amount: number;
  currency: string;
  category: string;
}>;

export type PricingPreviewPriceMap = Readonly<{
  seats: Readonly<Record<string, PricingPreviewPrice>>;
  zones: Readonly<Record<string, PricingPreviewPrice>>;
}>;

/** Build buyer-facing prices only from a validated draft; this never persists or books. */
export function createPricingPreviewPriceMap(input: {
  snapshot: LayoutSnapshot;
  catalog: PricingCatalog;
  document: PricingAssignmentDocument;
  zoneBounds?: Readonly<Record<string, SpatialBounds>>;
}): PricingPreviewPriceMap {
  const { snapshot, catalog, document, zoneBounds } = input;
  const issues = validatePricingAssignments(document, {
    occurrenceId: document.occurrenceId,
    layoutVersionId: snapshot.layoutVersionId,
    snapshot,
    catalog,
  });
  if (issues.length > 0) throw new Error(issues[0]?.message ?? 'Pricing assignments are invalid.');

  const resolver = createPricingTargetResolver(snapshot, zoneBounds);
  for (const zoneId of Object.keys(document.assignments.gaZoneSegments)) {
    const issue = resolver.resolveZone(zoneId).diagnostics.find(
      ({ severity }) => severity === 'error',
    );
    if (issue) throw new Error(issue.message);
  }

  const segments = new Map(catalog.items.map((segment) => [segment.id, segment]));
  const pricesFor = (assignments: Readonly<Record<string, string>>) => {
    const prices: Record<string, PricingPreviewPrice> = {};
    for (const [targetId, segmentId] of Object.entries(assignments)) {
      const segment = segments.get(segmentId);
      if (!segment) throw new Error(`Pricing segment ${segmentId} is no longer available.`);
      prices[targetId] = {
        amount: pricingMoneyToMajor(segment.price),
        currency: segment.price.currency,
        category: segment.name,
      };
    }
    return prices;
  };
  return {
    seats: pricesFor(document.assignments.seatSegments),
    zones: pricesFor(document.assignments.gaZoneSegments),
  };
}
