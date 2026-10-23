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

export const rowGenerationSchema = z.object({
  distribution: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('even'),
      count: z.number().int().min(1).max(500),
    }),
    z.object({
      kind: z.literal('fixed'),
      count: z.number().int().min(1).max(500),
      step: z.number().positive().finite(),
    }),
  ]),
  startInset: z.number().nonnegative().finite().optional(),
  endInset: z.number().nonnegative().finite().optional(),
  gaps: z
    .array(
      z.object({
        afterSlot: z.number().int().nonnegative(),
        length: z.number().positive().finite(),
      }),
    )
    .optional(),
  skippedSlots: z.array(z.number().int().nonnegative()).optional(),
  numbering: z
    .object({
      start: z.number().int().positive().optional(),
      direction: z.enum(['forward', 'reverse']).optional(),
      skippedNumbers: z.array(z.number().int().positive()).optional(),
    })
    .optional(),
  adjustments: z
    .array(
      z.object({
        slotIndex: z.number().int().nonnegative(),
        offset: worldPointSchema.optional(),
        rotationOffsetRadians: z.number().finite().optional(),
      }),
    )
    .optional(),
});

export const rowSchema = z.object({
  id: rowIdSchema,
  floorId: floorIdSchema,
  zoneId: zoneIdSchema.optional(),
  name: z.string().trim().min(1),
  curve: rowCurveSchema,
  generation: rowGenerationSchema.optional(),
});

export type RowCurve = z.infer<typeof rowCurveSchema>;
export type Row = z.infer<typeof rowSchema>;
export type RowGeneration = z.infer<typeof rowGenerationSchema>;
