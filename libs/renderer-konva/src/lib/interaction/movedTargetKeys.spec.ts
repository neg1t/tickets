import { describe, expect, it } from 'vitest';
import { layoutDocumentSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json' with { type: 'json' };
import { movedTargetKeys } from './movedTargetKeys.js';

describe('drag preview membership', () => {
  const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;

  it('moves descendants of a selected zone, including row seats', () => {
    const keys = movedTargetKeys(snapshot, [
      { kind: 'zone', id: 'small-theater-zone-left' },
    ]);
    expect(keys.has('zone:small-theater-zone-left')).toBe(true);
    expect(keys.has('row:small-theater-row-left-1')).toBe(true);
    expect(keys.has('seat:small-theater-seat-left-1-1')).toBe(true);
    expect(keys.has('seat:small-theater-seat-right-1-1')).toBe(false);
  });

  it('represents a parent and an explicitly selected child only once', () => {
    const keys = movedTargetKeys(snapshot, [
      { kind: 'row', id: 'small-theater-row-left-1' },
      { kind: 'seat', id: 'small-theater-seat-left-1-1' },
    ]);
    expect(
      [...keys].filter((key) => key === 'seat:small-theater-seat-left-1-1'),
    ).toHaveLength(1);
  });
});
