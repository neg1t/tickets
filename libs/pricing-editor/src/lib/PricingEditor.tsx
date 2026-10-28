import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useUnit } from 'effector-react';
import type {
  PricingAssignmentDocument,
  PricingCatalog,
  LayoutSnapshot,
} from '@hall-platform/domain';
import {
  formatPricingMoney,
  getPricingCatalogDiagnostics,
} from '@hall-platform/domain';
import type { SpatialBounds } from '@hall-platform/geometry';
import type { HallTarget } from '@hall-platform/renderer-core';
import { HallViewport } from '@hall-platform/hall-viewer';
import { createPricingModel, type PricingCommandMeta } from './model/pricingModel.js';
import {
  createPricingTargetResolver,
} from './model/resolvePricingTargets.js';
import { getPricingDiagnostics } from './model/pricingDiagnostics.js';
import { PricingSegmentList } from './ui/PricingSegmentList.js';
import { PricingToolbar } from './ui/PricingToolbar.js';
import { PricingZoneList } from './ui/PricingZoneList.js';
import { getPricingLabels } from './ui/pricingLabels.js';
import '../../styles.css';

export type PublishedPricingLayout = Readonly<{
  hallName: string;
  snapshot: LayoutSnapshot;
  zoneBounds?: Readonly<Record<string, SpatialBounds>>;
}>;

export type PricingEditorProps = Readonly<{
  layout: PublishedPricingLayout;
  value: PricingAssignmentDocument;
  catalog: PricingCatalog;
  onChange: (next: PricingAssignmentDocument, meta: PricingCommandMeta) => void;
  onSave?: (document: PricingAssignmentDocument) => void | Promise<void>;
  saving?: boolean;
  loading?: boolean;
  error?: string | Error | null;
  readonly?: boolean;
  locale?: string;
}>;

const selectablePricingKinds: readonly HallTarget['kind'][] = [
  'seat',
  'row',
  'table',
  'zone',
];

