import { z } from 'zod';
import {
  eventIdSchema,
  layoutVersionIdSchema,
  occurrenceIdSchema,
} from '../../../shared/ids/index.js';

export const occurrenceSchema = z.object({
  id: occurrenceIdSchema,
  eventId: eventIdSchema,
  layoutVersionId: layoutVersionIdSchema,
  startsAt: z.iso.datetime({ offset: true }),
});

export type Occurrence = z.infer<typeof occurrenceSchema>;
