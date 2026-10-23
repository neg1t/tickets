import { z } from 'zod';
import { worldPointSchema } from '../../../shared/lib/index.js';
import {
  floorIdSchema,
  tableIdSchema,
  zoneIdSchema,
} from '../../../shared/ids/index.js';

const seatCountSchema = z.number().int().nonnegative();

export const tableShapeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('circle'),
    radius: z.number().positive().finite(),
    seatCount: seatCountSchema,
  }),
  z.strictObject({
    kind: z.literal('rectangle'),
    width: z.number().positive().finite(),
    height: z.number().positive().finite(),
    seatsPerSide: z.strictObject({
      top: seatCountSchema,
      right: seatCountSchema,
      bottom: seatCountSchema,
      left: seatCountSchema,
    }),
  }),
]);

export const tableSchema = z.object({
  id: tableIdSchema,
  floorId: floorIdSchema,
  zoneId: zoneIdSchema.optional(),
  label: z.string().trim().min(1),
  // Dimensions use hall world units; rotation is in radians.
  center: worldPointSchema,
  rotationRadians: z.number().finite(),
  shape: tableShapeSchema,
});

export type TableShape = z.infer<typeof tableShapeSchema>;
export type Table = z.infer<typeof tableSchema>;
