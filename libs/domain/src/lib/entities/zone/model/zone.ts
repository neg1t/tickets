import { z } from 'zod';
import { floorIdSchema, zoneIdSchema } from '../../../shared/ids/index.js';

export const zoneSchema = z.object({
  id: zoneIdSchema,
  floorId: floorIdSchema,
  name: z.string().trim().min(1),
});

export type Zone = z.infer<typeof zoneSchema>;
