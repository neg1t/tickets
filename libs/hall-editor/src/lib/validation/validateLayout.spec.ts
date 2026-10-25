import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { seatIdSchema, seatSchema, worldPointSchema } from '@hall-platform/domain';
import { createEmptyDraft } from '../editorDraft.js';
import { validateLayout } from './validateLayout.js';

describe('validateLayout', () => {
  it('reports nearby collisions in original seat order across spatial cell edges', () => {
    const draft = createEmptyDraft('Зал');
    const floorId = draft.snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Missing floor');
    const positions = [0, 1.0, 1.2, 2.1];
    const seats = positions.map((x, index) => seatSchema.parse({
      id: `seat-${index}`,
      floorId,
      label: String(index + 1),
      position: { x, y: 0 },
      placement: { kind: 'standalone' },
    }));
    const issues = validateLayout({
      ...draft,
      snapshot: { ...draft.snapshot, seats },
    });
    expect(issues.filter((issue) => issue.code === 'seat-collision').map(
      (issue) => issue.targetId,
    )).toEqual([seats[0]?.id, seats[1]?.id, seats[2]?.id]);
  });

  it('checks a sparse 10k seat layout within the editor validation budget', () => {
    const draft = createEmptyDraft('Большой зал');
    const floorId = draft.snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Missing floor');
    const seed = seatSchema.parse({
      id: 'seat-seed', floorId, label: '0',
      position: { x: 0, y: 0 }, placement: { kind: 'standalone' },
    });
    const seats = Array.from({ length: 10_000 }, (_, index) => ({
      ...seed,
      id: seatIdSchema.parse(`seat-${index}`),
      label: String(index),
      position: worldPointSchema.parse({ x: index * 2, y: 0 }),
    }));
    const large = { ...draft, snapshot: { ...draft.snapshot, seats } };
    const started = performance.now();
    const issues = validateLayout(large, false);
    const elapsed = performance.now() - started;
    console.info(`10k validation: ${elapsed.toFixed(1)} ms`);
    expect(issues).toEqual([]);
    expect(elapsed).toBeLessThan(200);
  }, 20_000);
  it('separates blocking links and empty rows from collision warnings', () => {
    const draft = createEmptyDraft('Зал');
    const floorId = draft.snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Missing floor');
    const snapshot = {
      ...draft.snapshot,
      rows: [
        {
          id: 'row-empty',
          floorId,
          name: 'А',
          curve: {
            kind: 'line' as const,
            start: { x: 0, y: 0 },
            end: { x: 0, y: 0 },
          },
        },
      ],
      seats: [
        {
          id: 'seat-a',
          floorId,
          label: '1',
          position: { x: 2, y: 2 },
          placement: { kind: 'standalone' as const },
        },
        {
          id: 'seat-b',
          floorId,
          label: '1',
          position: { x: 2.1, y: 2 },
          placement: { kind: 'standalone' as const },
        },
      ],
    };
    const issues = validateLayout({ ...draft, snapshot } as typeof draft);
    expect(
      issues.some(
        (issue) => issue.code === 'empty-row' && issue.severity === 'error',
      ),
    ).toBe(true);
    expect(
      issues.some(
        (issue) =>
          issue.code === 'degenerate-row' && issue.severity === 'error',
      ),
    ).toBe(true);
    expect(
      issues.some(
        (issue) =>
          issue.code === 'duplicate-number' && issue.severity === 'error',
      ),
    ).toBe(true);
    expect(
      issues.some(
        (issue) =>
          issue.code === 'seat-collision' && issue.severity === 'warning',
      ),
    ).toBe(true);
  });

  it('accepts an empty draft and ignores decorations as saleable seats', () => {
    const draft = createEmptyDraft('Зал');
    expect(validateLayout(draft)).toEqual([]);
  });

  it('blocks a seat whose floor link is broken', () => {
    const draft = createEmptyDraft('Зал');
    const broken = {
      ...draft,
      snapshot: {
        ...draft.snapshot,
        seats: [
          {
            id: 'seat-orphan',
            floorId: 'floor-missing',
            label: '1',
            position: { x: 0, y: 0 },
            placement: { kind: 'standalone' },
          },
        ],
      },
    } as typeof draft;
    expect(
      validateLayout(broken).some(
        (issue) => issue.code === 'broken-link' && issue.severity === 'error',
      ),
    ).toBe(true);
  });
});
