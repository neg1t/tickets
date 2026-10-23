import { z } from 'zod';
import { backgroundSchema } from '../entities/background/index.js';
import { floorSchema } from '../entities/floor/index.js';
import { hallSchema } from '../entities/hall/index.js';
import { layoutSchema, layoutVersionSchema } from '../entities/layout/index.js';
import { rowSchema } from '../entities/row/index.js';
import { seatSchema } from '../entities/seat/index.js';
import { tableSchema } from '../entities/table/index.js';
import { zoneSchema } from '../entities/zone/index.js';
import { layoutVersionIdSchema } from '../shared/ids/index.js';

export const layoutSnapshotSchema = z
  .strictObject({
    id: z.string().min(1),
    layoutVersionId: layoutVersionIdSchema,
    floors: z.array(floorSchema),
    zones: z.array(zoneSchema),
    rows: z.array(rowSchema),
    seats: z.array(seatSchema),
    tables: z.array(tableSchema),
    backgrounds: z.array(backgroundSchema),
  })
  .superRefine((snapshot, context) => {
    type Collection =
      'floors' | 'zones' | 'rows' | 'seats' | 'tables' | 'backgrounds';

    const addIssue = (path: (string | number)[], message: string): void => {
      context.addIssue({ code: 'custom', path, message });
    };

    const checkUniqueIds = (collection: Collection): void => {
      const seen = new Set<string>();
      snapshot[collection].forEach(({ id }, index) => {
        if (seen.has(id)) {
          addIssue([collection, index, 'id'], `Duplicate ${collection} ID`);
        }
        seen.add(id);
      });
    };

    const collections: Collection[] = [
      'floors',
      'zones',
      'rows',
      'seats',
      'tables',
      'backgrounds',
    ];
    collections.forEach(checkUniqueIds);

    const floorsById = new Map<string, (typeof snapshot.floors)[number]>(
      snapshot.floors.map((floor) => [floor.id, floor] as const),
    );
    const zonesById = new Map<string, (typeof snapshot.zones)[number]>(
      snapshot.zones.map((zone) => [zone.id, zone] as const),
    );
    const rowsById = new Map<string, (typeof snapshot.rows)[number]>(
      snapshot.rows.map((row) => [row.id, row] as const),
    );
    const tablesById = new Map<string, (typeof snapshot.tables)[number]>(
      snapshot.tables.map((table) => [table.id, table] as const),
    );

    snapshot.floors.forEach((floor, index) => {
      if (floor.layoutVersionId !== snapshot.layoutVersionId) {
        addIssue(
          ['floors', index, 'layoutVersionId'],
          'Floor belongs to another version',
        );
      }
    });

    snapshot.zones.forEach((zone, index) => {
      if (!floorsById.has(zone.floorId)) {
        addIssue(['zones', index, 'floorId'], 'Zone floor does not exist');
      }
    });

    const checkFloorAndZone = (
      item: { floorId: string; zoneId?: string | undefined },
      collection: Collection,
      index: number,
    ): void => {
      if (!floorsById.has(item.floorId)) {
        addIssue([collection, index, 'floorId'], 'Floor does not exist');
      }
      if (item.zoneId !== undefined) {
        const zone = zonesById.get(item.zoneId);
        if (!zone) {
          addIssue([collection, index, 'zoneId'], 'Zone does not exist');
        } else if (zone.floorId !== item.floorId) {
          addIssue(
            [collection, index, 'zoneId'],
            'Zone belongs to another floor',
          );
        }
      }
    };

    snapshot.rows.forEach((row, index) =>
      checkFloorAndZone(row, 'rows', index),
    );
    snapshot.tables.forEach((table, index) =>
      checkFloorAndZone(table, 'tables', index),
    );
    snapshot.seats.forEach((seat, index) => {
      checkFloorAndZone(seat, 'seats', index);

      if (seat.placement.kind === 'standalone') return;
      const parent =
        seat.placement.kind === 'row'
          ? rowsById.get(seat.placement.rowId)
          : tablesById.get(seat.placement.tableId);
      if (!parent) {
        addIssue(['seats', index, 'placement'], 'Seat parent does not exist');
      } else if (parent.floorId !== seat.floorId) {
        addIssue(
          ['seats', index, 'placement'],
          'Seat parent belongs to another floor',
        );
      } else if (
        parent.zoneId !== undefined &&
        seat.zoneId !== undefined &&
        parent.zoneId !== seat.zoneId
      ) {
        addIssue(
          ['seats', index, 'zoneId'],
          'Seat and parent belong to different zones',
        );
      }
    });

    snapshot.backgrounds.forEach((background, index) => {
      if (!floorsById.has(background.floorId)) {
        addIssue(
          ['backgrounds', index, 'floorId'],
          'Background floor does not exist',
        );
      }
    });
  });

export type LayoutSnapshot = z.infer<typeof layoutSnapshotSchema>;

export const layoutDocumentSchema = z
  .strictObject({
    hall: hallSchema,
    layout: layoutSchema,
    version: layoutVersionSchema,
    snapshot: layoutSnapshotSchema,
  })
  .superRefine(({ hall, layout, version, snapshot }, context) => {
    const checkLink = (
      matches: boolean,
      path: string[],
      message: string,
    ): void => {
      if (!matches) context.addIssue({ code: 'custom', path, message });
    };

    checkLink(
      layout.hallId === hall.id,
      ['layout', 'hallId'],
      'Layout hall does not match',
    );
    checkLink(
      version.layoutId === layout.id,
      ['version', 'layoutId'],
      'Version layout does not match',
    );
    checkLink(
      version.snapshotId === snapshot.id,
      ['version', 'snapshotId'],
      'Version snapshot does not match',
    );
    checkLink(
      snapshot.layoutVersionId === version.id,
      ['snapshot', 'layoutVersionId'],
      'Snapshot version does not match',
    );
  });

export type LayoutDocument = z.infer<typeof layoutDocumentSchema>;
