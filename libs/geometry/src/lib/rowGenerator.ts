import {
  arcLength,
  arcPointAtFraction,
  arcUnitTangent,
  type CircularArc,
} from './arc.js';
import {
  bezierPointAtLengthFraction,
  bezierUnitTangentAtLengthFraction,
  createBezierArcLengthTable,
  type CubicBezier,
} from './bezier.js';
import {
  lineLength,
  linePointAtFraction,
  lineUnitTangent,
  type LineSegment,
} from './line.js';
import { addVectors, type Vector2 } from './vector.js';

export type RowPath =
  | ({ readonly kind: 'line' } & LineSegment)
  | ({ readonly kind: 'arc' } & CircularArc)
  | ({ readonly kind: 'bezier' } & CubicBezier)
  | { readonly kind: 'polyline'; readonly points: readonly Vector2[] };

export type RowSeatDistribution =
  | { readonly kind: 'even'; readonly count: number }
  | { readonly kind: 'fixed'; readonly count: number; readonly step: number };

export type RowSeatGap = {
  readonly afterSlot: number;
  readonly length: number;
};

export type RowSeatAdjustment = {
  readonly slotIndex: number;
  readonly offset?: Vector2 | undefined;
  readonly rotationOffsetRadians?: number | undefined;
};

export type RowSeatGenerationOptions = {
  readonly distribution: RowSeatDistribution;
  readonly startInset?: number | undefined;
  readonly endInset?: number | undefined;
  readonly gaps?: readonly RowSeatGap[] | undefined;
  readonly skippedSlots?: readonly number[] | undefined;
  readonly numbering?:
    | {
        readonly start?: number | undefined;
        readonly direction?: 'forward' | 'reverse' | undefined;
        readonly skippedNumbers?: readonly number[] | undefined;
      }
    | undefined;
  readonly adjustments?: readonly RowSeatAdjustment[] | undefined;
};

export type RowSeatSlot = {
  readonly slotIndex: number;
  readonly label: string;
  readonly position: Vector2;
  readonly tangent: Vector2;
  readonly rotationRadians: number;
  readonly distanceAlongRow: number;
};

type PathSample = { position: Vector2; tangent: Vector2 };
type PathSampler = {
  length: number;
  sampleAtDistance: (distance: number) => PathSample;
};

function requireTangent(tangent: Vector2 | null): Vector2 {
  if (tangent === null) throw new RangeError('Row path has no tangent');
  return tangent;
}

function createPathSampler(path: RowPath): PathSampler {
  if (path.kind === 'line') {
    const length = lineLength(path);
    return {
      length,
      sampleAtDistance: (distance) => ({
        position: linePointAtFraction(path, distance / length),
        tangent: requireTangent(lineUnitTangent(path)),
      }),
    };
  }

  if (path.kind === 'arc') {
    const length = arcLength(path);
    return {
      length,
      sampleAtDistance: (distance) => ({
        position: arcPointAtFraction(path, distance / length),
        tangent: requireTangent(arcUnitTangent(path, distance / length)),
      }),
    };
  }

  if (path.kind === 'bezier') {
    const table = createBezierArcLengthTable(path);
    return {
      length: table.totalLength,
      sampleAtDistance: (distance) => ({
        position: bezierPointAtLengthFraction(
          table,
          distance / table.totalLength,
        ),
        tangent: requireTangent(
          bezierUnitTangentAtLengthFraction(
            table,
            distance / table.totalLength,
          ),
        ),
      }),
    };
  }

  const segments: {
    line: LineSegment;
    startDistance: number;
    endDistance: number;
  }[] = [];
  let length = 0;
  for (let index = 1; index < path.points.length; index += 1) {
    const start = path.points[index - 1];
    const end = path.points[index];
    if (start === undefined || end === undefined) continue;
    const line = { start, end };
    const segmentLength = lineLength(line);
    if (segmentLength === 0) continue;
    segments.push({
      line,
      startDistance: length,
      endDistance: length + segmentLength,
    });
    length += segmentLength;
  }
  return {
    length,
    sampleAtDistance: (distance) => {
      const segment =
        segments.find(({ endDistance }) => distance < endDistance) ??
        segments.at(-1);
      if (segment === undefined) throw new RangeError('Row path has no length');
      const fraction =
        (distance - segment.startDistance) /
        (segment.endDistance - segment.startDistance);
      return {
        position: linePointAtFraction(segment.line, fraction),
        tangent: requireTangent(lineUnitTangent(segment.line)),
      };
    },
  };
}

function requireNonnegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and nonnegative`);
  }
}

function requireSlotIndex(index: number, count: number, name: string): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`${name} is outside the row`);
  }
}

export function generateRowSeatSlots(
  path: RowPath,
  options: RowSeatGenerationOptions,
): RowSeatSlot[] {
  const { distribution } = options;
  const { count } = distribution;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('Seat count must be a nonnegative integer');
  }
  if (distribution.kind === 'fixed') {
    if (!Number.isFinite(distribution.step) || distribution.step <= 0) {
      throw new RangeError('Fixed seat step must be positive and finite');
    }
  }

  const sampler = createPathSampler(path);
  if (!Number.isFinite(sampler.length) || sampler.length <= 0) {
    throw new RangeError('Row path must have positive finite length');
  }
  const startInset = options.startInset ?? 0;
  const endInset = options.endInset ?? 0;
  requireNonnegativeFinite(startInset, 'Start inset');
  requireNonnegativeFinite(endInset, 'End inset');
  const usableLength = sampler.length - startInset - endInset;
  if (usableLength < 0) throw new RangeError('Row insets exceed path length');

  const gaps = new Map<number, number>();
  let totalGapLength = 0;
  for (const gap of options.gaps ?? []) {
    requireSlotIndex(gap.afterSlot, count - 1, 'Gap index');
    if (!Number.isFinite(gap.length) || gap.length <= 0) {
      throw new RangeError('Gap length must be positive and finite');
    }
    if (gaps.has(gap.afterSlot)) throw new RangeError('Duplicate row gap');
    gaps.set(gap.afterSlot, gap.length);
    totalGapLength += gap.length;
  }

  const skippedSlots = new Set<number>();
  for (const index of options.skippedSlots ?? []) {
    requireSlotIndex(index, count, 'Skipped slot');
    if (skippedSlots.has(index)) throw new RangeError('Duplicate skipped slot');
    skippedSlots.add(index);
  }

  const adjustments = new Map<number, RowSeatAdjustment>();
  for (const adjustment of options.adjustments ?? []) {
    requireSlotIndex(adjustment.slotIndex, count, 'Adjustment index');
    if (adjustments.has(adjustment.slotIndex)) {
      throw new RangeError('Duplicate seat adjustment');
    }
    if (
      (adjustment.offset !== undefined &&
        (!Number.isFinite(adjustment.offset.x) ||
          !Number.isFinite(adjustment.offset.y))) ||
      (adjustment.rotationOffsetRadians !== undefined &&
        !Number.isFinite(adjustment.rotationOffsetRadians))
    ) {
      throw new RangeError('Seat adjustment must be finite');
    }
    adjustments.set(adjustment.slotIndex, adjustment);
  }

  const numberingStart = options.numbering?.start ?? 1;
  if (!Number.isSafeInteger(numberingStart) || numberingStart < 1) {
    throw new RangeError('Numbering start must be a positive integer');
  }
  const skippedNumbers = new Set<number>();
  for (const number of options.numbering?.skippedNumbers ?? []) {
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new RangeError('Skipped number must be a positive integer');
    }
    skippedNumbers.add(number);
  }

  if (count === 0) return [];
  if (distribution.kind === 'even' && count > 1) {
    if (usableLength <= totalGapLength) {
      throw new RangeError('Row gaps leave no space between seats');
    }
  }

  const step =
    distribution.kind === 'fixed'
      ? distribution.step
      : count > 1
        ? (usableLength - totalGapLength) / (count - 1)
        : 0;
  const positions: Omit<RowSeatSlot, 'label'>[] = [];
  let gapOffset = 0;
  for (let index = 0; index < count; index += 1) {
    if (index > 0) gapOffset += gaps.get(index - 1) ?? 0;
    const distance =
      distribution.kind === 'even' && count === 1
        ? startInset + usableLength / 2
        : startInset + index * step + gapOffset;
    if (distance > sampler.length - endInset + 1e-9) {
      throw new RangeError('Seats and gaps exceed available row length');
    }
    if (skippedSlots.has(index)) continue;

    const sample = sampler.sampleAtDistance(distance);
    const adjustment = adjustments.get(index);
    const position = adjustment?.offset
      ? addVectors(sample.position, adjustment.offset)
      : sample.position;
    positions.push({
      slotIndex: index,
      position,
      tangent: sample.tangent,
      rotationRadians:
        Math.atan2(sample.tangent.y, sample.tangent.x) +
        (adjustment?.rotationOffsetRadians ?? 0),
      distanceAlongRow: distance,
    });
  }

  const labels = new Map<number, string>();
  let nextNumber = numberingStart;
  const ordered =
    options.numbering?.direction === 'reverse'
      ? [...positions].reverse()
      : positions;
  for (const { slotIndex } of ordered) {
    while (skippedNumbers.has(nextNumber)) nextNumber += 1;
    if (!Number.isSafeInteger(nextNumber)) {
      throw new RangeError('Seat number exceeds safe integer range');
    }
    labels.set(slotIndex, String(nextNumber));
    nextNumber += 1;
  }
  return positions.map((position) => ({
    ...position,
    label: labels.get(position.slotIndex) ?? '',
  }));
}
