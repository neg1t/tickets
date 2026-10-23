import { describe, expect, it } from 'vitest';
import { createEmptyDraft } from '../editorDraft.js';
import { validateLayout } from './validateLayout.js';

describe('validateLayout', () => {
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