export function PricingEditor(props: PricingEditorProps) {
  const [model] = useState(() =>
    createPricingModel({ document: props.value, catalog: props.catalog }),
  );
  const state = useUnit(model.$state);
  const dirty = useUnit(model.$dirty);
  const canUndo = useUnit(model.$canUndo);
  const canRedo = useUnit(model.$canRedo);
  const labels = getPricingLabels(props.locale);
  const locale = props.locale ?? 'ru-RU';
  const readonly = props.readonly ?? false;
  const saving = props.saving ?? state.saving;
  const editorId = useId().replaceAll(':', '');
  const [selectedSegmentId, setSelectedSegmentId] = useState(
    () => props.catalog.items.find(({ status }) => status === 'active')?.id ?? '',
  );
  const [focusedFloorId, setFocusedFloorId] = useState(
    () => props.layout.snapshot.floors[0]?.id ?? '',
  );
  const [focusedZoneId, setFocusedZoneId] = useState<string | undefined>();
  const previousLayoutContext = useRef(
    `${props.value.occurrenceId}:${props.layout.snapshot.layoutVersionId}`,
  );

  useEffect(() => {
    model.receiveControlledValue({ document: props.value, catalog: props.catalog });
  }, [model, props.value, props.catalog]);

  useEffect(() => {
    const nextLayoutContext = `${props.value.occurrenceId}:${props.layout.snapshot.layoutVersionId}`;
    if (previousLayoutContext.current !== nextLayoutContext) {
      previousLayoutContext.current = nextLayoutContext;
      model.discardForServerDocument(props.value);
      setFocusedFloorId(props.layout.snapshot.floors[0]?.id ?? '');
      setFocusedZoneId(undefined);
    }
  }, [model, props.value, props.layout.snapshot.layoutVersionId, props.layout.snapshot.floors]);

  useEffect(() => model.setSaving(Boolean(props.saving)), [model, props.saving]);

  const effectiveSelectedSegmentId = state.catalog.items.some(
    ({ id, status }) => id === selectedSegmentId && status === 'active',
  )
    ? selectedSegmentId
    : (state.catalog.items.find(({ status }) => status === 'active')?.id ?? '');

  const resolver = useMemo(
    () => createPricingTargetResolver(props.layout.snapshot, props.layout.zoneBounds),
    [props.layout.snapshot, props.layout.zoneBounds],
  );
  const diagnostics = useMemo(
    () =>
      getPricingDiagnostics({
        snapshot: props.layout.snapshot,
        document: state.document,
        catalog: state.catalog,
        ...(props.layout.zoneBounds ? { zoneBounds: props.layout.zoneBounds } : {}),
        resolver,
      }),
    [props.layout.snapshot, props.layout.zoneBounds, resolver, state.document, state.catalog],
  );
  const selectedTargets = useMemo(
    () => resolver.resolveTargets(state.selection),
    [resolver, state.selection],
  );
  const catalogDiagnostics = useMemo(
    () => getPricingCatalogDiagnostics(state.catalog),
    [state.catalog],
  );

  const contextMismatch =
    state.document.occurrenceId !== state.catalog.occurrenceId ||
    state.document.occurrenceId !== props.value.occurrenceId ||
    state.document.layoutVersionId !== props.layout.snapshot.layoutVersionId;
  const catalogRevisionMismatch =
    state.document.catalogRevision !== state.catalog.revision;
  const validationErrors = diagnostics.assignmentIssues;
  const hasValidationErrors = validationErrors.length > 0 || catalogDiagnostics.length > 0;
  const selectedSegment = state.catalog.items.find(
    ({ id, status }) => id === effectiveSelectedSegmentId && status === 'active',
  );
  const assignmentPlan = useMemo(() => {
    let replacements = 0;
    let unchanged = 0;
    for (const seatId of selectedTargets.seatIds) {
      const current = state.document.assignments.seatSegments[seatId];
      const next = selectedSegment ? selectedSegment.id : undefined;
      if (current === next) unchanged += 1;
      else if (current !== undefined) replacements += 1;
    }
    for (const zoneId of selectedTargets.gaZoneIds) {
      const current = state.document.assignments.gaZoneSegments[zoneId];
      const next = selectedSegment ? selectedSegment.id : undefined;
      if (current === next) unchanged += 1;
      else if (current !== undefined) replacements += 1;
    }
    return { replacements, unchanged };
  }, [selectedTargets, selectedSegment, state.document.assignments]);
  const targetDisabled =
    readonly ||
    saving ||
    contextMismatch ||
    catalogRevisionMismatch ||
    selectedTargets.diagnostics.some(({ severity }) => severity === 'error') ||
    selectedTargets.seatIds.length + selectedTargets.gaZoneIds.length === 0;
  const assignDisabled = targetDisabled || catalogDiagnostics.length > 0 || !selectedSegment;
  const clearableCount =
    selectedTargets.seatIds.filter((seatId) => state.document.assignments.seatSegments[seatId] !== undefined).length +
    selectedTargets.gaZoneIds.filter((zoneId) => state.document.assignments.gaZoneSegments[zoneId] !== undefined).length;
  const clearDisabled = targetDisabled || clearableCount === 0;
  const saveDisabled =
    readonly || saving || !dirty || contextMismatch || catalogRevisionMismatch || hasValidationErrors;

  const seatAppearance = useMemo(() => {
    const appearance: Record<string, { fill: string; stroke: string }> = {};
    const colorBySegment = new Map(state.catalog.items.map(({ id, color }) => [id, color]));
    for (const [seatId, segmentId] of Object.entries(state.document.assignments.seatSegments)) {
      const color = colorBySegment.get(segmentId);
      if (color) appearance[seatId] = { fill: color, stroke: color };
    }
    return appearance;
  }, [state.catalog.items, state.document.assignments.seatSegments]);
  const zoneAppearance = useMemo(() => {
    const appearance: Record<string, { fill: string; stroke: string; opacity: number }> = {};
    const colorBySegment = new Map(state.catalog.items.map(({ id, color }) => [id, color]));
    for (const zone of props.layout.snapshot.zones) {
      const summary = diagnostics.zones.find(({ zoneId }) => zoneId === zone.id);
      const color = summary?.segmentId ? colorBySegment.get(summary.segmentId) : undefined;
      if (color && summary?.status !== 'mixed' && summary?.status !== 'partially_unassigned') {
        appearance[zone.id] = { fill: color, stroke: color, opacity: 0.26 };
      } else if (summary?.status === 'mixed' || summary?.status === 'partially_unassigned') {
        appearance[zone.id] = { fill: '#d49a28', stroke: '#a86c00', opacity: 0.32 };
      } else if (summary?.status === 'invalid') {
        appearance[zone.id] = { fill: '#d44d4d', stroke: '#a62828', opacity: 0.28 };
      } else {
        appearance[zone.id] = { fill: '#8b98a7', stroke: '#6b7785', opacity: 0.12 };
      }
    }
    return appearance;
  }, [diagnostics.zones, props.layout.snapshot.zones, state.catalog.items]);

  function publishChange(
    document: PricingAssignmentDocument,
    meta: PricingCommandMeta | null,
  ) {
    if (meta) props.onChange(document, meta);
  }

  function applyAssignment(kind: 'assign' | 'clear') {
    if (kind === 'assign' ? assignDisabled : clearDisabled) return;
    const result = kind === 'assign'
      ? model.assign(effectiveSelectedSegmentId, selectedTargets)
      : model.clear(selectedTargets);
    if (result.changed && result.command) {
      const changes = result.command.changes;
      publishChange(result.document, {
        id: result.command.id,
        operation: kind,
        affectedSeatCount: changes.filter(({ targetKind }) => targetKind === 'seat').length,
        affectedGaZoneCount: changes.filter(({ targetKind }) => targetKind === 'gaZone').length,
      });
    }
  }

  function undo() {
    const before = state.document;
    const document = model.undo();
    if (document !== before) publishChange(document, model.$state.getState().lastChange);
  }

  function redo() {
    const before = state.document;
    const document = model.redo();
    if (document !== before) publishChange(document, model.$state.getState().lastChange);
  }

  function acceptCatalogRevision() {
    const document = model.acceptCatalogRevision();
    if (document) publishChange(document, model.$state.getState().lastChange);
  }

  function selectZone(zoneId: string) {
    const zone = props.layout.snapshot.zones.find(({ id }) => id === zoneId);
    if (zone) setFocusedFloorId(zone.floorId);
    setFocusedZoneId(zoneId);
    model.selectTargets([{ kind: 'zone', id: zoneId }]);
  }

  const errorText = props.error instanceof Error ? props.error.message : props.error;
  const assignmentError = state.error?.message;
  const validationMessage = validationErrors[0]?.message ?? catalogDiagnostics[0]?.message;
  const viewerLabels = props.locale?.toLowerCase().startsWith('en')
    ? {
        hall: 'Hall plan', toolbar: 'Hall navigation', select: 'Select', pan: 'Pan',
        zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit', reset: '100%',
        zoomSelection: 'Zoom to selection', zone: 'Zone', zoomZone: 'Zoom to zone',
        allZones: 'All zones', floor: 'Floor', scale: 'Scale', selected: 'Selected',
      }
    : undefined;
  const selectedZoneId = state.selection.find(({ kind }) => kind === 'zone')?.id;

  return (
    <section className="pricing-editor" aria-label={`${labels.title}: ${props.layout.hallName}`}>
      <header className="pricing-editor__header">
        <div>
          <h1>{labels.title}</h1>
          <p>{props.layout.hallName}</p>
        </div>
        <div className="pricing-editor__header-actions">
          <span className={`pricing-editor__save-state${dirty ? ' is-dirty' : ''}`} role="status">
            {saving ? labels.saving : dirty ? labels.dirty : labels.clean}
          </span>
          {props.onSave && (
            <button type="button" className="pricing-editor__primary" disabled={saveDisabled} onClick={() => void props.onSave?.(state.document)}>
              {saving ? labels.saving : labels.save}
            </button>
          )}
        </div>
      </header>

      {props.loading && <p className="pricing-editor__notice" role="status">{labels.loading}</p>}
      {errorText && <p className="pricing-editor__notice pricing-editor__notice--error" role="alert">{errorText}</p>}
      {readonly && <p className="pricing-editor__notice">{labels.readonly}</p>}
      {contextMismatch && <p className="pricing-editor__notice pricing-editor__notice--error" role="alert">{labels.contextMismatch}</p>}
      {catalogRevisionMismatch && !contextMismatch && (
        <div className="pricing-editor__notice pricing-editor__notice--warning" role="alert">
          <span>{labels.catalogChanged}</span>
          <button type="button" disabled={readonly || saving} onClick={acceptCatalogRevision}>{labels.acceptCatalog}</button>
        </div>
      )}
      {validationMessage && !catalogRevisionMismatch && <p className="pricing-editor__notice pricing-editor__notice--error" role="alert">{validationMessage}</p>}
      {assignmentError && <p className="pricing-editor__notice pricing-editor__notice--error" role="alert">{assignmentError}</p>}
      {hasValidationErrors && dirty && <p className="pricing-editor__notice pricing-editor__notice--warning">{labels.invalidAssignments}</p>}

      <div className="pricing-editor__workspace">
        <main className="pricing-editor__map-column">
          <PricingToolbar
            labels={labels}
            canUndo={canUndo && !readonly && !saving}
            canRedo={canRedo && !readonly && !saving}
            onUndo={undo}
            onRedo={redo}
          />
          <div className="pricing-editor__map" aria-label={labels.title}>
            <HallViewport
              snapshot={props.layout.snapshot}
              hallName={props.layout.hallName}
              {...(props.layout.zoneBounds ? { zoneBounds: props.layout.zoneBounds } : {})}
              viewerMode="selection"
              selectableKinds={selectablePricingKinds}
              selectionOperation="replace"
              selectedTargets={state.selection}
              focusedFloorId={focusedFloorId}
              {...(focusedZoneId ? { focusedZoneId } : {})}
              zoneAppearance={zoneAppearance}
              seatAppearance={seatAppearance}
              {...(viewerLabels ? { labels: viewerLabels } : {})}
              height={500}
              fitKey={`${props.layout.snapshot.id}:${focusedFloorId}:${focusedZoneId ?? ''}`}
              stageId={`pricing-stage-${editorId}`}
              onFloorChange={(floorId) => {
                setFocusedFloorId(floorId);
                setFocusedZoneId(undefined);
                model.selectTargets([]);
              }}
              onSelectionChange={(selection) => model.selectTargets(selection)}
              onHoverTarget={() => undefined}
            />
          </div>
          {state.history.truncated && <p className="pricing-editor__muted" role="status">{labels.historyTruncated}</p>}
          {selectedTargets.diagnostics.filter(({ severity }) => severity === 'error').map((issue, index) => (
            <p key={`${issue.code}:${issue.targetId}:${index}`} className="pricing-editor__notice pricing-editor__notice--error" role="alert">{issue.message}</p>
          ))}
        </main>

        <aside className="pricing-editor__sidebar">
          <PricingSegmentList
            catalog={state.catalog}
            locale={locale}
            labels={labels}
            selectedSegmentId={effectiveSelectedSegmentId}
            disabled={readonly || saving || catalogRevisionMismatch || contextMismatch}
            onSelect={setSelectedSegmentId}
          />
          <div className="pricing-editor__actions">
            <label htmlFor={`pricing-segment-${editorId}`}>{labels.selectSegment}</label>
            <select
              id={`pricing-segment-${editorId}`}
              value={effectiveSelectedSegmentId}
              disabled={readonly || saving || catalogRevisionMismatch || contextMismatch || !selectedSegment}
              onChange={(event) => setSelectedSegmentId(event.currentTarget.value)}
            >
              {state.catalog.items.filter(({ status }) => status === 'active').map((segment) => (
                <option key={segment.id} value={segment.id}>{segment.name} · {formatPricingMoney(segment.price, locale)}</option>
              ))}
            </select>
            <button type="button" className="pricing-editor__primary" disabled={assignDisabled || selectedTargets.seatIds.length + selectedTargets.gaZoneIds.length === assignmentPlan.unchanged} onClick={() => applyAssignment('assign')}>
              {labels.assign}
            </button>
            <button type="button" disabled={clearDisabled} onClick={() => applyAssignment('clear')}>
              {labels.clear}
            </button>
          </div>
          <PricingZoneList
            snapshot={props.layout.snapshot}
            summaries={diagnostics.zones}
            labels={labels}
            {...(selectedZoneId ? { selectedZoneId } : {})}
            onSelect={selectZone}
          />
          <section className="pricing-editor__coverage" aria-label={labels.coverage}>
            <h2>{labels.coverage}</h2>
            <p>{labels.seatsCount(diagnostics.coverage.assignedSeats)} / {labels.seatsCount(diagnostics.coverage.totalSeats)}</p>
            <p>{labels.gaCount(diagnostics.coverage.assignedGaZones)} / {labels.gaCount(diagnostics.coverage.totalGaZones)}</p>
            <p>{labels.unassigned}: {diagnostics.coverage.unassignedSeats + diagnostics.coverage.unassignedGaZones}</p>
          </section>
        </aside>
      </div>
    </section>
  );
}
