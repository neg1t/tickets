import { describe, expect, it } from 'vitest';
import type {
  PricingAssignmentDocument,
  PricingCatalog,
} from '@hall-platform/domain';
import {
  executePricingCommand,
  initialPricingHistory,
  pushPricingHistory,
  redoPricingCommand,
  undoPricingCommand,
} from './pricingCommands.js';

const catalog: PricingCatalog = {
  occurrenceId: 'occ-1',
  revision: 1,
  items: [
    {
      id: 'standard',
      name: 'Standard',
      color: '#336699',
      status: 'active',
      price: { amountMinor: 1000, currency: 'RUB' },
    },
    {
      id: 'vip',
      name: 'VIP',
      color: '#663399',
      status: 'active',
      price: { amountMinor: 2000, currency: 'RUB' },
    },
    {
      id: 'economy',
      name: 'Economy',
      color: '#339966',
      status: 'active',
      price: { amountMinor: 500, currency: 'RUB' },
    },
    {
      id: 'archived',
      name: 'Archived',
      color: '#999999',
      status: 'archived',
      price: { amountMinor: 0, currency: 'RUB' },
    },
  ],
};

const document: PricingAssignmentDocument = {
  schemaVersion: 1,
  occurrenceId: 'occ-1',
  layoutVersionId: 'version-1',
  revision: 3,
  catalogRevision: 1,
  assignments: {
    seatSegments: {
      'seat-1': 'standard',
      'seat-2': 'vip',
      'seat-3': 'economy',
    },
    gaZoneSegments: { 'zone-ga': 'standard' },
  },
};

const context = {
  occurrenceId: 'occ-1',
  layoutVersionId: 'version-1',
  catalog,
};

const seats = (seatIds: string[]) => ({
  seatIds,
  gaZoneIds: [] as string[],
  overlaps: [],
  diagnostics: [],
});

