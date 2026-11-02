import { z } from 'zod';
import { decorationSchema, rowSchema, seatSchema, tableSchema, zoneSchema } from '@hall-platform/domain';
import { buyerApiVersionSchema } from './buyer.js';

const idSchema = z.string().min(1).max(200).refine((value) => value.trim() === value);
const boundsSchema = z.strictObject({
  minX: z.number().finite(),
  minY: z.number().finite(),
  maxX: z.number().finite(),
  maxY: z.number().finite(),
}).refine(({ minX, minY, maxX, maxY }) => minX <= maxX && minY <= maxY, {
  message: 'Bounds must be finite and ordered',
});
function containsBounds(outer: z.infer<typeof boundsSchema>, inner: z.infer<typeof boundsSchema>): boolean {
  return outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
}
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const geometryAssetSchema = z.strictObject({
  url: z.url({ protocol: /^https$/ }),
  byteLength: z.number().int().positive().max(32 * 1024 * 1024),
  sha256: sha256Schema,
});

export const buyerGeometryOverviewSchema = z.strictObject({
  bounds: boundsSchema,
  floors: z.array(z.strictObject({ id: idSchema, name: z.string().min(1) })).min(1),
  zones: z.array(zoneSchema),
});
export type BuyerGeometryOverview = z.infer<typeof buyerGeometryOverviewSchema>;

export const buyerGeometryBlockRefSchema = z.strictObject({
  id: idSchema,
  floorId: idSchema,
  sectorId: idSchema.optional(),
  bounds: boundsSchema,
  asset: geometryAssetSchema,
});
export type BuyerGeometryBlockRef = z.infer<typeof buyerGeometryBlockRefSchema>;

export const buyerGeometryManifestSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  occurrenceId: idSchema,
  layoutVersionId: idSchema,
  schemaVersion: z.literal(1),
  bounds: boundsSchema,
  overview: buyerGeometryOverviewSchema,
  blocks: z.array(buyerGeometryBlockRefSchema).min(1),
}).superRefine((manifest, context) => {
  if (!containsBounds(manifest.bounds, manifest.overview.bounds)) context.addIssue({
    code: 'custom', path: ['overview', 'bounds'], message: 'Overview bounds must fit inside manifest bounds',
  });
  const floorIds = new Set<string>();
  for (const [index, floor] of manifest.overview.floors.entries()) {
    if (floorIds.has(floor.id)) context.addIssue({ code: 'custom', path: ['overview', 'floors', index, 'id'], message: 'Duplicate floor ID' });
    floorIds.add(floor.id);
  }
  const zones = new Map<string, z.infer<typeof zoneSchema>>();
  manifest.overview.zones.forEach((zone, index) => {
    if (zones.has(zone.id)) context.addIssue({ code: 'custom', path: ['overview', 'zones', index, 'id'], message: 'Duplicate zone ID' });
    if (!floorIds.has(zone.floorId)) context.addIssue({ code: 'custom', path: ['overview', 'zones', index, 'floorId'], message: 'Overview zone belongs to an unknown floor' });
    zones.set(zone.id, zone);
  });
  const blockIds = new Set<string>();
  manifest.blocks.forEach((block, index) => {
    if (blockIds.has(block.id)) context.addIssue({ code: 'custom', path: ['blocks', index, 'id'], message: 'Duplicate geometry block ID' });
    if (!floorIds.has(block.floorId)) context.addIssue({ code: 'custom', path: ['blocks', index, 'floorId'], message: 'Geometry block belongs to an unknown floor' });
    if (!containsBounds(manifest.bounds, block.bounds)) context.addIssue({
      code: 'custom', path: ['blocks', index, 'bounds'], message: 'Geometry block bounds must fit inside manifest bounds',
    });
    if (block.sectorId) {
      const sector = zones.get(block.sectorId);
      if (!sector || sector.floorId !== block.floorId) context.addIssue({ code: 'custom', path: ['blocks', index, 'sectorId'], message: 'Geometry block sector does not belong to its floor' });
    }
    blockIds.add(block.id);
  });
});
export type BuyerGeometryManifest = z.infer<typeof buyerGeometryManifestSchema>;

export const buyerGeometryChunkSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  occurrenceId: idSchema,
  layoutVersionId: idSchema,
  blockId: idSchema,
  floorId: idSchema,
  rows: z.array(rowSchema),
  seats: z.array(seatSchema),
  tables: z.array(tableSchema),
  decorations: z.array(decorationSchema),
}).superRefine((chunk, context) => {
  const rows = new Set<string>();
  const tables = new Set<string>();
  const decorations = new Set<string>();
  for (const [index, row] of chunk.rows.entries()) {
    if (rows.has(row.id)) context.addIssue({ code: 'custom', path: ['rows', index, 'id'], message: 'Duplicate row ID in geometry block' });
    if (row.floorId !== chunk.floorId) context.addIssue({ code: 'custom', path: ['rows', index, 'floorId'], message: 'Row belongs to another floor' });
    rows.add(row.id);
  }
  for (const [index, table] of chunk.tables.entries()) {
    if (tables.has(table.id)) context.addIssue({ code: 'custom', path: ['tables', index, 'id'], message: 'Duplicate table ID in geometry block' });
    if (table.floorId !== chunk.floorId) context.addIssue({ code: 'custom', path: ['tables', index, 'floorId'], message: 'Table belongs to another floor' });
    tables.add(table.id);
  }
  const seatIds = new Set<string>();
  for (const [index, seat] of chunk.seats.entries()) {
    if (seatIds.has(seat.id)) context.addIssue({ code: 'custom', path: ['seats', index, 'id'], message: 'Duplicate seat ID in geometry block' });
    if (seat.floorId !== chunk.floorId) context.addIssue({ code: 'custom', path: ['seats', index, 'floorId'], message: 'Seat belongs to another floor' });
    if (seat.placement.kind === 'row' && !rows.has(seat.placement.rowId)) context.addIssue({ code: 'custom', path: ['seats', index, 'placement'], message: 'Seat row must be owned by the same block' });
    if (seat.placement.kind === 'table' && !tables.has(seat.placement.tableId)) context.addIssue({ code: 'custom', path: ['seats', index, 'placement'], message: 'Seat table must be owned by the same block' });
    seatIds.add(seat.id);
  }
  for (const [index, decoration] of chunk.decorations.entries()) {
    if (decorations.has(decoration.id)) context.addIssue({ code: 'custom', path: ['decorations', index, 'id'], message: 'Duplicate decoration ID in geometry block' });
    if (decoration.floorId !== chunk.floorId) context.addIssue({ code: 'custom', path: ['decorations', index, 'floorId'], message: 'Decoration belongs to another floor' });
    decorations.add(decoration.id);
  }
});
export type BuyerGeometryChunk = z.infer<typeof buyerGeometryChunkSchema>;
