import type { HallLayoutDraft } from '@hall-platform/domain';
import { createHallApiClient } from './client.js';
import { mapBuyerOccurrence } from './mapping.js';

/** A host owns the token and uses the same key when retrying one mutation. */
export async function exampleEditorSession(
  baseURL: string,
  getToken: () => string,
  hallId: string,
  editedDraft: HallLayoutDraft,
  saveAttemptId: string,
) {
  const api = createHallApiClient({ baseURL, getToken });
  try {
    const current = await api.getHall(hallId);
    const validation = await api.validateDraft(editedDraft);
    if (validation.issues.some((issue) => issue.severity === 'error')) return validation;
    return api.saveDraft(editedDraft, current.revision, saveAttemptId);
  } finally {
    api.dispose();
  }
}

/** SeatView receives mapped server data; checkout uses only server totals. */
export async function exampleBuyerSession(
  baseURL: string,
  getToken: () => string,
  occurrenceId: string,
  seatId: string,
  holdAttemptId: string,
  orderAttemptId: string,
  checkoutAttemptId: string,
) {
  const api = createHallApiClient({ baseURL, getToken });
  try {
    const occurrence = mapBuyerOccurrence(await api.getOccurrence(occurrenceId));
    const hold = await api.createHold(
      occurrenceId,
      [{ kind: 'seat', seatId }],
      holdAttemptId,
      occurrence.availabilityRevision,
    );
    const order = await api.createOrder(hold.id, orderAttemptId);
    return api.checkoutOrder(order.id, checkoutAttemptId);
  } finally {
    api.dispose();
  }
}
