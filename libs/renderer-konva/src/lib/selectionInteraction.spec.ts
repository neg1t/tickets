import { describe, expect, it } from 'vitest';
import { layoutSnapshotSchema } from '@hall-platform/domain';
import type { HallTarget } from '@hall-platform/renderer-core';
import {
  applySelectionOperation,
  type SelectionOperation,
} from '@hall-platform/renderer-core';
import {
  boxSelectedTargetsForSelection,
  clickSelection,
  filterSelectableTargets,
  mergeBoxSelection,
} from './selectionInteraction.js';
import { buildHallScene } from './hallScene.js';

const seat: HallTarget = { kind: 'seat', id: 'seat-1' };
const zone: HallTarget = { kind: 'zone', id: 'zone-1' };
const anotherSeat: HallTarget = { kind: 'seat', id: 'seat-2' };

describe('selection interaction', () => {
  it('filters click, hover, and box targets through the same allowed kinds', () => {
    expect(filterSelectableTargets([seat, zone], ['seat'])).toEqual([seat]);
    expect(filterSelectableTargets([seat, zone], ['zone'])).toEqual([zone]);
    expect(filterSelectableTargets([seat, zone])).toEqual([seat, zone]);
  });

  it.each<SelectionOperation>(['replace', 'add', 'subtract', 'toggle'])(
    'uses the same %s semantics for click and box gestures',
    (operation) => {
      const current = [seat, zone];
      const incoming = [anotherSeat, seat];
      expect(clickSelection(current, seat, operation)).toEqual(
        applySelectionOperation(current, [seat], operation),
      );
      expect(mergeBoxSelection(current, incoming, operation)).toEqual(
        applySelectionOperation(current, incoming, operation),
      );
    },
  );

  it('ignores non-selectable targets before applying an operation', () => {
    expect(clickSelection([seat], zone, 'add', ['seat'])).toEqual([seat]);
  });

  it('selects seats by their centers even when only a symbol edge crosses the box', () => {
    const snapshot = layoutSnapshotSchema.parse({
      id: 'snapshot-1',
      layoutVersionId: 'version-1',
      floors: [
        { id: 'floor-1', layoutVersionId: 'version-1', name: 'Main' },
      ],
      zones: [],
      rows: [],
      seats: [
        {
          id: 'seat-edge',
          floorId: 'floor-1',
          label: 'A1',
          position: { x: 0, y: 0 },
          placement: { kind: 'standalone' },
        },
        {
          id: 'seat-inside',
          floorId: 'floor-1',
          label: 'A2',
          position: { x: 0.25, y: 0 },
          placement: { kind: 'standalone' },
        },
      ],
      tables: [],
      backgrounds: [],
      decorations: [],
    });
    const scene = buildHallScene(snapshot, 'floor-1');

    expect(
      boxSelectedTargetsForSelection(
        scene,
        { minX: 0.2, minY: -0.1, maxX: 0.3, maxY: 0.1 },
        ['seat'],
      ),
    ).toEqual([{ kind: 'seat', id: 'seat-inside' }]);
  });
});
