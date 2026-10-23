import type { SpatialBounds } from '@hall-platform/geometry';
import { z } from 'zod';
import { floorIdSchema, layoutVersionIdSchema } from '../shared/ids/index.js';
import { worldCalibrationSchema } from '../shared/lib/coordinates.js';
import { layoutSnapshotSchema, type LayoutSnapshot } from './layoutSnapshot.js';

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

const boundsSchema = z
  .strictObject({
    minX: z.number().finite(),
    minY: z.number().finite(),
    maxX: z.number().finite(),
    maxY: z.number().finite(),
  })
  .refine((bounds) => bounds.minX < bounds.maxX && bounds.minY < bounds.maxY);

const hallLayoutDraftSchema = z
  .strictObject({
    hallName: z.string().min(1),
    snapshot: layoutSnapshotSchema,
    zoneBounds: z.record(z.string(), boundsSchema),
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
  hallName: string;
  snapshot: LayoutSnapshot;
  zoneBounds: Readonly<Record<string, SpatialBounds>>;
  assets: Readonly<Record<string, PdfAsset>>;
  calibration: z.infer<typeof worldCalibrationSchema> | null;
}>;

export function parseHallLayoutDraft(value: unknown): HallLayoutDraft {
  return hallLayoutDraftSchema.parse(value);
}

export function createEmptyDraft(hallName: string): HallLayoutDraft {
  const id = crypto.randomUUID();
  const versionId = layoutVersionIdSchema.parse(`version-${id}`);
  const floorId = floorIdSchema.parse(`floor-${id}`);
  return {
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
  return { hallName, snapshot, zoneBounds: {}, assets: {}, calibration: null };
}
