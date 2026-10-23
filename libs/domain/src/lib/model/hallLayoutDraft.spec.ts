import { describe, expect, it } from 'vitest';
import { createEmptyDraft, parseHallLayoutDraft } from './hallLayoutDraft.js';

describe('draft format migrations', () => {
  it('writes an explicit current format version', () => {
    expect(createEmptyDraft('Theater').schemaVersion).toBe(2);
  });

  it('imports an unversioned v1 draft without losing its contents', () => {
    const current = createEmptyDraft('Theater');
    const { schemaVersion: _, ...v1Fixture } = current;
    const restored = parseHallLayoutDraft(
      JSON.parse(JSON.stringify(v1Fixture)),
    );

    expect(restored).toEqual(current);
  });

  it('imports an explicitly versioned v1 draft', () => {
    const current = createEmptyDraft('Theater');
    expect(parseHallLayoutDraft({ ...current, schemaVersion: 1 })).toEqual(
      current,
    );
  });

  it('rejects unknown future versions', () => {
    expect(() =>
      parseHallLayoutDraft({
        ...createEmptyDraft('Theater'),
        schemaVersion: 3,
      }),
    ).toThrow(/version/i);
    expect(() =>
      parseHallLayoutDraft({
        ...createEmptyDraft('Theater'),
        schemaVersion: null,
      }),
    ).toThrow(/version/i);
  });
});
