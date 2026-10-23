import { z } from 'zod';
import { worldPointSchema } from '../../../shared/lib/index.js';
import {
  backgroundIdSchema,
  floorIdSchema,
} from '../../../shared/ids/index.js';

const assetIdSchema = z.string().min(1);

export const backgroundSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('pdf'),
    assetId: assetIdSchema,
    pageNumber: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal('image'),
    assetId: assetIdSchema,
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  }),
]);

export const backgroundSchema = z.object({
  id: backgroundIdSchema,
  floorId: floorIdSchema,
  order: z.number().int().nonnegative(),
  // Rotation is in radians.
  position: worldPointSchema,
  scale: z.number().positive().finite(),
  rotationRadians: z.number().finite(),
  opacity: z.number().min(0).max(1).finite(),
  visible: z.boolean(),
  locked: z.boolean(),
  source: backgroundSourceSchema,
});

export type BackgroundSource = z.infer<typeof backgroundSourceSchema>;
export type Background = z.infer<typeof backgroundSchema>;
