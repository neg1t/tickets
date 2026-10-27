import { seatSymbolDiameter } from '@hall-platform/renderer-core';
import type {
  RendererSeatGeometry,
  RendererSeatPositionUpdate,
  RendererSeatUpdate,
  RendererTargetRef,
} from '@hall-platform/renderer-core';

export type SeatBufferGeometry = RendererSeatGeometry &
  Readonly<{
    id: string;
  }>;

export type BufferRange = Readonly<{ start: number; count: number }>;

export type SeatBuffers = Readonly<{
  ids: readonly string[];
  indexById: ReadonlyMap<string, number>;
  positions: Float32Array;
  rotations: Float32Array;
  symbolKinds: Float32Array;
  diameters: Float32Array;
  statuses: Float32Array;
  selected: Float32Array;
  fillColors: Uint8Array;
  selectedIndices: Set<number>;
}>;

const statusCodes: Readonly<Record<string, number>> = {
  available: 0,
  held: 1,
  sold: 2,
  blocked: 3,
  unavailable: 4,
};

function statusCode(status: string): number {
  return statusCodes[status] ?? statusCodes.unavailable ?? 4;
}

function rangesForIndices(
  indices: readonly number[],
  mergeGap = 0,
): BufferRange[] {
  if (indices.length === 0) return [];
  const sorted = [...new Set(indices)].sort((first, second) => first - second);
  const ranges: BufferRange[] = [];
  let start = sorted[0] ?? 0;
  let previous = start;
  for (const index of sorted.slice(1)) {
    if (index - previous <= mergeGap + 1) {
      previous = index;
      continue;
    }
    ranges.push({ start, count: previous - start + 1 });
    start = index;
    previous = index;
  }
  ranges.push({ start, count: previous - start + 1 });
  return ranges;
}

export function createSeatBuffers(
  seats: readonly SeatBufferGeometry[],
): SeatBuffers {
  const ids: string[] = [];
  const indexById = new Map<string, number>();
  const positions = new Float32Array(seats.length * 2);
  const rotations = new Float32Array(seats.length);
  const symbolKinds = new Float32Array(seats.length);
  const diameters = new Float32Array(seats.length);
  const statuses = new Float32Array(seats.length);
  const selected = new Float32Array(seats.length);
  const fillColors = new Uint8Array(seats.length * 4);

  seats.forEach((seat, index) => {
    if (indexById.has(seat.id))
      throw new Error(`Duplicate seat id: ${seat.id}`);
    ids.push(seat.id);
    indexById.set(seat.id, index);
    positions[index * 2] = seat.position.x;
    positions[index * 2 + 1] = seat.position.y;
    rotations[index] = seat.rotationRadians ?? 0;
    symbolKinds[index] =
      seat.visualKind === 'armchair'
        ? 1
        : seat.visualKind === 'wheelchairBay'
          ? 2
          : 0;
    diameters[index] = seatSymbolDiameter(seat.visualKind);
  });

  return {
    ids: Object.freeze(ids),
    indexById,
    positions,
    rotations,
    symbolKinds,
    diameters,
    statuses,
    selected,
    fillColors,
    selectedIndices: new Set(),
  };
}

function parseFillColor(
  value: string,
): readonly [number, number, number] | null {
  const color = value.trim();
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color)?.[1];
  if (hex) {
    const full =
      hex.length === 3
        ? [...hex].map((component) => `${component}${component}`).join('')
        : hex;
    return [0, 2, 4].map((offset) =>
      Number.parseInt(full.slice(offset, offset + 2), 16),
    ) as [number, number, number];
  }

  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(color);
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((channel) => !Number.isFinite(channel))) return null;
  return channels.map((channel) =>
    Math.round(Math.min(255, Math.max(0, channel))),
  ) as [number, number, number];
}

export function updateSeatFillColors(
  buffers: SeatBuffers,
  updates: readonly Pick<RendererSeatUpdate, 'id' | 'fillColor'>[],
): BufferRange[] {
  const changed: number[] = [];
  for (const update of updates) {
    const index = buffers.indexById.get(update.id);
    if (index === undefined || update.fillColor === undefined) continue;
    const parsed =
      update.fillColor === null ? null : parseFillColor(update.fillColor);
    if (update.fillColor !== null && !parsed) continue;
    const next = parsed ? [...parsed, 255] : [0, 0, 0, 0];
    const offset = index * 4;
    if (
      next.every(
        (channel, component) =>
          buffers.fillColors[offset + component] === channel,
      )
    )
      continue;
    next.forEach((channel, component) => {
      buffers.fillColors[offset + component] = channel;
    });
    changed.push(index);
  }
  return rangesForIndices(changed);
}

export function updateSeatStatuses(
  buffers: SeatBuffers,
  updates: readonly Pick<RendererSeatUpdate, 'id' | 'status'>[],
): BufferRange[] {
  const changed: number[] = [];
  for (const update of updates) {
    const index = buffers.indexById.get(update.id);
    if (index === undefined) continue;
    const next = statusCode(update.status);
    if (buffers.statuses[index] === next) continue;
    buffers.statuses[index] = next;
    changed.push(index);
  }
  return rangesForIndices(changed, 1);
}

export function updateSeatPositions(
  buffers: SeatBuffers,
  updates: readonly RendererSeatPositionUpdate[],
): BufferRange[] {
  const changed: number[] = [];
  for (const update of updates) {
    const index = buffers.indexById.get(update.id);
    if (index === undefined) continue;
    const offset = index * 2;
    if (
      buffers.positions[offset] === update.position.x &&
      buffers.positions[offset + 1] === update.position.y
    )
      continue;
    buffers.positions[offset] = update.position.x;
    buffers.positions[offset + 1] = update.position.y;
    changed.push(index);
  }
  return rangesForIndices(changed);
}

export function updateSeatSelection(
  buffers: SeatBuffers,
  targets: readonly RendererTargetRef[],
): BufferRange[] {
  const nextSelected = new Set<number>();
  for (const target of targets) {
    if (target.kind !== 'seat') continue;
    const index = buffers.indexById.get(target.id);
    if (index !== undefined) nextSelected.add(index);
  }

  const changed = new Set<number>([
    ...buffers.selectedIndices,
    ...nextSelected,
  ]);
  const changedIndices: number[] = [];
  for (const index of changed) {
    const next = nextSelected.has(index) ? 1 : 0;
    if (buffers.selected[index] === next) continue;
    buffers.selected[index] = next;
    changedIndices.push(index);
  }
  buffers.selectedIndices.clear();
  for (const index of nextSelected) buffers.selectedIndices.add(index);
  return rangesForIndices(changedIndices);
}
