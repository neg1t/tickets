import { z } from 'zod';
import {
  decorationIdSchema,
  floorIdSchema,
} from '../../../shared/ids/index.js';
import { worldPointSchema } from '../../../shared/lib/index.js';

const common = { id: decorationIdSchema, floorId: floorIdSchema };

export const decorationSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('stage'),
    polygon: z.array(worldPointSchema).min(3),
    label: z.string().trim().optional(),
  }),
  z.object({
    ...common,
    kind: z.literal('obstacle'),
    polygon: z.array(worldPointSchema).min(3),
    label: z.string().trim().optional(),
  }),
  z.object({
    ...common,
    kind: z.literal('label'),
    position: worldPointSchema,
    text: z.string().trim().min(1),
  }),
]);

export type Decoration = z.infer<typeof decorationSchema>;
