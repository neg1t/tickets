import { createEvent, createStore } from 'effector';
import type {
  PricingAssignmentDocument,
  PricingAssignments,
  PricingCatalog,
} from '@hall-platform/domain';
import type { HallTarget } from '@hall-platform/renderer-core';
import {
  executePricingCommand,
  initialPricingHistory,
  pushPricingHistory,
  redoPricingCommand,
  undoPricingCommand,
  type PricingCommandError,
  type PricingCommandResult,
  type PricingHistory,
} from './pricingCommands.js';
import type { PricingTargetResolution } from './resolvePricingTargets.js';

export type PricingPendingSave = Readonly<{
  idempotencyKey: string;
  baseRevision: number;
  body: Readonly<{
    layoutVersionId: string;
    catalogRevision: number;
    assignments: PricingAssignments;
  }>;
}>;

export type PricingCommandMeta = Readonly<{
  id: string;
  operation: 'assign' | 'clear' | 'undo' | 'redo' | 'catalogRevision';
  affectedSeatCount: number;
  affectedGaZoneCount: number;
}>;

export type PricingModelState = Readonly<{
  document: PricingAssignmentDocument;
  baseline: PricingAssignmentDocument;
  catalog: PricingCatalog;
  selection: readonly HallTarget[];
  history: PricingHistory;
  saving: boolean;
  pendingSave: PricingPendingSave | null;
  error: PricingCommandError | null;
  lastChange: PricingCommandMeta | null;
}>;

function equivalentValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return false;
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equivalentValue(item, right[index]))
    );
  }
  if (Array.isArray(right)) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        equivalentValue(leftRecord[key], rightRecord[key]),
    )
  );
}

function sameAssignments(
  first: PricingAssignmentDocument,
  second: PricingAssignmentDocument,
): boolean {
  return (
    first.catalogRevision === second.catalogRevision &&
    equivalentValue(first.assignments, second.assignments)
  );
}

function emptyState(
  document: PricingAssignmentDocument,
  catalog: PricingCatalog,
): PricingModelState {
  return {
    document,
    baseline: document,
    catalog,
    selection: [],
    history: initialPricingHistory,
    saving: false,
    pendingSave: null,
    error: null,
    lastChange: null,
  };
}

function commandContext(state: PricingModelState) {
  return {
    occurrenceId: state.document.occurrenceId,
    layoutVersionId: state.document.layoutVersionId,
    catalog: state.catalog,
  };
}

function metaFor(
  id: string,
  operation: PricingCommandMeta['operation'],
  seatCount: number,
  gaZoneCount: number,
): PricingCommandMeta {
  return { id, operation, affectedSeatCount: seatCount, affectedGaZoneCount: gaZoneCount };
}

function commandResult(
  state: PricingModelState,
  type: 'assign' | 'clear',
  segmentId: string | undefined,
  targets: PricingTargetResolution,
  commandId?: string,
): Readonly<{ state: PricingModelState; result: PricingCommandResult }> {
  if (state.pendingSave || state.saving) {
    return {
      state,
      result: {
        document: state.document,
        changed: false,
        error: {
          code: 'save_pending',
          message: 'Resolve the pending save before changing assignments.',
        },
      },
    };
  }
  const context = commandContext(state);
  const result =
    type === 'assign'
      ? executePricingCommand(state.document, {
          type,
          segmentId: segmentId ?? '',
          targets,
          context,
          ...(commandId === undefined ? {} : { commandId }),
        })
      : executePricingCommand(state.document, {
          type,
          targets,
          context,
          ...(commandId === undefined ? {} : { commandId }),
        });
  if (result.error) return { state: { ...state, error: result.error }, result };
  if (!result.command) return { state, result };
  const changes = result.command.changes;
  return {
    state: {
      ...state,
      document: result.document,
      history: pushPricingHistory(state.history, result.command),
      error: null,
      lastChange: metaFor(
        result.command.id,
        type,
        changes.filter(({ targetKind }) => targetKind === 'seat').length,
        changes.filter(({ targetKind }) => targetKind === 'gaZone').length,
      ),
    },
    result,
  };
}

