import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, storageFailure, transact } from './storageDatabase.js';

afterEach(() => vi.unstubAllGlobals());

describe('IndexedDB failures', () => {
  it('reports a blocked upgrade with a retryable typed error', async () => {
    const request: { onblocked?: () => void } = {};
    vi.stubGlobal('indexedDB', {
      open: () => {
        queueMicrotask(() => request.onblocked?.());
        return request;
      },
    });
    await expect(openDatabase('blocked-test')).rejects.toMatchObject({
      code: 'blocked',
    });
  });

  it('classifies quota failures', () => {
    expect(
      storageFailure(new DOMException('Full', 'QuotaExceededError')).code,
    ).toBe('quota');
  });

  it('retains a quota error raised inside an asynchronous request callback', async () => {
    const transaction: {
      onabort?: () => void;
      abort: () => void;
      error: null;
    } = {
      error: null,
      abort() {
        queueMicrotask(() => transaction.onabort?.());
      },
    };
    const database = {
      transaction: () => transaction,
    } as unknown as Parameters<typeof transact>[0];
    await expect(
      transact(
        database,
        ['halls'],
        'readwrite',
        (_transaction, _done, fail) => {
          queueMicrotask(() =>
            fail(new DOMException('Full', 'QuotaExceededError')),
          );
        },
      ),
    ).rejects.toMatchObject({ code: 'quota' });
  });
});
