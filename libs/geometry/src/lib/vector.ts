export type Vector2 = {
  readonly x: number;
  readonly y: number;
};

export function addVectors(first: Vector2, second: Vector2): Vector2 {
  return { x: first.x + second.x, y: first.y + second.y };
}

export function subtractVectors(first: Vector2, second: Vector2): Vector2 {
  return { x: first.x - second.x, y: first.y - second.y };
}

export function scaleVector(vector: Vector2, factor: number): Vector2 {
  return { x: vector.x * factor, y: vector.y * factor };
}

export function dotVectors(first: Vector2, second: Vector2): number {
  return first.x * second.x + first.y * second.y;
}

// With Y increasing down, a positive result means a clockwise turn.
export function crossVectors(first: Vector2, second: Vector2): number {
  return first.x * second.y - first.y * second.x;
}

export function vectorLengthSquared(vector: Vector2): number {
  return dotVectors(vector, vector);
}

export function vectorLength(vector: Vector2): number {
  return Math.hypot(vector.x, vector.y);
}

export function distanceBetweenVectors(
  first: Vector2,
  second: Vector2,
): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function normalizeVector(vector: Vector2): Vector2 | null {
  const length = vectorLength(vector);
  if (length === 0 || !Number.isFinite(length)) return null;
  return { x: vector.x / length, y: vector.y / length };
}

export function lerpVectors(
  first: Vector2,
  second: Vector2,
  fraction: number,
): Vector2 {
  return {
    x: first.x + (second.x - first.x) * fraction,
    y: first.y + (second.y - first.y) * fraction,
  };
}
