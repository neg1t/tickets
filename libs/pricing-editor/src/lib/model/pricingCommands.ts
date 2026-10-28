import type {
  PricingAssignmentDocument,
  PricingCatalog,
} from '@hall-platform/domain';
import { getPricingCatalogDiagnostics } from '@hall-platform/domain';
import type { PricingTargetResolution } from './resolvePricingTargets.js';

export type PricingAssignmentChange = Readonly<{
  targetKind: 'seat' | 'gaZone';
  targetId: string;
  previousSegmentId?: string;
  nextSegmentId?: string;
}>;

export type PricingCommand = Readonly<{
  id: string;
  type: 'assign' | 'clear';
  changes: readonly PricingAssignmentChange[];
}>;

export type PricingCommandContext = Readonly<{
  occurrenceId: string;
  layoutVersionId: string;
  catalog: PricingCatalog;
}>;

type SharedCommandInput = Readonly<{
  targets: PricingTargetResolution;
  context: PricingCommandContext;
  commandId?: string;
}>;

export type PricingCommandInput =
  | (SharedCommandInput &
      Readonly<{ type: 'assign'; segmentId: string }>)
  | (SharedCommandInput & Readonly<{ type: 'clear' }>);

export type PricingCommandError = Readonly<{
  code:
    | 'context_mismatch'
    | 'catalog_changed'
    | 'catalog_invalid'
    | 'invalid_targets'
    | 'segment_not_found'
    | 'segment_not_active'
    | 'empty_targets'
    | 'save_pending';
  message: string;
  diagnostics?: PricingTargetResolution['diagnostics'];
}>;

export type PricingCommandResult = Readonly<{
  document: PricingAssignmentDocument;
  changed: boolean;
  command?: PricingCommand;
  error?: PricingCommandError;
}>;

export type PricingHistory = Readonly<{
  past: readonly PricingCommand[];
  future: readonly PricingCommand[];
  bytes: number;
  truncated: boolean;
}>;

export type PricingHistoryLimits = Readonly<{
  maxCommands?: number;
  maxBytes?: number;
}>;

const maxHistoryCommands = 100;
const maxHistoryBytes = 32 * 1024 * 1024;

export const initialPricingHistory: PricingHistory = {
  past: [],
  future: [],
  bytes: 0,
  truncated: false,
};

function commandByteSize(command: PricingCommand): number {
  return new TextEncoder().encode(JSON.stringify(command.changes)).byteLength;
}

function applyChanges(
  document: PricingAssignmentDocument,
  command: PricingCommand,
  direction: 'previous' | 'next',
): PricingAssignmentDocument {
  const seatSegments = { ...document.assignments.seatSegments };
  const gaZoneSegments = { ...document.assignments.gaZoneSegments };
  for (const change of command.changes) {
    const assignments =
      change.targetKind === 'seat' ? seatSegments : gaZoneSegments;
    const segmentId =
      direction === 'previous'
        ? change.previousSegmentId
        : change.nextSegmentId;
    if (segmentId === undefined) delete assignments[change.targetId];
    else assignments[change.targetId] = segmentId;
  }
  return {
    ...document,
    assignments: { seatSegments, gaZoneSegments },
  };
}

