import { createEvent, createStore } from 'effector';

export function createSeatViewModel(initialFloorId: string) {
  const floorSelected = createEvent<string>();
  const zoneSelected = createEvent<string | null>();
  const $floorId = createStore(initialFloorId).on(
    floorSelected,
    (_, floorId) => floorId,
  );
  const $zoneId = createStore<string | null>(null)
    .on(zoneSelected, (_, zoneId) => zoneId)
    .reset(floorSelected);

  return { $floorId, $zoneId, floorSelected, zoneSelected };
}
