import { z } from 'zod';
import { hallIdSchema, layoutIdSchema } from '../../../shared/ids/index.js';

export const layoutSchema = z.object({
  id: layoutIdSchema,
  hallId: hallIdSchema,
  name: z.string().trim().min(1),
});

export type Layout = z.infer<typeof layoutSchema>;
