// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDraft } from '../editorDraft.js';
import { useLayoutDiagnostics } from './useLayoutDiagnostics.js';

afterEach(() => vi.useRealTimers());

describe('useLayoutDiagnostics', () => {
  it('reports when full diagnostics for the current draft finish', async () => {
    vi.useFakeTimers();
    const draft = createEmptyDraft('Hall');
    const { result, unmount } = renderHook(() =>
      useLayoutDiagnostics(draft, { getLatestDraft: () => draft }),
    );

    expect(result.current.validationPending).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(result.current.validationPending).toBe(false);
    expect(result.current.hasCurrentFullValidation).toBe(true);
    unmount();
  });

  it('normalizes reported failures and clears them without changing errors', () => {
    const draft = createEmptyDraft('Hall');
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useLayoutDiagnostics(draft, { getLatestDraft: () => draft, onError }),
    );

    act(() => result.current.report('Validation worker failed'));
    expect(result.current.errorMessage).toBe('Validation worker failed');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation worker failed' }),
    );
    act(() => result.current.clearError());
    expect(result.current.errorMessage).toBeNull();
  });
});
