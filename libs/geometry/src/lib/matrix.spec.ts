import { describe, expect, it } from 'vitest';
import {
  createIdentityMatrix,
  createRotationMatrix,
  createScaleMatrix,
  createTranslationMatrix,
  invertMatrix,
  matrixDeterminant,
  multiplyMatrices,
  transformPoint,
  transformVector,
  type Matrix2D,
} from './matrix.js';

describe('2D affine matrices', () => {
  it('preserves points and vectors with the identity matrix', () => {
    const matrix: Matrix2D = createIdentityMatrix();
    const point = { x: 3, y: -4 };

    expect(transformPoint(matrix, point)).toEqual(point);
    expect(transformVector(matrix, point)).toEqual(point);
    expect(matrixDeterminant(matrix)).toBe(1);
  });

  it('translates points without translating direction vectors', () => {
    const translation = createTranslationMatrix({ x: 10, y: -3 });

    expect(transformPoint(translation, { x: 2, y: 4 })).toEqual({
      x: 12,
      y: 1,
    });
    expect(transformVector(translation, { x: 2, y: 4 })).toEqual({
      x: 2,
      y: 4,
    });
  });

  it('scales axes independently and rotates clockwise in Y-down coordinates', () => {
    const scaled = transformPoint(createScaleMatrix(2, -3), { x: 4, y: 5 });
    expect(scaled).toEqual({ x: 8, y: -15 });
    expect(matrixDeterminant(createScaleMatrix(2, -3))).toBe(-6);

    const rotated = transformPoint(createRotationMatrix(Math.PI / 2), {
      x: 1,
      y: 0,
    });
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);
  });

  it('applies the right matrix first when multiplying', () => {
    const translation = createTranslationMatrix({ x: 10, y: -2 });
    const scale = createScaleMatrix(2, 3);
    const point = { x: 1, y: 2 };

    expect(transformPoint(multiplyMatrices(translation, scale), point)).toEqual(
      {
        x: 12,
        y: 4,
      },
    );
    expect(transformPoint(multiplyMatrices(scale, translation), point)).toEqual(
      {
        x: 22,
        y: 0,
      },
    );
  });

  it('inverts a composed transform and rejects singular matrices', () => {
    const matrix = multiplyMatrices(
      createTranslationMatrix({ x: 10, y: -5 }),
      multiplyMatrices(createRotationMatrix(0.4), createScaleMatrix(2, 3)),
    );
    const inverse = invertMatrix(matrix);
    if (inverse === null) throw new Error('Expected an invertible matrix');

    const original = { x: 4, y: -7 };
    const restored = transformPoint(inverse, transformPoint(matrix, original));
    expect(restored.x).toBeCloseTo(original.x);
    expect(restored.y).toBeCloseTo(original.y);

    expect(invertMatrix(createScaleMatrix(0, 2))).toBeNull();
  });
});
