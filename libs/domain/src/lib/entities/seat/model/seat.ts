import { z } from 'zod';
import { worldPointSchema } from '../../../shared/lib/index.js';
import {
  floorIdSchema,
  rowIdSchema,
  seatIdSchema,
  tableIdSchema,
  zoneIdSchema,
} from '../../../shared/ids/index.js';

export const seatPlacementSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('standalone') }),
  z.strictObject({ kind: z.literal('row'), rowId: rowIdSchema }),
  z.strictObject({ kind: z.literal('table'), tableId: tableIdSchema }),
]);

export const seatSchema = z.object({
  id: seatIdSchema,
  floorId: floorIdSchema,
  zoneId: zoneIdSchema.optional(),
  label: z.string().trim().min(1),
  position: worldPointSchema,
  placement: seatPlacementSchema,
});

export type SeatPlacement = z.infer<typeof seatPlacementSchema>;
export type Seat = z.infer<typeof seatSchema>;
