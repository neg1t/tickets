import { z } from 'zod';
import { floorIdSchema, layoutVersionIdSchema } from '../shared/ids/index.js';
import {
  worldBoundsSchema,
  worldCalibrationSchema,
  type WorldBounds,
} from '../shared/lib/coordinates.js';
import { layoutSnapshotSchema, type LayoutSnapshot } from './layoutSnapshot.js';
import {
  CURRENT_DRAFT_SCHEMA_VERSION,
  migrateHallLayoutDraft,
} from './migrations.js';

export const pdfAssetSchema = z.strictObject({
  kind: z.literal('pdf'),
  name: z.string().min(1),
  dataUrl: z.string().startsWith('data:application/pdf;base64,'),
  pages: z
    .array(
      z.strictObject({
        width: z.number().positive().finite(),
        height: z.number().positive().finite(),
      }),
    )
    .min(1),
});

export type PdfAsset = z.infer<typeof pdfAssetSchema>;

const hallLayoutDraftSchema = z
  .strictObject({
    schemaVersion: z.literal(CURRENT_DRAFT_SCHEMA_VERSION),
    hallName: z.string().min(1),
    snapshot: layoutSnapshotSchema,
    zoneBounds: z.record(z.string(), worldBoundsSchema),
    assets: z.record(z.string(), pdfAssetSchema).default({}),
    calibration: worldCalibrationSchema.nullable().default(null),
  })
  .superRefine((draft, context) => {
    for (const background of draft.snapshot.backgrounds) {
      if (background.source.kind !== 'pdf') continue;
      const asset = draft.assets[background.source.assetId];
      if (!asset || background.source.pageNumber > asset.pages.length) {
        context.addIssue({
          code: 'custom',
          message: 'PDF background page is not available',
          path: ['snapshot', 'backgrounds'],
        });
      }
    }
    for (const id of Object.keys(draft.zoneBounds)) {
      if (!draft.snapshot.zones.some((zone) => zone.id === id)) {
        context.addIssue({
          code: 'custom',
          message: 'Zone bounds have no zone',
          path: ['zoneBounds', id],
        });
      }
    }
  });

export type HallLayoutDraft = Readonly<{
  schemaVersion: typeof CURRENT_DRAFT_SCHEMA_VERSION;
  hallName: string;
  snapshot: LayoutSnapshot;
  zoneBounds: Readonly<Record<string, WorldBounds>>;
  assets: Readonly<Record<string, PdfAsset>>;
  calibration: z.infer<typeof worldCalibrationSchema> | null;
}>;

export function parseHallLayoutDraft(value: unknown): HallLayoutDraft {
  return hallLayoutDraftSchema.parse(migrateHallLayoutDraft(value));
}

export function createEmptyDraft(hallName: string): HallLayoutDraft {
  const id = crypto.randomUUID();
  const versionId = layoutVersionIdSchema.parse(`version-${id}`);
  const floorId = floorIdSchema.parse(`floor-${id}`);
  return {
    schemaVersion: CURRENT_DRAFT_SCHEMA_VERSION,
    hallName: hallName.trim() || 'Новый зал',
    snapshot: layoutSnapshotSchema.parse({
      id: `snapshot-${id}`,
      layoutVersionId: versionId,
      floors: [
        { id: floorId, layoutVersionId: versionId, name: 'Основной этаж' },
      ],
      zones: [],
      rows: [],
      seats: [],
      tables: [],
      backgrounds: [],
      decorations: [],
    }),
    zoneBounds: {},
    assets: {},
    calibration: null,
  };
}

export function createDraftFromSnapshot(
  hallName: string,
  snapshot: LayoutSnapshot,
): HallLayoutDraft {
  return {
    schemaVersion: CURRENT_DRAFT_SCHEMA_VERSION,
    hallName,
    snapshot,
    zoneBounds: {},
    assets: {},
    calibration: null,
  };
}
