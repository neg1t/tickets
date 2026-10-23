import { seatIdSchema, type SeatId } from '../../../shared/ids/index.js';

export type SeatIdReconciliationOptions = {
  previousSeatIds: readonly SeatId[];
  nextSeatIds: readonly (SeatId | null)[];
  reservedSeatIds: readonly SeatId[];
  publishedSeatIds: readonly SeatId[];
  createSeatId?: () => SeatId;
};

export type SeatIdReconciliation = {
  seatIds: SeatId[];
  createdSeatIds: SeatId[];
  removedSeatIds: SeatId[];
  removedPublishedSeatIds: SeatId[];
};

export function createSeatId(): SeatId {
  return seatIdSchema.parse(globalThis.crypto.randomUUID());
}

export function reconcileSeatIds({
  previousSeatIds,
  nextSeatIds,
  reservedSeatIds,
  publishedSeatIds,
  createSeatId: createSeatIdOverride,
}: SeatIdReconciliationOptions): SeatIdReconciliation {
  const previousIds = new Set<string>();
  for (const id of previousSeatIds) {
    seatIdSchema.parse(id);
    if (previousIds.has(id)) {
      throw new Error(`Duplicate previous seat ID: ${id}`);
    }
    previousIds.add(id);
  }

  const publishedIds = new Set<string>();
  for (const id of publishedSeatIds) {
    seatIdSchema.parse(id);
    publishedIds.add(id);
  }

  const otherDraftIds = new Set<string>();
  for (const id of reservedSeatIds) {
    seatIdSchema.parse(id);
    if (previousIds.has(id) || otherDraftIds.has(id)) {
      throw new Error(`Duplicate draft seat ID: ${id}`);
    }
    otherDraftIds.add(id);
  }

  const retainedIds = new Set<string>();
  for (const id of nextSeatIds) {
    if (id === null) continue;
    seatIdSchema.parse(id);
    if (!previousIds.has(id)) {
      throw new Error(`Unknown retained seat ID: ${id}`);
    }
    if (retainedIds.has(id)) {
      throw new Error(`Duplicate retained seat ID: ${id}`);
    }
    retainedIds.add(id);
  }

  const reservedIds = new Set([
    ...previousIds,
    ...otherDraftIds,
    ...publishedIds,
  ]);
  const createdSeatIds: SeatId[] = [];
  const makeSeatId = createSeatIdOverride ?? createSeatId;
  const seatIds = nextSeatIds.map((id) => {
    if (id !== null) return id;

    const createdId = seatIdSchema.parse(makeSeatId());
    if (reservedIds.has(createdId)) {
      throw new Error(`Generated seat ID is already in use: ${createdId}`);
    }
    reservedIds.add(createdId);
    createdSeatIds.push(createdId);
    return createdId;
  });

  const removedSeatIds = previousSeatIds.filter((id) => !retainedIds.has(id));
  const removedPublishedSeatIds = removedSeatIds.filter((id) =>
    publishedIds.has(id),
  );

  return { seatIds, createdSeatIds, removedSeatIds, removedPublishedSeatIds };
}
