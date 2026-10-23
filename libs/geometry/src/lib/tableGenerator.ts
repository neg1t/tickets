import {
  createRotationMatrix,
  transformVector,
  type Matrix2D,
} from './matrix.js';
import { addVectors, type Vector2 } from './vector.js';

export type TableGeometryShape =
  | {
      readonly kind: 'circle';
      readonly radius: number;
      readonly seatCount: number;
    }
  | {
      readonly kind: 'rectangle';
      readonly width: number;
      readonly height: number;
      readonly seatsPerSide: {
        readonly top: number;
        readonly right: number;
        readonly bottom: number;
        readonly left: number;
      };
    };

export type TableGeometry = {
  readonly center: Vector2;
  readonly rotationRadians: number;
  readonly shape: TableGeometryShape;
};

export type TableSeatAdjustment = {
  readonly slotKey: string;
  readonly offset?: Vector2 | undefined;
  readonly facingOffsetRadians?: number | undefined;
};

export type TableSeatGenerationOptions = {
  readonly seatOffset: number;
  readonly skippedSlotKeys?: readonly string[] | undefined;
  readonly numbering?:
    | {
        readonly start?: number | undefined;
        readonly direction?: 'forward' | 'reverse' | undefined;
        readonly prefix?: string | undefined;
      }
    | undefined;
  readonly adjustments?: readonly TableSeatAdjustment[] | undefined;
};

export type TableSeatSlot = {
  readonly slotKey: string;
  readonly slotIndex: number;
  readonly label: string;
  readonly position: Vector2;
  readonly facingRadians: number;
};

type LocalSeatSlot = {
  slotKey: string;
  position: Vector2;
  facing: Vector2;
};