describe('pricing assignment commands', () => {
  it('replaces every seat assignment in one zone command and undo restores manual overrides', () => {
    const first = executePricingCommand(document, {
      type: 'assign',
      segmentId: 'standard',
      targets: seats(['seat-1', 'seat-2', 'seat-3']),
      context,
      commandId: 'zone-standard',
    });
    const second = executePricingCommand(first.document, {
      type: 'assign',
      segmentId: 'vip',
      targets: seats(['seat-2']),
      context,
      commandId: 'manual-vip',
    });
    const third = executePricingCommand(second.document, {
      type: 'assign',
      segmentId: 'economy',
      targets: seats(['seat-1', 'seat-2', 'seat-3']),
      context,
      commandId: 'zone-economy',
    });
    let history = initialPricingHistory;
    history = pushPricingHistory(history, first.command!);
    history = pushPricingHistory(history, second.command!);
    history = pushPricingHistory(history, third.command!);
    const undone = undoPricingCommand(third.document, history);

    expect(undone.document.assignments.seatSegments).toEqual({
      'seat-1': 'standard',
      'seat-2': 'vip',
      'seat-3': 'standard',
    });
    expect(undone.history.past).toHaveLength(2);
    expect(undone.history.future.map(({ id }) => id)).toEqual(['zone-economy']);
  });

  it('treats repeated assignments as no-op without dirty or history changes', () => {
    const result = executePricingCommand(document, {
      type: 'assign',
      segmentId: 'vip',
      targets: seats(['seat-2']),
      context,
      commandId: 'noop',
    });

    expect(result.changed).toBe(false);
    expect(result.command).toBeUndefined();
    expect(result.document).toBe(document);
  });

  it('blocks archived segments, invalid target diagnostics, and mismatched contexts atomically', () => {
    const archived = executePricingCommand(document, {
      type: 'assign',
      segmentId: 'archived',
      targets: seats(['seat-1']),
      context,
      commandId: 'archived',
    });
    const invalid = executePricingCommand(document, {
      type: 'assign',
      segmentId: 'vip',
      targets: {
        ...seats(['seat-1']),
        diagnostics: [
          {
            severity: 'error' as const,
            code: 'invalid_zone_polygon' as const,
            targetId: 'zone-1',
            message: 'Invalid polygon',
          },
        ],
      },
      context,
      commandId: 'invalid',
    });
    const mismatch = executePricingCommand(document, {
      type: 'assign',
      segmentId: 'vip',
      targets: seats(['seat-1']),
      context: { ...context, occurrenceId: 'occ-2' },
      commandId: 'mismatch',
    });

    expect(archived.document).toBe(document);
    expect(archived.error?.code).toBe('segment_not_active');
    expect(invalid.document).toBe(document);
    expect(invalid.error?.code).toBe('invalid_targets');
    expect(mismatch.document).toBe(document);
    expect(mismatch.error?.code).toBe('context_mismatch');
  });

  it('blocks assignments from a mixed-currency catalog while allowing repair clears', () => {
    const mixedCatalog: PricingCatalog = {
      ...catalog,
      items: catalog.items.map((segment) =>
        segment.id === 'vip'
          ? { ...segment, price: { ...segment.price, currency: 'USD' } }
          : segment,
      ),
    };
    const mixedContext = { ...context, catalog: mixedCatalog };
    const assign = executePricingCommand(document, {
      type: 'assign',
      segmentId: 'standard',
      targets: seats(['seat-1']),
      context: mixedContext,
      commandId: 'mixed-currency',
    });
    const clear = executePricingCommand(document, {
      type: 'clear',
      targets: seats(['seat-1']),
      context: mixedContext,
      commandId: 'repair-clear',
    });

    expect(assign.document).toBe(document);
    expect(assign.error?.code).toBe('catalog_invalid');
    expect(clear.changed).toBe(true);
    expect(clear.document.assignments.seatSegments['seat-1']).toBeUndefined();
  });

  it('undoes and redoes clears while preserving GA and seat map separation', () => {
    const result = executePricingCommand(document, {
      type: 'clear',
      targets: {
        seatIds: ['seat-2'],
        gaZoneIds: ['zone-ga'],
        overlaps: [],
        diagnostics: [],
      },
      context,
      commandId: 'clear-targets',
    });
    const history = pushPricingHistory(initialPricingHistory, result.command!);
    const undone = undoPricingCommand(result.document, history);
    const redone = redoPricingCommand(undone.document, undone.history);

    expect(undone.document.assignments).toEqual(document.assignments);
    expect(redone.document.assignments).toEqual(result.document.assignments);
  });

  it('keeps the newest command when pruning by command count', () => {
    const first = executePricingCommand(document, {
      type: 'assign',
      segmentId: 'vip',
      targets: seats(['seat-1']),
      context,
      commandId: 'first',
    }).command!;
    const second = executePricingCommand(document, {
      type: 'assign',
      segmentId: 'economy',
      targets: seats(['seat-1']),
      context,
      commandId: 'second',
    }).command!;

    const history = pushPricingHistory(
      pushPricingHistory(initialPricingHistory, first, { maxCommands: 1 }),
      second,
      { maxCommands: 1 },
    );

    expect(history.past.map(({ id }) => id)).toEqual(['second']);
    expect(history.truncated).toBe(true);
  });

  it('prunes older history by byte budget and keeps an oversized latest command undoable', () => {
    const first = executePricingCommand(document, {
      type: 'assign',
      segmentId: 'vip',
      targets: seats(['seat-1']),
      context,
      commandId: 'first-bytes',
    }).command!;
    const second = executePricingCommand(document, {
      type: 'assign',
      segmentId: 'economy',
      targets: seats(['seat-1']),
      context,
      commandId: 'second-bytes',
    }).command!;
    const secondBytes = new TextEncoder().encode(JSON.stringify(second.changes)).byteLength;
    const history = pushPricingHistory(
      pushPricingHistory(initialPricingHistory, first, { maxBytes: secondBytes }),
      second,
      { maxBytes: secondBytes },
    );
    const oversized = pushPricingHistory(initialPricingHistory, second, { maxBytes: 1 });

    expect(history.past.map(({ id }) => id)).toEqual(['second-bytes']);
    expect(history.bytes).toBeLessThanOrEqual(secondBytes);
    expect(history.truncated).toBe(true);
    expect(oversized.past.map(({ id }) => id)).toEqual(['second-bytes']);
    expect(oversized.truncated).toBe(true);
  });
});
