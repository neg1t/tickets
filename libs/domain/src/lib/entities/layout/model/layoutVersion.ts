import { z } from 'zod';
import {
  layoutIdSchema,
  layoutVersionIdSchema,
  seatIdSchema,
  type LayoutVersionId,
  type SeatId,
} from '../../../shared/ids/index.js';
import {
  worldCalibrationSchema,
  type WorldCalibration,
} from '../../../shared/lib/coordinates.js';

const versionFields = {
  id: layoutVersionIdSchema,
  layoutId: layoutIdSchema,
  versionNumber: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  snapshotId: z.string().min(1),
  calibration: worldCalibrationSchema.nullable(),
};

const timestampSchema = z.iso.datetime({ offset: true });

export const draftLayoutVersionSchema = z.strictObject({
  ...versionFields,
  status: z.literal('draft'),
  publishedAt: z.null(),
});

export const publishedLayoutVersionSchema = z.strictObject({
  ...versionFields,
  status: z.literal('published'),
  publishedAt: timestampSchema,
});

export const archivedLayoutVersionSchema = z.strictObject({
  ...versionFields,
  status: z.literal('archived'),
  publishedAt: timestampSchema,
  archivedAt: timestampSchema,
});

export const layoutVersionSchema = z.discriminatedUnion('status', [
  draftLayoutVersionSchema,
  publishedLayoutVersionSchema,
  archivedLayoutVersionSchema,
]);

export type DraftLayoutVersion = z.infer<typeof draftLayoutVersionSchema>;
export type PublishedLayoutVersion = z.infer<
  typeof publishedLayoutVersionSchema
>;
export type ArchivedLayoutVersion = z.infer<typeof archivedLayoutVersionSchema>;
export type LayoutVersion = z.infer<typeof layoutVersionSchema>;

function assertRevision(
  version: LayoutVersion,
  expectedRevision: number,
): void {
  z.number().int().nonnegative().parse(expectedRevision);
  if (version.revision !== expectedRevision) {
    throw new Error('Layout version revision conflict');
  }
}

export function editDraftVersion(
  version: LayoutVersion,
  options: {
    expectedRevision: number;
    nextSnapshotId: string;
    calibration: WorldCalibration | null;
  },
): DraftLayoutVersion {
  if (version.status !== 'draft') {
    throw new Error('Only a draft layout version can be edited');
  }
  assertRevision(version, options.expectedRevision);
  if (options.nextSnapshotId === version.snapshotId) {
    throw new Error('Editing a draft requires a new snapshot');
  }

  return draftLayoutVersionSchema.parse({
    ...version,
    revision: version.revision + 1,
    snapshotId: options.nextSnapshotId,
    calibration: options.calibration,
  });
}

export function publishDraftVersion(
  version: LayoutVersion,
  options: {
    expectedRevision: number;
    latestPublishedVersionNumber: number;
    nextVersionId: LayoutVersionId;
    nextSnapshotId: string;
    publishedAt: string;
    soldSeatIds: readonly SeatId[];
    nextSeatIds: readonly SeatId[];
  },
): PublishedLayoutVersion {
  if (version.status !== 'draft') {
    throw new Error('Only a draft layout version can be published');
  }
  assertRevision(version, options.expectedRevision);
  z.number().int().nonnegative().parse(options.latestPublishedVersionNumber);
  layoutVersionIdSchema.parse(options.nextVersionId);
  if (options.nextVersionId === version.id) {
    throw new Error('Publication requires a new layout version ID');
  }
  if (options.nextSnapshotId === version.snapshotId) {
    throw new Error('Publication requires a new snapshot');
  }

  const nextSeatIds = new Set(
    options.nextSeatIds.map((id) => seatIdSchema.parse(id)),
  );
  if (nextSeatIds.size !== options.nextSeatIds.length) {
    throw new Error('Published seats must have unique IDs');
  }
  for (const soldSeatId of options.soldSeatIds) {
    if (!nextSeatIds.has(seatIdSchema.parse(soldSeatId))) {
      throw new Error('Publication cannot remove a sold seat ID');
    }
  }

  return publishedLayoutVersionSchema.parse({
    ...version,
    id: options.nextVersionId,
    versionNumber: options.latestPublishedVersionNumber + 1,
    revision: 0,
    snapshotId: options.nextSnapshotId,
    status: 'published',
    publishedAt: options.publishedAt,
  });
}

export function archivePublishedVersion(
  version: LayoutVersion,
  expectedRevision: number,
  archivedAt: string,
): ArchivedLayoutVersion {
  if (version.status !== 'published') {
    throw new Error('Only a published layout version can be archived');
  }
  assertRevision(version, expectedRevision);
  timestampSchema.parse(archivedAt);
  if (Date.parse(archivedAt) < Date.parse(version.publishedAt)) {
    throw new Error('A layout version cannot be archived before publication');
  }

  return archivedLayoutVersionSchema.parse({
    ...version,
    status: 'archived',
    revision: version.revision + 1,
    archivedAt,
  });
}

export function assertPublishedVersionForOccurrence(
  occurrenceLayoutVersionId: LayoutVersionId,
  version: LayoutVersion,
): PublishedLayoutVersion {
  if (
    version.status !== 'published' ||
    version.id !== occurrenceLayoutVersionId
  ) {
    throw new Error('Occurrence requires a matching published layout version');
  }
  return version;
}