export function createPricingModel(initial: {
  document: PricingAssignmentDocument;
  catalog: PricingCatalog;
}) {
  const stateChanged = createEvent<PricingModelState>();
  const selectionChanged = createEvent<readonly HallTarget[]>();
  const savingChanged = createEvent<boolean>();
  const pendingSaveChanged = createEvent<PricingPendingSave | null>();
  const errorChanged = createEvent<PricingCommandError | null>();
  const $state = createStore(emptyState(initial.document, initial.catalog))
    .on(stateChanged, (_, state) => state)
    .on(selectionChanged, (state, selection) => ({ ...state, selection }))
    .on(savingChanged, (state, saving) => ({ ...state, saving }))
    .on(pendingSaveChanged, (state, pendingSave) => ({
      ...state,
      pendingSave,
    }))
    .on(errorChanged, (state, error) => ({ ...state, error }));
  const $dirty = $state.map(
    ({ document, baseline }) => !sameAssignments(document, baseline),
  );
  const $canUndo = $state.map(
    ({ history, pendingSave, saving }) =>
      history.past.length > 0 && pendingSave === null && !saving,
  );
  const $canRedo = $state.map(
    ({ history, pendingSave, saving }) =>
      history.future.length > 0 && pendingSave === null && !saving,
  );

  function updateState(next: PricingModelState): void {
    if (next !== $state.getState()) stateChanged(next);
  }

  return {
    $state,
    $dirty,
    $canUndo,
    $canRedo,
    selectTargets(selection: readonly HallTarget[]) {
      selectionChanged(selection);
    },
    assign(
      segmentId: string,
      targets: PricingTargetResolution,
      commandId?: string,
    ): PricingCommandResult {
      const outcome = commandResult(
        $state.getState(),
        'assign',
        segmentId,
        targets,
        commandId,
      );
      updateState(outcome.state);
      return outcome.result;
    },
    clear(
      targets: PricingTargetResolution,
      commandId?: string,
    ): PricingCommandResult {
      const outcome = commandResult(
        $state.getState(),
        'clear',
        undefined,
        targets,
        commandId,
      );
      updateState(outcome.state);
      return outcome.result;
    },
    undo() {
      const state = $state.getState();
      if (state.saving || state.pendingSave) return state.document;
      const result = undoPricingCommand(state.document, state.history);
      const command = state.history.past.at(-1);
      updateState({
        ...state,
        document: result.document,
        history: result.history,
        lastChange: command
          ? metaFor(
              command.id,
              'undo',
              command.changes.filter(({ targetKind }) => targetKind === 'seat').length,
              command.changes.filter(({ targetKind }) => targetKind === 'gaZone').length,
            )
          : null,
        error: null,
      });
      return result.document;
    },
    redo() {
      const state = $state.getState();
      if (state.saving || state.pendingSave) return state.document;
      const command = state.history.future.at(-1);
      const result = redoPricingCommand(state.document, state.history);
      updateState({
        ...state,
        document: result.document,
        history: result.history,
        lastChange: command
          ? metaFor(
              command.id,
              'redo',
              command.changes.filter(({ targetKind }) => targetKind === 'seat').length,
              command.changes.filter(({ targetKind }) => targetKind === 'gaZone').length,
            )
          : null,
        error: null,
      });
      return result.document;
    },
    setSaving(saving: boolean) {
      savingChanged(saving);
    },
    setPendingSave(pendingSave: PricingPendingSave) {
      pendingSaveChanged(pendingSave);
    },
    resolvePendingSave() {
      pendingSaveChanged(null);
    },
    setError(error: PricingCommandError | null) {
      errorChanged(error);
    },
    updateCatalog(catalog: PricingCatalog) {
      const state = $state.getState();
      updateState({ ...state, catalog });
    },
    acceptCatalogRevision() {
      const state = $state.getState();
      const document = {
        ...state.document,
        catalogRevision: state.catalog.revision,
      };
      updateState({
        ...state,
        document,
        lastChange: metaFor(crypto.randomUUID(), 'catalogRevision', 0, 0),
      });
      return document;
    },
    acceptSavedDocument(document: PricingAssignmentDocument) {
      const state = $state.getState();
      updateState({
        ...state,
        document,
        baseline: document,
        history: initialPricingHistory,
        saving: false,
        pendingSave: null,
        error: null,
        lastChange: null,
      });
    },
    discardForServerDocument(document: PricingAssignmentDocument) {
      const state = $state.getState();
      updateState({
        ...emptyState(document, state.catalog),
        catalog: state.catalog,
      });
    },
    receiveControlledValue(input: {
      document: PricingAssignmentDocument;
      catalog: PricingCatalog;
    }) {
      const state = $state.getState();
      const contextChanged =
        input.document.occurrenceId !== state.document.occurrenceId ||
        input.document.layoutVersionId !== state.document.layoutVersionId;
      const serverRevisionChanged =
        input.document.revision !== state.baseline.revision;
      if (
        !contextChanged &&
        !serverRevisionChanged &&
        equivalentValue(input.document, state.document)
      ) {
        updateState({ ...state, catalog: input.catalog });
        return;
      }
      if (contextChanged || serverRevisionChanged) {
        updateState(emptyState(input.document, input.catalog));
        return;
      }
      if (equivalentValue(input.document, state.document)) {
        updateState({ ...state, catalog: input.catalog });
        return;
      }
      updateState(emptyState(input.document, input.catalog));
    },
  };
}
