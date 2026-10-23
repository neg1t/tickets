import { z } from 'zod';
import {
  occurrenceIdSchema,
  seatIdSchema,
  zoneIdSchema,
} from '../../../shared/ids/index.js';

export const seatStatusSchema = z.enum([
  'available',
  'held',
  'sold',
  'blocked',
  'unavailable',
]);

export const seatInventorySchema = z.strictObject({
  seatId: seatIdSchema,
  status: seatStatusSchema,
});

const quantitySchema = z.number().int().nonnegative();

export const zoneInventorySchema = z
  .strictObject({
    zoneId: zoneIdSchema,
    capacity: quantitySchema,
    held: quantitySchema,
    sold: quantitySchema,
    blocked: quantitySchema,
  })
  .refine(
    ({ capacity, held, sold, blocked }) => held + sold + blocked <= capacity,
    {
      message: 'Reserved quantities exceed zone capacity',
    },
  );

export const inventorySchema = z
  .strictObject({
    occurrenceId: occurrenceIdSchema,
    seats: z.array(seatInventorySchema),
    zones: z.array(zoneInventorySchema),
  })
  .superRefine(({ seats, zones }, context) => {
    const seenSeatIds = new Set<string>();
    seats.forEach(({ seatId }, index) => {
      if (seenSeatIds.has(seatId)) {
        context.addIssue({
          code: 'custom',
          path: ['seats', index, 'seatId'],
          message: 'Duplicate seat ID',
        });
      }
      seenSeatIds.add(seatId);
    });

    const seenZoneIds = new Set<string>();
    zones.forEach(({ zoneId }, index) => {
      if (seenZoneIds.has(zoneId)) {
        context.addIssue({
          code: 'custom',
          path: ['zones', index, 'zoneId'],
          message: 'Duplicate zone ID',
        });
      }
      seenZoneIds.add(zoneId);
    });
  });

export type SeatStatus = z.infer<typeof seatStatusSchema>;
export type SeatInventory = z.infer<typeof seatInventorySchema>;
export type ZoneInventory = z.infer<typeof zoneInventorySchema>;
export type Inventory = z.infer<typeof inventorySchema>;