export function executePricingCommand(
  document: PricingAssignmentDocument,
  input: PricingCommandInput,
): PricingCommandResult {
  if (
    document.occurrenceId !== input.context.occurrenceId ||
    document.layoutVersionId !== input.context.layoutVersionId ||
    input.context.catalog.occurrenceId !== input.context.occurrenceId
  ) {
    return {
      document,
      changed: false,
      error: {
        code: 'context_mismatch',
        message: 'The layout, catalog, and pricing assignments do not match.',
      },
    };
  }
  if (document.catalogRevision !== input.context.catalog.revision) {
    return {
      document,
      changed: false,
      error: {
        code: 'catalog_changed',
        message: 'Review the updated pricing catalog before applying changes.',
      },
    };
  }
  if (
    input.type === 'assign' &&
    getPricingCatalogDiagnostics(input.context.catalog).length > 0
  ) {
    return {
      document,
      changed: false,
      error: {
        code: 'catalog_invalid',
        message: 'Fix the pricing catalog currency before assigning segments.',
      },
    };
  }
  const errors = input.targets.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error',
  );
  if (errors.length > 0) {
    return {
      document,
      changed: false,
      error: {
        code: 'invalid_targets',
        message: 'Fix the selected target diagnostics before applying changes.',
        diagnostics: errors,
      },
    };
  }

  let nextSegmentId: string | undefined;
  if (input.type === 'assign') {
    const segment = input.context.catalog.items.find(
      ({ id }) => id === input.segmentId,
    );
    if (!segment) {
      return {
        document,
        changed: false,
        error: {
          code: 'segment_not_found',
          message: 'The selected pricing segment is no longer available.',
        },
      };
    }
    if (segment.status !== 'active') {
      return {
        document,
        changed: false,
        error: {
          code: 'segment_not_active',
          message: 'Archived pricing segments cannot be assigned.',
        },
      };
    }
    nextSegmentId = segment.id;
  }

  const changes: PricingAssignmentChange[] = [];
  for (const seatId of input.targets.seatIds) {
    const previousSegmentId = document.assignments.seatSegments[seatId];
    if (previousSegmentId === nextSegmentId) continue;
    changes.push({
      targetKind: 'seat',
      targetId: seatId,
      ...(previousSegmentId === undefined ? {} : { previousSegmentId }),
      ...(nextSegmentId === undefined ? {} : { nextSegmentId }),
    });
  }
  for (const zoneId of input.targets.gaZoneIds) {
    const previousSegmentId = document.assignments.gaZoneSegments[zoneId];
    if (previousSegmentId === nextSegmentId) continue;
    changes.push({
      targetKind: 'gaZone',
      targetId: zoneId,
      ...(previousSegmentId === undefined ? {} : { previousSegmentId }),
      ...(nextSegmentId === undefined ? {} : { nextSegmentId }),
    });
  }

  if (changes.length === 0) return { document, changed: false };
  const command: PricingCommand = {
    id: input.commandId ?? crypto.randomUUID(),
    type: input.type,
    changes,
  };
  return {
    document: applyChanges(document, command, 'next'),
    changed: true,
    command,
  };
}

export function pushPricingHistory(
  history: PricingHistory,
  command: PricingCommand,
  limits: PricingHistoryLimits = {},
): PricingHistory {
  const maxCommands = limits.maxCommands ?? maxHistoryCommands;
  const maxBytes = limits.maxBytes ?? maxHistoryBytes;
  const commandBytes = commandByteSize(command);
  const past = [...history.past, command];
  let bytes = history.bytes + commandBytes;
  let truncated = history.truncated;
  while (past.length > 1 && (past.length > maxCommands || bytes > maxBytes)) {
    const dropped = past.shift();
    if (dropped) bytes -= commandByteSize(dropped);
    truncated = true;
  }
  if (commandBytes > maxBytes) truncated = true;
  return {
    past,
    future: [],
    bytes,
    truncated,
  };
}

export function undoPricingCommand(
  document: PricingAssignmentDocument,
  history: PricingHistory,
): Readonly<{ document: PricingAssignmentDocument; history: PricingHistory }> {
  const command = history.past.at(-1);
  if (!command) return { document, history };
  const past = history.past.slice(0, -1);
  return {
    document: applyChanges(document, command, 'previous'),
    history: {
      ...history,
      past,
      future: [...history.future, command],
      bytes: Math.max(0, history.bytes - commandByteSize(command)),
    },
  };
}

export function redoPricingCommand(
  document: PricingAssignmentDocument,
  history: PricingHistory,
): Readonly<{ document: PricingAssignmentDocument; history: PricingHistory }> {
  const command = history.future.at(-1);
  if (!command) return { document, history };
  const future = history.future.slice(0, -1);
  const nextHistory = pushPricingHistory(
    { ...history, future },
    command,
  );
  return {
    document: applyChanges(document, command, 'next'),
    history: nextHistory,
  };
}
