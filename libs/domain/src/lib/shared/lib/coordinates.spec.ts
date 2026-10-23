import { describe, expect, it } from 'vitest';
import {
  calibrateWorldDistance,
  deviceToViewportPoint,
  deviceTransformSchema,
  pdfPointSchema,
  pdfToWorldPoint,
  pdfTransformSchema,
  viewportToDevicePoint,
  viewportToWorldPoint,
  viewportTransformSchema,
  worldDistanceInMillimeters,
  worldPointSchema,
  worldToPdfPoint,
  worldToViewportPoint,
} from './coordinates.js';

describe('coordinate transforms', () => {
  const pdfTransform = pdfTransformSchema.parse({
    position: { x: 100, y: 200 },
    pageHeight: 100,
    scale: 2,
    rotationRadians: Math.PI / 2,
  });

  const viewportTransform = viewportTransformSchema.parse({
    worldOrigin: { x: 50, y: 150 },
    pixelsPerWorldUnit: 4,
  });

  const deviceTransform = deviceTransformSchema.parse({ devicePixelRatio: 2 });

  it('flips the PDF Y axis and rotates into world coordinates', () => {
    const world = pdfToWorldPoint(
      pdfPointSchema.parse({ x: 10, y: 90 }),
      pdfTransform,
    );

    expect(world.x).toBeCloseTo(80);
    expect(world.y).toBeCloseTo(220);
  });

  it('round-trips PDF, world, viewport, and device coordinates', () => {
    const pdf = pdfPointSchema.parse({ x: 12, y: 36 });
    const world = pdfToWorldPoint(pdf, pdfTransform);
    const viewport = worldToViewportPoint(world, viewportTransform);
    const device = viewportToDevicePoint(viewport, deviceTransform);

    const restoredViewport = deviceToViewportPoint(device, deviceTransform);
    const restoredWorld = viewportToWorldPoint(
      restoredViewport,
      viewportTransform,
    );
    const restoredPdf = worldToPdfPoint(restoredWorld, pdfTransform);

    expect(restoredWorld.x).toBeCloseTo(world.x);
    expect(restoredWorld.y).toBeCloseTo(world.y);
    expect(restoredPdf.x).toBeCloseTo(pdf.x);
    expect(restoredPdf.y).toBeCloseTo(pdf.y);
  });

  it('maps the top left PDF corner to its world position without rotation', () => {
    const transform = pdfTransformSchema.parse({
      position: { x: 20, y: 30 },
      pageHeight: 200,
      scale: 3,
      rotationRadians: 0,
    });

    expect(
      pdfToWorldPoint(pdfPointSchema.parse({ x: 0, y: 200 }), transform),
    ).toEqual({ x: 20, y: 30 });
    expect(
      pdfToWorldPoint(pdfPointSchema.parse({ x: 0, y: 0 }), transform),
    ).toEqual({ x: 20, y: 630 });
  });

  it('rejects invalid points and transform scales', () => {
    expect(worldPointSchema.safeParse({ x: Infinity, y: 0 }).success).toBe(
      false,
    );
    expect(
      pdfTransformSchema.safeParse({ ...pdfTransform, scale: 0 }).success,
    ).toBe(false);
    expect(
      viewportTransformSchema.safeParse({
        ...viewportTransform,
        pixelsPerWorldUnit: 0,
      }).success,
    ).toBe(false);
    expect(
      deviceTransformSchema.safeParse({ devicePixelRatio: 0 }).success,
    ).toBe(false);
  });
});

describe('world distance calibration', () => {
  const first = worldPointSchema.parse({ x: 0, y: 0 });
  const second = worldPointSchema.parse({ x: 3, y: 4 });

  it('converts a measured world distance to millimeters', () => {
    const calibration = calibrateWorldDistance(first, second, 500);

    expect(calibration.millimetersPerWorldUnit).toBe(100);
    expect(worldDistanceInMillimeters(first, second, calibration)).toBe(500);
  });

  it('returns no physical distance without calibration', () => {
    expect(worldDistanceInMillimeters(first, second, null)).toBeNull();
  });

  it('rejects a zero-length reference or invalid physical distance', () => {
    expect(() => calibrateWorldDistance(first, first, 500)).toThrow();
    expect(() => calibrateWorldDistance(first, second, 0)).toThrow();
  });
});
