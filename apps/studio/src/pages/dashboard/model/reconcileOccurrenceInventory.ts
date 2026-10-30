import { layoutSnapshotSchema } from '@hall-platform/domain';
import { parseHallLayoutDraft, type HallLayoutDraft } from '@hall-platform/hall-editor';
import { withoutBackgrounds } from '@hall-platform/domain';
import type { DemoOccurrence } from './demoBooking.js';

export type OccurrenceLayoutConflict = Readonly<{
  code: 'removed_committed_seat' | 'ga_capacity_below_committed';
  targetId: string;
  message: string;
}>;

export type OccurrenceLayoutReconciliation = Readonly<{
  occurrence: DemoOccurrence;
  conflicts: readonly OccurrenceLayoutConflict[];
}>;

export function reconcileOccurrenceLayout(
  occurrence: DemoOccurrence,
  draft: HallLayoutDraft,
  now = Date.now(),
): OccurrenceLayoutReconciliation {
  const versionId = `version-${crypto.randomUUID()}`;
  const rawSnapshot = {
    ...draft.snapshot,
    id: `snapshot-${crypto.randomUUID()}`,
    layoutVersionId: versionId,
    floors: draft.snapshot.floors.map((floor) => ({
      ...floor,
      layoutVersionId: versionId,
    })),
  };
  const snapshot = withoutBackgrounds(layoutSnapshotSchema.parse(rawSnapshot));
  const editorLayout = parseHallLayoutDraft({
    ...draft,
    snapshot: layoutSnapshotSchema.parse(rawSnapshot),
    zoneBounds: Object.fromEntries(
      Object.entries(draft.zoneBounds).filter(([zoneId]) =>
        rawSnapshot.zones.some((zone) => zone.id === zoneId),
      ),
    ),
  });
  const nextSeatIds = new Set<string>(snapshot.seats.map((seat) => seat.id));
  const nextZones = new Map<string, (typeof snapshot.zones)[number]>(snapshot.zones.map((zone) => [zone.id, zone]));
  const conflicts: OccurrenceLayoutConflict[] = [];
  const committedSeatIds = new Set([
    ...Object.entries(occurrence.initialSeats)
      .filter(([, status]) => status === 'held' || status === 'sold' || status === 'blocked')
      .map(([seatId]) => seatId),
    ...occurrence.holds
      .filter((hold) => hold.expiresAt > now)
      .flatMap((hold) => hold.selection.flatMap((item) => item.kind === 'seat' ? [item.seatId] : [])),
    ...occurrence.orders.flatMap((order) => order.selection.flatMap((item) => item.kind === 'seat' ? [item.seatId] : [])),
  ]);
  for (const seatId of committedSeatIds) {
    if (!nextSeatIds.has(seatId))
      conflicts.push({ code: 'removed_committed_seat', targetId: seatId, message: `Нельзя удалить место ${seatId}: оно продано, удерживается, заблокировано или используется заказом.` });
  }

  const committedByZone = new Map<string, number>();
  for (const selection of [
    ...occurrence.holds.filter((hold) => hold.expiresAt > now).map((hold) => hold.selection),
    ...occurrence.orders.map((order) => order.selection),
  ]) {
    for (const item of selection) {
      if (item.kind !== 'generalAdmission') continue;
      committedByZone.set(item.zoneId, (committedByZone.get(item.zoneId) ?? 0) + item.quantity);
    }
  }
  for (const [zoneId, committed] of committedByZone) {
    const zone = nextZones.get(zoneId);
    if (zone?.kind === 'ga' && (zone.capacity ?? 0) < committed)
      conflicts.push({ code: 'ga_capacity_below_committed', targetId: zoneId, message: `Вместимость зоны ${zone.name} меньше уже удержанного и проданного количества (${committed}).` });
    if (zone?.kind !== 'ga')
      conflicts.push({ code: 'ga_capacity_below_committed', targetId: zoneId, message: `Нельзя удалить GA-зону ${occurrence.layout.snapshot.zones.find((item) => item.id === zoneId)?.name ?? zoneId}: в ней есть удержания или заказы.` });
  }

  const previousSeats = occurrence.initialSeats;
  const initialSeats = Object.fromEntries(snapshot.seats.map((seat) => [seat.id, previousSeats[seat.id] ?? 'available']));
  const prices = {
    seats: Object.fromEntries(Object.entries(occurrence.prices.seats ?? {}).filter(([id]) => nextSeatIds.has(id))),
    zones: Object.fromEntries(Object.entries(occurrence.prices.zones ?? {}).filter(([id]) => nextZones.has(id))),
  };
  const zoneCapacity = Object.fromEntries(
    snapshot.zones.filter((zone) => zone.kind === 'ga').map((zone) => [zone.id, zone.capacity ?? occurrence.zoneCapacity[zone.id] ?? 20]),
  );
  return {
    occurrence: {
      ...occurrence,
      revision: occurrence.revision + 1,
      editorLayout,
      layout: {
        hallName: draft.hallName,
        snapshot,
        ...(Object.keys(editorLayout.zoneBounds).length > 0
          ? { zoneBounds: editorLayout.zoneBounds }
          : {}),
      },
      initialSeats,
      zoneCapacity,
      prices,
    },
    conflicts,
  };
}
