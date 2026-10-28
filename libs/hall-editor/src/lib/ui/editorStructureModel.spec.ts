import { describe, expect, it } from 'vitest';
import { layoutDocumentSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json' with { type: 'json' };
import {
  expandObjectTargetKeys,
  filterHallSnapshotByTargets,
} from './editorStructureModel.js';

const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;

describe('editor object tree state', () => {
  it('applies a zone visibility or lock state to its rows and seats', () => {
    const zoneId = 'small-theater-zone-left';
    const expanded = expandObjectTargetKeys(
      snapshot,
      new Set([`zone:${zoneId}`]),
    );
    const hiddenSnapshot = filterHallSnapshotByTargets(snapshot, expanded);

    expect(expanded.has(`row:small-theater-row-left-1`)).toBe(true);
    expect(expanded.has(`seat:small-theater-seat-left-1-1`)).toBe(true);
    expect(expanded.has(`seat:small-theater-seat-right-1-1`)).toBe(false);
    expect(hiddenSnapshot.zones.some((zone) => zone.id === zoneId)).toBe(false);
    expect(hiddenSnapshot.seats.some((seat) => seat.zoneId === zoneId)).toBe(
      false,
    );
    expect(hiddenSnapshot.seats.length).toBeLessThan(snapshot.seats.length);
  });

  it('hides only rows and their generated seats for a row target', () => {
    const rowId = 'small-theater-row-left-1';
    const expanded = expandObjectTargetKeys(
      snapshot,
      new Set([`row:${rowId}`]),
    );
    const hiddenSnapshot = filterHallSnapshotByTargets(snapshot, expanded);

    expect(expanded.has(`zone:small-theater-zone-left`)).toBe(false);
    expect(
      snapshot.seats
        .filter(
          (seat) =>
            seat.placement.kind === 'row' && seat.placement.rowId === rowId,
        )
        .every((seat) => !hiddenSnapshot.seats.some(({ id }) => id === seat.id)),
    ).toBe(true);
    expect(hiddenSnapshot.zones).toHaveLength(snapshot.zones.length);
  });
});
