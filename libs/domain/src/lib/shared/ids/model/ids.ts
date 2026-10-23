import { z } from 'zod';

export const hallIdSchema = z.string().min(1).brand<'HallId'>();
export const venueIdSchema = z.string().min(1).brand<'VenueId'>();
export const layoutIdSchema = z.string().min(1).brand<'LayoutId'>();
export const layoutVersionIdSchema = z
  .string()
  .min(1)
  .brand<'LayoutVersionId'>();
export const floorIdSchema = z.string().min(1).brand<'FloorId'>();
export const zoneIdSchema = z.string().min(1).brand<'ZoneId'>();
export const rowIdSchema = z.string().min(1).brand<'RowId'>();
export const seatIdSchema = z.string().min(1).brand<'SeatId'>();
export const tableIdSchema = z.string().min(1).brand<'TableId'>();
export const backgroundIdSchema = z.string().min(1).brand<'BackgroundId'>();
export const decorationIdSchema = z.string().min(1).brand<'DecorationId'>();
export const eventIdSchema = z.string().min(1).brand<'EventId'>();
export const occurrenceIdSchema = z.string().min(1).brand<'OccurrenceId'>();

export type HallId = z.infer<typeof hallIdSchema>;
export type VenueId = z.infer<typeof venueIdSchema>;
export type LayoutId = z.infer<typeof layoutIdSchema>;
export type LayoutVersionId = z.infer<typeof layoutVersionIdSchema>;
export type FloorId = z.infer<typeof floorIdSchema>;
export type ZoneId = z.infer<typeof zoneIdSchema>;
export type RowId = z.infer<typeof rowIdSchema>;
export type SeatId = z.infer<typeof seatIdSchema>;
export type TableId = z.infer<typeof tableIdSchema>;
export type BackgroundId = z.infer<typeof backgroundIdSchema>;
export type DecorationId = z.infer<typeof decorationIdSchema>;
export type EventId = z.infer<typeof eventIdSchema>;
export type OccurrenceId = z.infer<typeof occurrenceIdSchema>;
