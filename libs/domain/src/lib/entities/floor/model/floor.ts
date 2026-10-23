import { z } from 'zod';
import {
  floorIdSchema,
  layoutVersionIdSchema,
} from '../../../shared/ids/index.js';

export const floorSchema = z.object({
  id: floorIdSchema,
  layoutVersionId: layoutVersionIdSchema,
  name: z.string().trim().min(1),
});

export type Floor = z.infer<typeof floorSchema>;
