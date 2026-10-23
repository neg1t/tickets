import { z } from 'zod';
import { floorIdSchema, zoneIdSchema } from '../../../shared/ids/index.js';
import { worldPointSchema } from '../../../shared/lib/index.js';

export const zoneSchema = z
  .object({
    id: zoneIdSchema,
    floorId: floorIdSchema,
    name: z.string().trim().min(1),
    kind: z.enum(['seated', 'ga']).default('seated'),
    capacity: z.number().int().positive().optional(),
    polygon: z.array(worldPointSchema).min(3).optional(),
  })
  .superRefine((zone, context) => {
    if (zone.kind === 'ga' && zone.capacity === undefined)
      context.addIssue({
        code: 'custom',
        path: ['capacity'],
        message: 'GA zone requires capacity',
      });
  });

export type Zone = z.infer<typeof zoneSchema>;
