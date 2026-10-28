import { seatSymbolBounds } from './seatGeometry.js';
import {
  createRendererScene,
  type RendererScene,
  type RendererSceneIdentity,
} from './scene.js';
import type { RendererSeatGeometry } from './rendererContract.js';

export type SeatSceneInput = RendererSeatGeometry &
  Readonly<{ id: string; floorId: string }>;

export function createSeatScene(
  revision: number,
  seats: readonly SeatSceneInput[],
  floorId?: string,
  identity?: RendererSceneIdentity,
): RendererScene<RendererSeatGeometry> {
  const seatFloors = new Set(
    seats.map(({ floorId: itemFloorId }) => itemFloorId),
  );
  const activeFloorId =
    floorId ?? (seatFloors.size === 1 ? seats[0]?.floorId : undefined);
  const sceneSeats = activeFloorId
    ? seats.filter((seat) => seat.floorId === activeFloorId)
    : seats;
  return createRendererScene(
    revision,
    sceneSeats.map((seat) => {
      const geometry: RendererSeatGeometry = {
        position: seat.position,
        ...(seat.rotationRadians !== undefined
          ? { rotationRadians: seat.rotationRadians }
          : {}),
        ...(seat.visualKind !== undefined
          ? { visualKind: seat.visualKind }
          : {}),
      };
      return {
        id: seat.id,
        floorId: seat.floorId,
        kind: 'seat',
        bounds: seatSymbolBounds(geometry),
        geometry,
      };
    }),
    activeFloorId,
    identity,
    seats.map(({ id }) => id),
  );
}