type RectangleSide = 'top' | 'right' | 'bottom' | 'left';

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be positive and finite`);
  }
}

function requireSeatCount(count: number, name: string): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`${name} must be a nonnegative integer`);
  }
}

function createCircularSlots(
  radius: number,
  seatCount: number,
  offset: number,
): LocalSeatSlot[] {
  const seatRadius = radius + offset;
  return Array.from({ length: seatCount }, (_, index) => {
    const angle = (2 * Math.PI * index) / seatCount;
    const radial = { x: Math.cos(angle), y: Math.sin(angle) };
    return {
      slotKey: `circle:${index}`,
      position: { x: seatRadius * radial.x, y: seatRadius * radial.y },
      facing: { x: -radial.x, y: -radial.y },
    };
  });
}

function createRectangularSlots(
  shape: Extract<TableGeometryShape, { kind: 'rectangle' }>,
  offset: number,
): LocalSeatSlot[] {
  const { width, height, seatsPerSide } = shape;
  const slots: LocalSeatSlot[] = [];
  const sides: RectangleSide[] = ['top', 'right', 'bottom', 'left'];
  for (const side of sides) {
    const count = seatsPerSide[side];
    for (let index = 0; index < count; index += 1) {
      const fraction = (index + 1) / (count + 1);
      let position: Vector2;
      let facing: Vector2;
      switch (side) {
        case 'top':
          position = {
            x: -width / 2 + width * fraction,
            y: -height / 2 - offset,
          };
          facing = { x: 0, y: 1 };
          break;
        case 'right':
          position = {
            x: width / 2 + offset,
            y: -height / 2 + height * fraction,
          };
          facing = { x: -1, y: 0 };
          break;
        case 'bottom':
          position = {
            x: width / 2 - width * fraction,
            y: height / 2 + offset,
          };
          facing = { x: 0, y: -1 };
          break;
        case 'left':
          position = {
            x: -width / 2 - offset,
            y: height / 2 - height * fraction,
          };
          facing = { x: 1, y: 0 };
          break;
      }
      slots.push({ slotKey: `${side}:${index}`, position, facing });
    }
  }
  return slots;
}

function transformSeat(
  slot: LocalSeatSlot,
  center: Vector2,
  rotation: Matrix2D,
  adjustment?: TableSeatAdjustment,
): Pick<TableSeatSlot, 'position' | 'facingRadians'> {
  const rotatedPosition = transformVector(rotation, slot.position);
  const rotatedFacing = transformVector(rotation, slot.facing);
  const position = addVectors(
    addVectors(center, rotatedPosition),
    adjustment?.offset ?? { x: 0, y: 0 },
  );
  const facingRadians = Math.atan2(rotatedFacing.y, rotatedFacing.x);
  return {
    position,
    facingRadians:
      (facingRadians === -Math.PI ? Math.PI : facingRadians) +
      (adjustment?.facingOffsetRadians ?? 0),
  };
}

export function generateTableSeatSlots(
  table: TableGeometry,
  options: TableSeatGenerationOptions,
): TableSeatSlot[] {
  if (
    !Number.isFinite(table.center.x) ||
    !Number.isFinite(table.center.y) ||
    !Number.isFinite(table.rotationRadians)
  ) {
    throw new RangeError('Table position and rotation must be finite');
  }
  if (!Number.isFinite(options.seatOffset) || options.seatOffset < 0) {
    throw new RangeError('Seat offset must be finite and nonnegative');
  }

  let localSlots: LocalSeatSlot[];
  if (table.shape.kind === 'circle') {
    requirePositiveFinite(table.shape.radius, 'Table radius');
    requireSeatCount(table.shape.seatCount, 'Circular seat count');
    localSlots = createCircularSlots(
      table.shape.radius,
      table.shape.seatCount,
      options.seatOffset,
    );
  } else {
    requirePositiveFinite(table.shape.width, 'Table width');
    requirePositiveFinite(table.shape.height, 'Table height');
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      requireSeatCount(table.shape.seatsPerSide[side], `${side} seat count`);
    }
    localSlots = createRectangularSlots(table.shape, options.seatOffset);
  }

  const validKeys = new Set(localSlots.map(({ slotKey }) => slotKey));
  const skipped = new Set<string>();
  for (const key of options.skippedSlotKeys ?? []) {
    if (!validKeys.has(key) || skipped.has(key))
      throw new RangeError(`Invalid skipped table slot: ${key}`);
    skipped.add(key);
  }
  localSlots = localSlots.filter(({ slotKey }) => !skipped.has(slotKey));
  const numberingStart = options.numbering?.start ?? 1;
  if (!Number.isSafeInteger(numberingStart) || numberingStart < 1) {
    throw new RangeError('Numbering start must be a positive integer');
  }
  if (
    localSlots.length > 0 &&
    !Number.isSafeInteger(numberingStart + localSlots.length - 1)
  ) {
    throw new RangeError('Seat number exceeds safe integer range');
  }

  const adjustments = new Map<string, TableSeatAdjustment>();
  for (const adjustment of options.adjustments ?? []) {
    if (!validKeys.has(adjustment.slotKey)) {
      throw new RangeError(`Unknown table seat slot: ${adjustment.slotKey}`);
    }
    if (adjustments.has(adjustment.slotKey)) {
      throw new RangeError(
        `Duplicate table seat adjustment: ${adjustment.slotKey}`,
      );
    }
    if (
      (adjustment.offset !== undefined &&
        (!Number.isFinite(adjustment.offset.x) ||
          !Number.isFinite(adjustment.offset.y))) ||
      (adjustment.facingOffsetRadians !== undefined &&
        !Number.isFinite(adjustment.facingOffsetRadians))
    ) {
      throw new RangeError('Seat adjustment must be finite');
    }
    adjustments.set(adjustment.slotKey, adjustment);
  }

  const rotation = createRotationMatrix(table.rotationRadians);
  return localSlots.map((slot, slotIndex) => {
    const seatNumber =
      numberingStart +
      (options.numbering?.direction === 'reverse'
        ? localSlots.length - 1 - slotIndex
        : slotIndex);
    return {
      slotKey: slot.slotKey,
      slotIndex,
      label: `${options.numbering?.prefix ?? ''}${seatNumber}`,
      ...transformSeat(
        slot,
        table.center,
        rotation,
        adjustments.get(slot.slotKey),
      ),
    };
  });
}
