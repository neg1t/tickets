import { z } from 'zod';

const pointShape = {
  x: z.number().finite(),
  y: z.number().finite(),
};

// World, viewport, and device use a top-left origin with Y increasing down.
// PDF uses a bottom-left origin with Y increasing up.
export const worldPointSchema = z
  .strictObject(pointShape)
  .brand<'WorldPoint'>();
export const pdfPointSchema = z.strictObject(pointShape).brand<'PdfPoint'>();
export const viewportPointSchema = z
  .strictObject(pointShape)
  .brand<'ViewportPoint'>();
export const devicePointSchema = z
  .strictObject(pointShape)
  .brand<'DevicePoint'>();

export const pdfTransformSchema = z.strictObject({
  position: worldPointSchema,
  pageHeight: z.number().positive().finite(),
  scale: z.number().positive().finite(),
  rotationRadians: z.number().finite(),
});

export const viewportTransformSchema = z.strictObject({
  worldOrigin: worldPointSchema,
  pixelsPerWorldUnit: z.number().positive().finite(),
});

export const deviceTransformSchema = z.strictObject({
  devicePixelRatio: z.number().positive().finite(),
});

export const worldCalibrationSchema = z.strictObject({
  millimetersPerWorldUnit: z.number().positive().finite(),
});

export type WorldPoint = z.infer<typeof worldPointSchema>;
export type PdfPoint = z.infer<typeof pdfPointSchema>;
export type ViewportPoint = z.infer<typeof viewportPointSchema>;
export type DevicePoint = z.infer<typeof devicePointSchema>;
export type PdfTransform = z.infer<typeof pdfTransformSchema>;
export type ViewportTransform = z.infer<typeof viewportTransformSchema>;
export type DeviceTransform = z.infer<typeof deviceTransformSchema>;
export type WorldCalibration = z.infer<typeof worldCalibrationSchema>;

export function pdfToWorldPoint(
  point: PdfPoint,
  transform: PdfTransform,
): WorldPoint {
  const x = point.x * transform.scale;
  const y = (transform.pageHeight - point.y) * transform.scale;
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);

  return worldPointSchema.parse({
    x: transform.position.x + x * cosine - y * sine,
    y: transform.position.y + x * sine + y * cosine,
  });
}

export function worldToPdfPoint(
  point: WorldPoint,
  transform: PdfTransform,
): PdfPoint {
  const x = point.x - transform.position.x;
  const y = point.y - transform.position.y;
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);

  return pdfPointSchema.parse({
    x: (x * cosine + y * sine) / transform.scale,
    y: transform.pageHeight - (-x * sine + y * cosine) / transform.scale,
  });
}

export function worldToViewportPoint(
  point: WorldPoint,
  transform: ViewportTransform,
): ViewportPoint {
  return viewportPointSchema.parse({
    x: (point.x - transform.worldOrigin.x) * transform.pixelsPerWorldUnit,
    y: (point.y - transform.worldOrigin.y) * transform.pixelsPerWorldUnit,
  });
}

export function viewportToWorldPoint(
  point: ViewportPoint,
  transform: ViewportTransform,
): WorldPoint {
  return worldPointSchema.parse({
    x: point.x / transform.pixelsPerWorldUnit + transform.worldOrigin.x,
    y: point.y / transform.pixelsPerWorldUnit + transform.worldOrigin.y,
  });
}

export function viewportToDevicePoint(
  point: ViewportPoint,
  transform: DeviceTransform,
): DevicePoint {
  return devicePointSchema.parse({
    x: point.x * transform.devicePixelRatio,
    y: point.y * transform.devicePixelRatio,
  });
}

export function deviceToViewportPoint(
  point: DevicePoint,
  transform: DeviceTransform,
): ViewportPoint {
  return viewportPointSchema.parse({
    x: point.x / transform.devicePixelRatio,
    y: point.y / transform.devicePixelRatio,
  });
}

export function calibrateWorldDistance(
  first: WorldPoint,
  second: WorldPoint,
  knownMillimeters: number,
): WorldCalibration {
  z.number().positive().finite().parse(knownMillimeters);
  const worldDistance = Math.hypot(second.x - first.x, second.y - first.y);
  if (worldDistance === 0) {
    throw new Error('Calibration points must be different');
  }

  return worldCalibrationSchema.parse({
    millimetersPerWorldUnit: knownMillimeters / worldDistance,
  });
}

export function worldDistanceInMillimeters(
  first: WorldPoint,
  second: WorldPoint,
  calibration: WorldCalibration | null,
): number | null {
  if (calibration === null) return null;
  return (
    Math.hypot(second.x - first.x, second.y - first.y) *
    calibration.millimetersPerWorldUnit
  );
}
