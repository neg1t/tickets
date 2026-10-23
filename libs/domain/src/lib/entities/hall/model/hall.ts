import { z } from 'zod';
import { hallIdSchema, venueIdSchema } from '../../../shared/ids/index.js';

export const hallSchema = z.object({
  id: hallIdSchema,
  venueId: venueIdSchema,
  name: z.string().trim().min(1),
});

export type Hall = z.infer<typeof hallSchema>;
