import { createEmptyDraft } from '@hall-platform/domain';
import { describe, expect, it } from 'vitest';
import { validateStoredRecovery } from './recoveryRepository.js';

describe('recovery drafts', () => {
  it('retains the base revision used for conflict detection', () => {
    const draft = createEmptyDraft('Hall');
    const record = {
      hallId: draft.snapshot.id,
      draft,
      baseRevision: 3,
      updatedAt: new Date().toISOString(),
    };
    expect(validateStoredRecovery(record)).toEqual(record);
    expect(() =>
      validateStoredRecovery({ ...record, baseRevision: -1 }),
    ).toThrow();
    expect(() =>
      validateStoredRecovery({ ...record, hallId: 'other' }),
    ).toThrow();
  });
});
