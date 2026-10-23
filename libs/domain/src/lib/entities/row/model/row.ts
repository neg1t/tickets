import { z } from 'zod';
import { worldPointSchema } from '../../../shared/lib/index.js';
import {
  floorIdSchema,
  rowIdSchema,
  zoneIdSchema,
} from '../../../shared/ids/index.js';

// Radii are in hall world units; angles are in radians.
const angleSchema = z.number().finite();

export const rowCurveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('line'),
    start: worldPointSchema,
    end: worldPointSchema,
  }),
  z.object({
    kind: z.literal('arc'),
    center: worldPointSchema,
    radius: z.number().positive().finite(),
    startAngle: angleSchema,
    endAngle: angleSchema,
  }),
  z.object({
    kind: z.literal('bezier'),
    p0: worldPointSchema,
    p1: worldPointSchema,
    p2: worldPointSchema,
    p3: worldPointSchema,
  }),
  z.object({
    kind: z.literal('polyline'),
    points: z.array(worldPointSchema).min(2),
  }),
]);

export const rowSchema = z.object({
  id: rowIdSchema,
  floorId: floorIdSchema,
  zoneId: zoneIdSchema.optional(),
  name: z.string().trim().min(1),
  curve: rowCurveSchema,
});

export type RowCurve = z.infer<typeof rowCurveSchema>;
export type Row = z.infer<typeof rowSchema>;
