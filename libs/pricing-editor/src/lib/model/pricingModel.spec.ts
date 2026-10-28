import { describe, expect, it } from 'vitest';
import type {
  PricingAssignmentDocument,
  PricingCatalog,
} from '@hall-platform/domain';
import type { HallTarget } from '@hall-platform/renderer-core';
import { createPricingModel } from './pricingModel.js';

const catalog: PricingCatalog = {
  occurrenceId: 'occ-1',
  revision: 2,
  items: [
    {
      id: 'standard',
      name: 'Standard',
      color: '#336699',
      status: 'active',
      price: { amountMinor: 1000, currency: 'RUB' },
    },
  ],
};

const document: PricingAssignmentDocument = {
  schemaVersion: 1,
  occurrenceId: 'occ-1',
  layoutVersionId: 'version-1',
  revision: 1,
  catalogRevision: 2,
  assignments: { seatSegments: {}, gaZoneSegments: {} },
};

const targets = {
  seatIds: ['seat-1'],
  gaZoneIds: [],
  overlaps: [],
  diagnostics: [],
};

describe('pricing editor model', () => {
  it('keeps each instance selection and command history isolated', () => {
    const first = createPricingModel({ document, catalog });
    const second = createPricingModel({ document, catalog });
    const selection: HallTarget[] = [{ kind: 'seat', id: 'seat-1' }];

    first.selectTargets(selection);
    first.assign('standard', targets, 'assign-1');

    expect(first.$state.getState().selection).toEqual(selection);
    expect(first.$state.getState().history.past).toHaveLength(1);
    expect(second.$state.getState().selection).toEqual([]);
    expect(second.$state.getState().history.past).toEqual([]);
    expect(second.$state.getState().document).toBe(document);
  });

  it('preserves undo when the parent echoes the controlled document', () => {
    const model = createPricingModel({ document, catalog });
    model.assign('standard', targets, 'assign-1');
    const changed = model.$state.getState().document;
    model.receiveControlledValue({ document: { ...changed }, catalog });

    expect(model.$state.getState().history.past).toHaveLength(1);
    expect(model.$state.getState().document.assignments.seatSegments).toEqual({
      'seat-1': 'standard',
    });
  });

  it('resets selection and history when occurrence or layout context changes', () => {
    const model = createPricingModel({ document, catalog });
    model.selectTargets([{ kind: 'seat', id: 'seat-1' }]);
    model.assign('standard', targets, 'assign-1');
    const nextDocument: PricingAssignmentDocument = {
      ...document,
      occurrenceId: 'occ-2',
      layoutVersionId: 'version-2',
    };
    const nextCatalog: PricingCatalog = { ...catalog, occurrenceId: 'occ-2' };

    model.receiveControlledValue({ document: nextDocument, catalog: nextCatalog });

    expect(model.$state.getState().selection).toEqual([]);
    expect(model.$state.getState().history.past).toEqual([]);
    expect(model.$state.getState().baseline).toBe(nextDocument);
  });

  it('locks edits while a save outcome is pending and resets history on success', () => {
    const model = createPricingModel({ document, catalog });
    model.setPendingSave({
      idempotencyKey: 'save-key',
      baseRevision: 1,
      body: {
        layoutVersionId: 'version-1',
        catalogRevision: 2,
        assignments: { seatSegments: {}, gaZoneSegments: {} },
      },
    });
    const before = model.$state.getState().document;
    const blocked = model.assign('standard', targets, 'blocked');

    expect(blocked.changed).toBe(false);
    expect(model.$state.getState().document).toBe(before);
    expect(model.$state.getState().pendingSave?.idempotencyKey).toBe('save-key');

    model.resolvePendingSave();
    const savedDocument = { ...before, revision: 2 };
    model.acceptSavedDocument(savedDocument);
    expect(model.$state.getState().baseline).toBe(savedDocument);
    expect(model.$state.getState().history.past).toEqual([]);
    expect(model.$dirty.getState()).toBe(false);
  });

  it('marks explicitly accepted catalog revisions as an unsaved controlled change', () => {
    const model = createPricingModel({ document, catalog });
    const nextCatalog: PricingCatalog = { ...catalog, revision: 3 };
    model.updateCatalog(nextCatalog);
    model.acceptCatalogRevision();

    expect(model.$state.getState().document.catalogRevision).toBe(3);
    expect(model.$state.getState().baseline.catalogRevision).toBe(2);
    expect(model.$dirty.getState()).toBe(true);
  });
});
