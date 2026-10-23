import type { Vector2 } from './vector.js';

// x' = a*x + c*y + e; y' = b*x + d*y + f.
export type Matrix2D = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

export function createIdentityMatrix(): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function createTranslationMatrix(offset: Vector2): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: offset.x, f: offset.y };
}

export function createScaleMatrix(scaleX: number, scaleY: number): Matrix2D {
  return { a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 };
}

// Positive radians rotate clockwise when Y increases down.
export function createRotationMatrix(radians: number): Matrix2D {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0 };
}

// The right-hand transform is applied first.
export function multiplyMatrices(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function transformPoint(matrix: Matrix2D, point: Vector2): Vector2 {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function transformVector(matrix: Matrix2D, vector: Vector2): Vector2 {
  return {
    x: matrix.a * vector.x + matrix.c * vector.y,
    y: matrix.b * vector.x + matrix.d * vector.y,
  };
}

export function matrixDeterminant(matrix: Matrix2D): number {
  return matrix.a * matrix.d - matrix.b * matrix.c;
}

export function invertMatrix(matrix: Matrix2D): Matrix2D | null {
  const determinant = matrixDeterminant(matrix);
  if (determinant === 0 || !Number.isFinite(determinant)) return null;

  const inverse: Matrix2D = {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
  return Object.values(inverse).every(Number.isFinite) ? inverse : null;
}
