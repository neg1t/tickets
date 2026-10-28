import { describe, expect, it } from 'vitest';
import { createEmptyDraft } from '@hall-platform/domain';
import { mapBuyerOccurrence, minorToMajor } from './mapping.js';

describe('API to component mapping', () => {
  it('converts exact minor units using the currency fraction digits', () => {
    expect(minorToMajor({ amountMinor: 12345, currency: 'RUB' })).toBe(123.45);
    expect(minorToMajor({ amountMinor: 12345, currency: 'JPY' })).toBe(12345);
  });

  it('passes only server-provided availability and prices to the buyer', () => {
    const draft = createEmptyDraft('API hall');
    const mapped = mapBuyerOccurrence({
      apiVersion: 'v1', id: 'occurrence-a', title: 'Concert',
      startsAt: '2026-10-26T01:00:00Z', layoutVersionId: 'version-a',
      layout: { hallName: draft.hallName, snapshot: draft.snapshot, zoneBounds: {} },
      availability: { apiVersion: 'v1', revision: 4, seats: { 'seat-a': 'available' }, zones: {} },
      prices: { apiVersion: 'v1', seats: { 'seat-a': { amountMinor: 12345, currency: 'RUB' } }, zones: {} },
      ownHold: null,
    });
    expect(mapped.availability.seats['seat-a']).toBe('available');
    expect(mapped.prices.seats['seat-a']).toEqual({ amount: 123.45, currency: 'RUB' });
    expect(mapped.availabilityRevision).toBe(4);
  });

  it('maps categorized API prices without passing the extra field to the money validator', () => {
    const draft = createEmptyDraft('API hall');
    const mapped = mapBuyerOccurrence({
      apiVersion: 'v1', id: 'occurrence-a', title: 'Concert',
      startsAt: '2026-10-26T01:00:00Z', layoutVersionId: draft.snapshot.layoutVersionId,
      layout: { hallName: draft.hallName, snapshot: draft.snapshot },
      availability: { apiVersion: 'v1', revision: 1, seats: { 'seat-a': 'available' }, zones: {} },
      prices: { apiVersion: 'v1', seats: { 'seat-a': { amountMinor: 12345, currency: 'RUB', category: 'VIP' } }, zones: {} },
      ownHold: null,
    });
    expect(mapped.prices.seats['seat-a']).toEqual({ amount: 123.45, currency: 'RUB', category: 'VIP' });
  });
});
