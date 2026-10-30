import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  calibrateWorldDistance,
  worldPointSchema,
  type Background,
  type Decoration,
  type Row,
  type Seat,
  type Table,
  type Zone,
} from '@hall-platform/domain';
import type { Vector2 } from '@hall-platform/geometry';
import type { HallTarget } from '@hall-platform/renderer-core';
import type { RendererPreference } from '@hall-platform/hall-viewer';
import {
  buildHallScene,
  type PolygonEditMode,
} from '@hall-platform/renderer-konva';

import type { EditorCommand } from './editorCommands.js';
import type { HallLayoutDraft } from './editorDraft.js';
import { useEditorController } from './useEditorController.js';
import { usePdfImport } from './import/usePdfImport.js';
import { PdfHallViewer } from './PdfHallViewer.js';
import {
  RowGenerationControls,
  TableGenerationControls,
} from './ui/GenerationControls.js';
import { EditorStructure } from './ui/EditorStructure.js';
import { ToolsPanel, editorTools } from './ui/ToolsPanel.js';
import { PropertiesPanel, PropertyField } from './ui/PropertiesPanel.js';
import { LayersPanel } from './ui/LayersPanel.js';
import { toggleEditorPanel, type EditorPanel } from './ui/editorPanels.js';
import { useCanvasHeight } from './ui/useCanvasHeight.js';
import {
  EditorLocaleContext,
  editorText,
  translateEditorError,
} from './ui/editorI18n.js';
import {
  expandObjectTargetKeys,
  hallTargetKey,
} from './ui/editorStructureModel.js';
import {
  alignTargets,
  createObjectAt,
  createStarterTemplate,
  deleteTargets,
  distributeTargets,
  duplicateTargets,
  moveTargets,
  selectionCenterValues,
  setSelectionCenter,
  type EditorTool,
} from './editorOperations.js';
import { preserveSeatManualAdjustment } from './commands/regenerateSeats.js';
import {
  createFloor,
  deleteFloor,
  renameFloor,
} from './commands/structureOperations.js';
import { useLayoutDiagnostics } from './validation/useLayoutDiagnostics.js';
import { transformRow, transformTable } from './commands/transformSelection.js';
import { editHandle } from './commands/handleOperations.js';
import {
  backgroundScaleFromPercent,
  backgroundScaleForDistance,
  backgroundScalePercent,
  scaleBackgroundAroundCenter,
} from './background/backgroundScale.js';
import { BackgroundScaleControl } from './ui/BackgroundScaleControl.js';

const noObjectTreeKeys: ReadonlySet<string> = new Set();

function MobilePanelIcon({
  name,
}: {
  readonly name: 'select' | 'row' | 'tools' | 'layers' | 'properties';
}) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.7,
  };
  switch (name) {
    case 'select':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" {...common}>
          <path d="M5 3.5 18 14l-5.3 1.1L15 21l-2.2 1-2.4-5.8L7 20z" />
        </svg>
      );
    case 'row':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" {...common}>
          <path d="M4 6h16M4 12h16M4 18h16" />
          <circle cx="7" cy="6" r="1" />
          <circle cx="12" cy="6" r="1" />
          <circle cx="17" cy="6" r="1" />
        </svg>
      );
    case 'tools':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" {...common}>
          <path d="M5 5h14v14H5zM9 5v14m6-14v14M5 10h14m-14 5h14" />
        </svg>
      );
    case 'layers':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" {...common}>
          <path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" />
        </svg>
      );
    case 'properties':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" {...common}>
          <path d="M5 5h14v14H5zM9 9h6m-6 4h6m-6 4h4" />
        </svg>
      );
  }
}

export type EditorChangeMeta = Readonly<{
  kind: EditorCommand['kind'] | 'undo' | 'redo';
  target: HallTarget | null;
}>;

export type HallEditorProps = {
  readonly value: HallLayoutDraft;
  readonly locale?: string;
  readonly readonly?: boolean;
  readonly saving?: boolean;
  readonly onChange: (layout: HallLayoutDraft, meta: EditorChangeMeta) => void;
  readonly onSave?: (layout: HallLayoutDraft) => void | Promise<void>;
  readonly onPublish?: (
    layout: HallLayoutDraft,
    warningsAcknowledged: boolean,
  ) => void | Promise<void>;
  readonly onError?: (error: Error) => void;
  readonly publishedSeatIds?: readonly Seat['id'][];
  readonly rendererPreference?: RendererPreference;
  readonly webglEnabled?: boolean;
};

export function HallEditor(props: HallEditorProps) {
  const {
    value,
    locale,
    readonly = false,
    saving = false,
    onChange,
    onSave,
    onPublish,
    onError,
    publishedSeatIds = [],
    rendererPreference = 'auto',
    webglEnabled = false,
  } = props;
  const tr = (russian: string) => editorText(locale, russian);
  const { model, state, draft, selection, tool, zoneId, backgroundId } =
    useEditorController(value);
  const clipboardRef = useRef<{
    draft: HallLayoutDraft;
    targets: readonly HallTarget[];
    pasteCount: number;
  } | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const controlledValueRef = useRef(value);
  const [mobilePanel, setMobilePanel] = useState<EditorPanel | null>(null);
  const [objectTreeState, setObjectTreeState] = useState(() => ({
    snapshotId: value.snapshot.id,
    hidden: noObjectTreeKeys,
    locked: noObjectTreeKeys,
  }));
  const directHiddenKeys =
    objectTreeState.snapshotId === draft.snapshot.id
      ? objectTreeState.hidden
      : noObjectTreeKeys;
  const directLockedKeys =
    objectTreeState.snapshotId === draft.snapshot.id
      ? objectTreeState.locked
      : noObjectTreeKeys;
  const effectiveHiddenKeys = useMemo(
    () => expandObjectTargetKeys(draft.snapshot, directHiddenKeys),
    [draft.snapshot, directHiddenKeys],
  );
  const effectiveLockedKeys = useMemo(
    () => expandObjectTargetKeys(draft.snapshot, directLockedKeys),
    [draft.snapshot, directLockedKeys],
  );
  const selectionLocked = selection.some((target) =>
    effectiveLockedKeys.has(hallTargetKey(target)),
  );
  const { setElement: setCanvasElement, height: canvasHeight } =
    useCanvasHeight();
  const [floorId, setFloorId] = useState(value.snapshot.floors[0]?.id ?? '');
  const [knownMillimeters, setKnownMillimeters] = useState(1000);
  const [polygonEditState, setPolygonEditState] = useState<{
    readonly targetKey: string;
    readonly mode: PolygonEditMode;
  }>({ targetKey: '', mode: 'move' });
  const [calibrationFirst, setCalibrationFirst] = useState<Vector2 | null>(
    null,
  );
  const [calibrationHover, setCalibrationHover] = useState<Vector2 | null>(
    null,
  );
  const [backgroundFitTarget, setBackgroundFitTarget] = useState<number | null>(null);
  const [backgroundFitFirst, setBackgroundFitFirst] = useState<Vector2 | null>(null);
  const [backgroundScalePreview, setBackgroundScalePreview] = useState<{
    backgroundId: string;
    percent: number | null;
  }>({ backgroundId: '', percent: null });
  const [previewState, setPreviewState] = useState<{
    key: string;
    seats: readonly Vector2[];
  }>({ key: '', seats: [] });
  const [warningAcknowledgement, setWarningAcknowledgement] = useState<
    HallLayoutDraft['snapshot'] | null
  >(null);
  const diagnostics = useLayoutDiagnostics(draft, {
    ...(onError ? { onError } : {}),
    getLatestDraft: () => model.$state.getState().draft,
  });
  const {
    errorMessage,
    report,
    clearError,
    issues: validationIssues,
    hasCurrentFullValidation,
    validationPending,
    hasBlockingIssues,
    hasWarnings,
    validateLatest,
  } = diagnostics;
  const warningsAcknowledged = warningAcknowledgement === draft.snapshot;
  const activeFloorId = draft.snapshot.floors.some(
    (floor) => floor.id === floorId,
  )
    ? floorId
    : (draft.snapshot.floors[0]?.id ?? '');
  function toggleObjectVisibility(target: HallTarget) {
    const key = hallTargetKey(target);
    const nextDirect = new Set(directHiddenKeys);
    if (nextDirect.has(key)) nextDirect.delete(key);
    else nextDirect.add(key);
    setObjectTreeState((current) => ({
      snapshotId: draft.snapshot.id,
      hidden: nextDirect,
      locked:
        current.snapshotId === draft.snapshot.id
          ? current.locked
          : noObjectTreeKeys,
    }));
    const nextHidden = expandObjectTargetKeys(draft.snapshot, nextDirect);
    const nextSelection = selection.filter(
      (selected) => !nextHidden.has(hallTargetKey(selected)),
    );
    if (nextSelection.length !== selection.length)
      model.selectionChanged(nextSelection);
  }
  function toggleObjectLock(target: HallTarget) {
    const key = hallTargetKey(target);
    setObjectTreeState((current) => {
      const next = new Set(
        current.snapshotId === draft.snapshot.id
          ? current.locked
          : noObjectTreeKeys,
      );
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return {
        snapshotId: draft.snapshot.id,
        hidden:
          current.snapshotId === draft.snapshot.id
            ? current.hidden
            : noObjectTreeKeys,
        locked: next,
      };
    });
  }
  const {
    inputRef: pdfInputRef,
    importing: importingPdf,
    cancel: cancelPdfImport,
    importPdf: handlePdfImport,
  } = usePdfImport({
    ...(locale !== undefined ? { locale } : {}),
    getContext: () => ({
      draft: model.$state.getState().draft,
      externalValue: controlledValueRef.current,
      activeFloorId,
      readonly,
    }),
    commit,
    onImported: (backgroundId) => {
      model.backgroundChanged(backgroundId);
      model.selectionChanged([]);
      model.toolChanged('select');
    },
    report,
  });
  const target = selection[0] ?? null;
  const targetKey = target ? `${target.kind}:${target.id}` : '';
  const polygonEditSelectionKey = `${targetKey}:${selection.length}`;
  const polygonEditMode =
    polygonEditState.targetKey === polygonEditSelectionKey
      ? polygonEditState.mode
      : 'move';
  function setPolygonEditMode(mode: PolygonEditMode) {
    setPolygonEditState({ targetKey: polygonEditSelectionKey, mode });
  }
  const previewSeats = previewState.key === targetKey ? previewState.seats : [];
  const handlePreview = useCallback(
    (seats: readonly Vector2[]) => setPreviewState({ key: targetKey, seats }),
    [targetKey],
  );
  const background =
    draft.snapshot.backgrounds.find((item) => item.id === backgroundId) ?? null;
  const previewPercent = backgroundScalePreview.backgroundId === background?.id
    ? backgroundScalePreview.percent
    : null;
  const viewerDraft = useMemo(() => {
    if (!background || previewPercent === null || readonly || background.locked)
      return draft;
    try {
      const referenceScale = background.referenceScale ?? background.scale;
      const scale = backgroundScaleFromPercent(referenceScale, previewPercent);
      const asset = draft.assets[background.source.assetId];
      const pageNumber = background.source.kind === 'pdf' ? background.source.pageNumber : 0;
      const pageSize = asset?.pages[pageNumber - 1];
      return {
        ...draft,
        snapshot: {
          ...draft.snapshot,
          backgrounds: draft.snapshot.backgrounds.map((item) => item.id !== background.id
            ? item
            : {
                ...item,
                referenceScale,
                scale,
                ...(pageSize
                  ? {
                      position: worldPointSchema.parse(scaleBackgroundAroundCenter(
                        background.position,
                        background.scale,
                        scale,
                        pageSize,
                        background.rotationRadians,
                      )),
                    }
                  : {}),
              }),
        },
      };
    } catch {
      return draft;
    }
  }, [background, draft, previewPercent, readonly]);

  useEffect(() => {
    if (controlledValueRef.current !== value) {
      cancelPdfImport();
      controlledValueRef.current = value;
    }
    model.replace(value);
  }, [model, value, cancelPdfImport]);

  function clearCalibration() {
    setCalibrationFirst(null);
    setCalibrationHover(null);
  }

  function selectTool(next: EditorTool) {
    if (next !== tool) {
      clearCalibration();
      setBackgroundFitTarget(null);
      setBackgroundFitFirst(null);
    }
    model.toolChanged(next);
    if (next !== 'select') setPolygonEditMode('move');
    setMobilePanel(null);
  }

  function selectFloor(nextFloorId: string) {
    if (nextFloorId !== activeFloorId) cancelPdfImport();
    setFloorId(nextFloorId);
    model.selectionChanged([]);
    model.zoneChanged('');
    model.backgroundChanged('');
    clearCalibration();
  }

  function commit(
    command: EditorCommand,
    selected: HallTarget | null = target,
  ) {
    if (readonly || command.patches.length === 0) return false;
    if (
      (selected && effectiveLockedKeys.has(hallTargetKey(selected))) ||
      selection.some((item) => effectiveLockedKeys.has(hallTargetKey(item)))
    )
      return false;
    try {
      cancelPdfImport();
      const next = model.commit(command);
      clearError();
      onChange(next.draft, { kind: command.kind, target: selected });
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }

  function handleUndo() {
    if (readonly || state.past.length === 0) return;
    try {
      cancelPdfImport();
      const next = model.undo();
      model.selectionChanged([]);
      if (
        zoneId &&
        !next.draft.snapshot.zones.some((zone) => zone.id === zoneId)
      )
        model.zoneChanged('');
      if (
        backgroundId &&
        !next.draft.snapshot.backgrounds.some(
          (item) => item.id === backgroundId,
        )
      )
        model.backgroundChanged('');
      clearError();
      onChange(next.draft, { kind: 'undo', target: null });
    } catch (error) {
      report(error);
    }
  }

  function handleRedo() {
    if (readonly || state.future.length === 0) return;
    try {
      cancelPdfImport();
      const next = model.redo();
      model.selectionChanged([]);
      if (
        zoneId &&
        !next.draft.snapshot.zones.some((zone) => zone.id === zoneId)
      )
        model.zoneChanged('');
      if (
        backgroundId &&
        !next.draft.snapshot.backgrounds.some(
          (item) => item.id === backgroundId,
        )
      )
        model.backgroundChanged('');
      clearError();
      onChange(next.draft, { kind: 'redo', target: null });
    } catch (error) {
      report(error);
    }
  }

  function handleCanvasClick(point: Vector2) {
    if (readonly) return;
    if (backgroundFitTarget !== null && background) {
      if (!backgroundFitFirst) {
        setBackgroundFitFirst(point);
        return;
      }
      const measuredDistance = Math.hypot(point.x - backgroundFitFirst.x, point.y - backgroundFitFirst.y);
      try {
        const nextScale = backgroundScaleForDistance(background.scale, measuredDistance, backgroundFitTarget);
        const asset = draft.assets[background.source.assetId];
        const pageNumber = background.source.kind === 'pdf' ? background.source.pageNumber : 0;
        const pageSize = asset?.pages[pageNumber - 1];
        updateBackground({
          ...background,
          referenceScale: background.referenceScale ?? background.scale,
          scale: nextScale,
          ...(pageSize ? { position: worldPointSchema.parse(scaleBackgroundAroundCenter(background.position, background.scale, nextScale, pageSize, background.rotationRadians)) } : {}),
        });
        setBackgroundFitTarget(null);
        setBackgroundFitFirst(null);
        model.toolChanged('select');
      } catch (error) {
        report(error);
      }
      return;
    }
    if (tool === 'select' || tool === 'pan') return;
    try {
      if (tool === 'calibrate') {
        if (!calibrationFirst) {
          setCalibrationFirst(point);
          return;
        }
        const after = calibrateWorldDistance(
          worldPointSchema.parse(calibrationFirst),
          worldPointSchema.parse(point),
          knownMillimeters,
        );
        if (
          commit(
            {
              kind: 'update',
              patches: [
                { collection: 'calibration', before: draft.calibration, after },
              ],
            },
            null,
          )
        ) {
          setCalibrationFirst(null);
          setCalibrationHover(null);
          model.toolChanged('select');
        }
        return;
      }
      const created = createObjectAt(
        draft,
        tool,
        point,
        zoneId || undefined,
        activeFloorId,
        publishedSeatIds,
      );
      if (!commit(created.command, created.target)) return;
      model.selectionChanged([created.target]);
      model.backgroundChanged('');
      model.toolChanged('select');
      if (created.target.kind === 'zone') model.zoneChanged(created.target.id);
    } catch (error) {
      report(error);
    }
  }

  function handleMove(moved: readonly HallTarget[], delta: Vector2) {
    commit(
      moveTargets(draft, moved, delta, publishedSeatIds),
      moved[0] ?? null,
    );
  }

  function handleEmptyAction(
    action: 'template' | 'row-line' | 'table-circle' | 'pdf',
  ) {
    if (readonly) return;
    if (action === 'pdf') {
      pdfInputRef.current?.click();
      return;
    }
    try {
      const created =
        action === 'template'
          ? createStarterTemplate(draft, activeFloorId)
          : createObjectAt(
              draft,
              action,
              { x: 0, y: 0 },
              zoneId || undefined,
              activeFloorId,
              publishedSeatIds,
            );
      if (commit(created.command, created.target)) {
        model.selectionChanged([created.target]);
        model.toolChanged('select');
      }
    } catch (error) {
      report(error);
    }
  }

  function updateBackground(after: Background) {
    if (!background) return;
    if (background.locked && after.locked) return;
    commit(
      {
        kind: 'update',
        patches: [
          {
            collection: 'backgrounds',
            id: background.id,
            before: background,
            after,
          },
        ],
      },
      null,
    );
  }

  function deleteBackground() {
    if (!background || background.locked) return;
    const assetId = background.source.assetId;
    const isShared = draft.snapshot.backgrounds.some(
      (item) => item.id !== background.id && item.source.assetId === assetId,
    );
    const patches: EditorCommand['patches'][number][] = [
      {
        collection: 'backgrounds',
        id: background.id,
        before: background,
        after: null,
      },
    ];
    const asset = draft.assets[assetId];
    if (!isShared && asset)
      patches.push({
        collection: 'assets',
        id: assetId,
        before: asset,
        after: null,
      });
    if (commit({ kind: 'delete', patches }, null)) model.backgroundChanged('');
  }

  function handleDelete() {
    if (!target || selectionLocked) return;
    if (!commit(deleteTargets(draft, selection), target)) return;
    model.selectionChanged([]);
    if (selection.some((item) => item.kind === 'zone' && item.id === zoneId))
      model.zoneChanged('');
  }

  function handleDuplicate(
    source = draft,
    targets: readonly HallTarget[] = selection,
    offset = 2,
  ) {
    if (
      readonly ||
      targets.length === 0 ||
      targets.some((item) => effectiveLockedKeys.has(hallTargetKey(item)))
    )
      return;
    try {
      const duplicated = duplicateTargets(
        source,
        targets,
        { x: offset, y: offset },
        activeFloorId,
      );
      if (commit(duplicated.command, duplicated.targets[0] ?? null))
        model.selectionChanged(duplicated.targets);
    } catch (error) {
      report(error);
    }
  }

  function handleCopy() {
    if (selection.length === 0) return;
    clipboardRef.current = { draft, targets: [...selection], pasteCount: 0 };
    setHasClipboard(true);
  }

  function handlePaste() {
    const copied = clipboardRef.current;
    if (!copied) return;
    copied.pasteCount += 1;
    handleDuplicate(copied.draft, copied.targets, 2 * copied.pasteCount);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement ||
      (event.target instanceof HTMLElement && event.target.isContentEditable)
    )
      return;
    const key = event.code.startsWith('Key')
      ? event.code.slice(3).toLowerCase()
      : event.key.toLowerCase();
    if (event.key === 'Escape') {
      setMobilePanel(null);
      setBackgroundFitTarget(null);
      setBackgroundFitFirst(null);
      if (tool !== 'select') selectTool('select');
      clearCalibration();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) handleRedo();
      else handleUndo();
    } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault();
      handleRedo();
    } else if ((event.ctrlKey || event.metaKey) && key === 'd') {
      event.preventDefault();
      handleDuplicate();
    } else if ((event.ctrlKey || event.metaKey) && key === 'c') {
      event.preventDefault();
      handleCopy();
    } else if ((event.ctrlKey || event.metaKey) && key === 'v') {
      event.preventDefault();
      handlePaste();
    } else if (event.key === 'Delete') {
      handleDelete();
    } else if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      const shortcutTool = key === 'v' ? 'select' : key === 'h' ? 'pan' : null;
      if (shortcutTool) {
        event.preventDefault();
        selectTool(shortcutTool);
      }
    }
  }

  async function runCallback(
    action:
      | { kind: 'save'; callback?: HallEditorProps['onSave'] }
      | { kind: 'publish'; callback?: HallEditorProps['onPublish'] },
  ) {
    if (action.kind === 'save') {
      if (!action.callback) return;
      try {
        await action.callback(model.$state.getState().draft);
      } catch (error) {
        report(error);
      }
      return;
    }
    const { callback } = action;
    if (!callback) return;
    try {
      const result = await validateLatest();
      const candidate = result.draft;
      const blockingIssue = result.issues.find(
        (issue) => issue.severity === 'error',
      );
      if (blockingIssue) throw new Error(blockingIssue.message);
      const acknowledged = warningAcknowledgement === candidate.snapshot;
      if (
        result.issues.some((issue) => issue.severity === 'warning') &&
        !acknowledged
      )
        throw new Error(tr('Подтвердите публикацию с предупреждениями'));
      await callback(candidate, acknowledged);
    } catch (error) {
      report(error);
    }
  }

  function updateZone(zone: Zone, after: Zone) {
    commit({
      kind: 'update',
      patches: [{ collection: 'zones', id: zone.id, before: zone, after }],
    });
  }
  function updateSeat(seat: Seat, after: Seat) {
    commit({
      kind: 'update',
      patches: [
        {
          collection: 'seats',
          id: seat.id,
          before: seat,
          after: preserveSeatManualAdjustment(seat, after),
        },
      ],
    });
  }
  function updateRow(row: Row, after: Row) {
    commit(
      row.curve === after.curve && row.generation === after.generation
        ? {
            kind: 'update',
            patches: [{ collection: 'rows', id: row.id, before: row, after }],
          }
        : transformRow(draft, row, after, publishedSeatIds),
    );
  }
  function updateTable(table: Table, after: Table) {
    commit(
      table.center === after.center &&
        table.rotationRadians === after.rotationRadians &&
        table.shape === after.shape &&
        table.generation === after.generation
        ? {
            kind: 'update',
            patches: [
              { collection: 'tables', id: table.id, before: table, after },
            ],
          }
        : transformTable(draft, table, after, publishedSeatIds),
    );
  }
  function updateDecoration(before: Decoration, after: Decoration) {
    commit({
      kind: 'update',
      patches: [{ collection: 'decorations', id: before.id, before, after }],
    });
  }

  const zone =
    target?.kind === 'zone'
      ? draft.snapshot.zones.find((item) => item.id === target.id)
      : null;
  const seat =
    target?.kind === 'seat'
      ? draft.snapshot.seats.find((item) => item.id === target.id)
      : null;
  const parentRowId =
    seat && seat.placement.kind === 'row' ? seat.placement.rowId : null;
  const parentRow = parentRowId
    ? (draft.snapshot.rows.find((item) => item.id === parentRowId) ?? null)
    : null;
  const row =
    target?.kind === 'row'
      ? draft.snapshot.rows.find((item) => item.id === target.id)
      : null;
  const table =
    target?.kind === 'table'
      ? draft.snapshot.tables.find((item) => item.id === target.id)
      : null;
  const decoration =
    target?.kind === 'decoration'
      ? draft.snapshot.decorations.find((item) => item.id === target.id)
      : null;
  const bounds = zone ? draft.zoneBounds[zone.id] : null;
  const editablePolygon = Boolean(
    zone || (decoration && decoration.kind !== 'label'),
  );
  const editableShape = Boolean(editablePolygon || row);
  const selectionCenter = useMemo(
    () =>
      selection.length > 1 ? selectionCenterValues(draft, selection) : null,
    [draft, selection],
  );
  const mixedCenterX = selectionCenter?.x ?? null;
  const mixedCenterY = selectionCenter?.y ?? null;

  function activatePolygonMode(next: Exclude<PolygonEditMode, 'move'>) {
    if (tool !== 'select') {
      clearCalibration();
      model.toolChanged('select');
    }
    const mode = polygonEditMode === next ? 'move' : next;
    const zoneBounds =
      zone && !zone.polygon
        ? (bounds ??
          buildHallScene(
            draft.snapshot,
            zone.floorId,
            draft.zoneBounds,
          ).zones.find((item) => item.zone.id === zone.id)?.bounds)
        : null;
    if (mode === 'geometry' && zone && !zone.polygon && zoneBounds) {
      updateZone(zone, {
        ...zone,
        polygon: [
          worldPointSchema.parse({ x: zoneBounds.minX, y: zoneBounds.minY }),
          worldPointSchema.parse({ x: zoneBounds.maxX, y: zoneBounds.minY }),
          worldPointSchema.parse({ x: zoneBounds.maxX, y: zoneBounds.maxY }),
          worldPointSchema.parse({ x: zoneBounds.minX, y: zoneBounds.maxY }),
        ],
      });
    }
    setPolygonEditMode(mode);
  }

  return (
    <EditorLocaleContext.Provider value={locale}>
      <section
        className="hall-editor"
        aria-label={`${tr('Редактор зала')} ${draft.hallName}`}
        data-validation-status={validationPending ? 'pending' : 'current'}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest(
              'button, input, select, textarea, [contenteditable="true"]',
            )
          )
            return;
          event.currentTarget.focus();
        }}
      >
        <header className="hall-editor-header">
          <strong>{draft.hallName}</strong>

          <span>
            {tr('Черновик')} · {draft.snapshot.zones.length} {tr('зон')} ·{' '}
            {draft.snapshot.rows.length} {tr('рядов')} ·{' '}
            {draft.snapshot.seats.length} {tr('мест')} ·{' '}
            {draft.snapshot.tables.length} {tr('столов')}
          </span>

          <button
            type="button"
            disabled={readonly || state.past.length === 0}
            aria-keyshortcuts="Control+Z Meta+Z"
            onClick={handleUndo}
          >
            {tr('Отменить')} <kbd className="hall-editor-shortcut">Ctrl+Z</kbd>
          </button>

          <button
            type="button"
            disabled={readonly || state.future.length === 0}
            aria-keyshortcuts="Control+Y Meta+Y Control+Shift+Z Meta+Shift+Z"
            onClick={handleRedo}
          >
            {tr('Повторить')} <kbd className="hall-editor-shortcut">Ctrl+Y</kbd>
          </button>

          {onSave && (
            <button
              type="button"
              disabled={readonly || saving}
              onClick={() => runCallback({ kind: 'save', callback: onSave })}
            >
              {tr(saving ? 'Сохранение…' : 'Сохранить')}
            </button>
          )}

          {onPublish && (
            <button
              type="button"
              disabled={
                readonly ||
                saving ||
                validationPending ||
                !hasCurrentFullValidation ||
                hasBlockingIssues ||
                (hasWarnings && !warningsAcknowledged)
              }
              onClick={() =>
                runCallback({ kind: 'publish', callback: onPublish })
              }
            >
              {tr('Опубликовать')}
            </button>
          )}
        </header>

        <div className="hall-editor-workspace">
          <ToolsPanel
            locale={locale}
            activeTool={tool}
            readonly={readonly}
            onSelect={selectTool}
          />
          <LayersPanel
            locale={locale}
            mobilePanel={mobilePanel}
            onClose={() => setMobilePanel(null)}
          >
            {mobilePanel === 'tools' && (
              <div className="hall-editor-mobile-tools">
                {editorTools.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={tool === item.id}
                    aria-keyshortcuts={item.shortcut}
                    title={
                      item.shortcut
                        ? `${tr(item.label)} (${item.shortcut})`
                        : tr(item.label)
                    }
                    disabled={
                      readonly && item.id !== 'select' && item.id !== 'pan'
                    }
                    onClick={() => {
                      selectTool(item.id);
                    }}
                  >
                    {tr(item.label)}{' '}
                    {item.shortcut && (
                      <kbd className="hall-editor-shortcut">
                        {item.shortcut}
                      </kbd>
                    )}
                  </button>
                ))}
              </div>
            )}
            <EditorStructure
              snapshot={draft.snapshot}
              floorId={activeFloorId}
              selection={selection}
              directHiddenKeys={directHiddenKeys}
              effectiveHiddenKeys={effectiveHiddenKeys}
              directLockedKeys={directLockedKeys}
              effectiveLockedKeys={effectiveLockedKeys}
              {...(locale !== undefined ? { locale } : {})}
              onSelect={(target) => {
                model.selectionChanged([target]);
                model.toolChanged('select');
              }}
              onToggleHidden={toggleObjectVisibility}
              onToggleLocked={toggleObjectLock}
            />
            <h3>{tr('Этажи')}</h3>
            <label>
              {tr('Активный этаж')}
              <select
                aria-label={tr('Активный этаж')}
                value={activeFloorId}
                onChange={(event) => selectFloor(event.target.value)}
              >
                {draft.snapshot.floors.map((floor) => (
                  <option key={floor.id} value={floor.id}>
                    {floor.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={readonly}
              onClick={() => {
                const command = createFloor(
                  draft,
                  tr(`Этаж ${draft.snapshot.floors.length + 1}`),
                );
                if (commit(command, null)) {
                  const floorPatch = command.patches.find(
                    (patch) => patch.collection === 'floors',
                  );
                  if (floorPatch?.collection === 'floors' && floorPatch.after)
                    setFloorId(floorPatch.after.id);
                }
              }}
            >
              {tr('Добавить этаж')}
            </button>
            {draft.snapshot.floors
              .filter((floor) => floor.id === activeFloorId)
              .map((floor) => (
                <Fragment key={floor.id}>
                  <PropertyField
                    label={tr('Название этажа')}
                    value={floor.name}
                    disabled={readonly}
                    onCommit={(name) =>
                      commit(renameFloor(floor, String(name)), null)
                    }
                  />
                  <button
                    type="button"
                    disabled={readonly || draft.snapshot.floors.length <= 1}
                    onClick={() => {
                      if (commit(deleteFloor(draft, floor.id), null)) {
                        setFloorId(
                          draft.snapshot.floors.find(
                            (item) => item.id !== floor.id,
                          )?.id ?? '',
                        );
                        model.selectionChanged([]);
                        model.zoneChanged('');
                      }
                    }}
                  >
                    {tr('Удалить этаж')}
                  </button>
                </Fragment>
              ))}
            <label>
              {tr('Зона для новых объектов')}
              <select
                aria-label={tr('Зона для новых объектов')}
                value={zoneId}
                onChange={(event) => model.zoneChanged(event.target.value)}
              >
                <option value="">{tr('Без зоны')}</option>
                {draft.snapshot.zones
                  .filter((item) => item.floorId === activeFloorId)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>

            <h3>{tr('PDF-подложки')}</h3>
            <label className="hall-editor-file-field">
              {tr('Загрузить PDF')}
              <input
                ref={pdfInputRef}
                aria-label={tr('Загрузить PDF')}
                type="file"
                accept="application/pdf,.pdf"
                disabled={readonly || importingPdf}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void handlePdfImport(file);
                }}
              />
            </label>
            {importingPdf && <span role="status">{tr('Чтение PDF…')}</span>}
            {draft.snapshot.backgrounds
              .filter((item) => item.floorId === activeFloorId)
              .map((item) => {
                const asset = draft.assets[item.source.assetId];
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={backgroundId === item.id}
                    onClick={() => {
                      model.backgroundChanged(item.id);
                      model.selectionChanged([]);
                      model.toolChanged('select');
                    }}
                  >
                    {asset
                      ? tr(
                          `${item.locked ? '🔒 ' : ''}${asset.name} · ${asset.pages.length} ${asset.pages.length === 1 ? 'страница' : 'страницы'}`,
                        )
                      : item.id}
                  </button>
                );
              })}

            <h3>{tr('Калибровка')}</h3>
            <PropertyField
              label={tr('Известное расстояние (мм)')}
              value={knownMillimeters}
              unit={tr('мм')}
              min={0.1}
              disabled={readonly}
              onCommit={(value) => setKnownMillimeters(Number(value))}
            />
            <p>
              {draft.calibration
                ? tr(
                    `Калибровка: ${draft.calibration.millimetersPerWorldUnit.toFixed(3)} мм/ед`,
                  )
                : tr('Калибровка отсутствует')}
            </p>
            {tool === 'calibrate' && (
              <div className="hall-editor-calibration-help" role="status">
                <strong>
                  {calibrationFirst ? tr('Шаг 2 из 2') : tr('Шаг 1 из 2')}
                </strong>
                <p>
                  {calibrationFirst
                    ? tr('Выберите вторую точку на известном расстоянии.')
                    : tr('Выберите первую точку на PDF или схеме.')}
                </p>
                {calibrationFirst && calibrationHover && (
                  <p>
                    {tr('Предпросмотр:')}{' '}
                    {Math.hypot(
                      calibrationHover.x - calibrationFirst.x,
                      calibrationHover.y - calibrationFirst.y,
                    ).toFixed(2)}{' '}
                    {tr('ед. =')} {knownMillimeters} {tr('мм')}
                  </p>
                )}
              </div>
            )}
          </LayersPanel>

          <div className="hall-editor-canvas" ref={setCanvasElement}>
            <PdfHallViewer
              {...(locale ? { locale } : {})}
              labels={{
                hall: tr('Схема зала'),
                toolbar: tr('Управление схемой'),
                select: tr('Выбор'),
                pan: tr('Рука'),
                zoomIn: tr('Увеличить'),
                zoomOut: tr('Уменьшить'),
                fit: tr('Вписать'),
                reset: '100%',
                zoomSelection: tr('К выбранному'),
                zone: tr('Зона'),
                zoomZone: tr('Приблизить зону'),
                allZones: tr('Все зоны'),
                floor: tr('Этаж'),
                scale: tr('Масштаб'),
                selected: tr('Выбрано'),
                grid: tr('Сетка · шаг 1'),
              }}
              height={canvasHeight}
              draft={viewerDraft}
              renderer={rendererPreference}
              webglEnabled={webglEnabled}
              viewerMode="edit"
              focusedFloorId={activeFloorId}
              hiddenTargets={effectiveHiddenKeys}
              lockedTargets={effectiveLockedKeys}
              previewSeats={previewSeats}
              onError={report}
              activeTool={tool}
              polygonEditMode={polygonEditMode}
              selectedTargets={selection}
              {...(calibrationFirst && calibrationHover
                ? {
                    calibrationGuide: {
                      first: calibrationFirst,
                      second: calibrationHover,
                    },
                  }
                : {})}
              onPointerWorldMove={(point) => {
                if (tool === 'calibrate') setCalibrationHover(point);
              }}
              {...(!readonly
                ? {
                    onHandleCommit: (
                      handled: HallTarget,
                      handleId: string,
                      point: Vector2,
                    ) => {
                      commit(
                        editHandle(
                          draft,
                          handled,
                          handleId,
                          point,
                          publishedSeatIds,
                        ),
                        handled,
                      );
                    },
                  }
                : {})}
              onCanvasClick={handleCanvasClick}
              {...(!readonly ? { onObjectsMove: handleMove } : {})}
              onSelectionChange={(next) => {
                model.selectionChanged(next);
                if (next.length > 0) model.backgroundChanged('');
              }}
              onFloorChange={selectFloor}
            />
            {!readonly &&
              tool === 'select' &&
              !draft.snapshot.rows.some(
                (item) => item.floorId === activeFloorId,
              ) &&
              !draft.snapshot.tables.some(
                (item) => item.floorId === activeFloorId,
              ) &&
              !draft.snapshot.seats.some(
                (item) => item.floorId === activeFloorId,
              ) &&
              !draft.snapshot.decorations.some(
                (item) => item.floorId === activeFloorId,
              ) &&
              !draft.snapshot.zones.some(
                (item) => item.floorId === activeFloorId,
              ) &&
              !draft.snapshot.backgrounds.some(
                (item) => item.floorId === activeFloorId,
              ) && (
                <div className="hall-editor-empty-start">
                  <div>
                    <strong>{tr('Начните схему зала')}</strong>
                    <p>
                      {tr(
                        'Выберите основу, затем двигайте объекты прямо на холсте.',
                      )}
                    </p>
                    <div>
                      <button
                        type="button"
                        onClick={() => handleEmptyAction('template')}
                      >
                        {tr('Готовый шаблон')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEmptyAction('row-line')}
                      >
                        {tr('Добавить ряд')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEmptyAction('table-circle')}
                      >
                        {tr('Добавить стол')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEmptyAction('pdf')}
                      >
                        {tr('Импортировать PDF')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
          </div>

          <PropertiesPanel
            locale={locale}
            mobileOpen={mobilePanel === 'properties'}
            onClose={() => setMobilePanel(null)}
          >
            {selectionLocked && (
              <p className="hall-editor-lock-note" role="status">
                {tr(
                  'Выбранный объект заблокирован. Снимите блокировку в дереве объектов.',
                )}
              </p>
            )}
            <fieldset
              className="hall-editor-locked-properties"
              disabled={selectionLocked}
            >
              {(target || background) && (
                <p className="hall-editor-selection-path">
                  {target
                    ? `${target.kind} · ${target.id}`
                    : tr('PDF-подложка')}
                </p>
              )}
              {!target && !background && (
                <p>{tr('Выберите объект на схеме или подложку в списке.')}</p>
              )}
              {(selection.length > 0 || hasClipboard) && !readonly && (
                <div
                  className="hall-editor-layout-actions"
                  aria-label={tr('Операции с выделением')}
                >
                  {selection.length > 0 && (
                    <>
                      <button type="button" onClick={() => handleDuplicate()}>
                        {tr('Дублировать')}
                      </button>
                      <button type="button" onClick={handleCopy}>
                        {tr('Копировать')}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={!hasClipboard}
                    onClick={handlePaste}
                  >
                    {tr('Вставить')}
                  </button>
                  {selection.length > 1 && (
                    <>
                      {(
                        [
                          ['left', tr('По левому краю')],
                          ['center', tr('По центру X')],
                          ['right', tr('По правому краю')],
                          ['top', tr('По верхнему краю')],
                          ['middle', tr('По центру Y')],
                          ['bottom', tr('По нижнему краю')],
                        ] as const
                      ).map(([edge, label]) => (
                        <button
                          key={edge}
                          type="button"
                          onClick={() =>
                            commit(
                              alignTargets(
                                draft,
                                selection,
                                edge,
                                publishedSeatIds,
                              ),
                            )
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </>
                  )}
                  {selection.length > 2 && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          commit(
                            distributeTargets(
                              draft,
                              selection,
                              'horizontal',
                              publishedSeatIds,
                            ),
                          )
                        }
                      >
                        {tr('Распределить X')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          commit(
                            distributeTargets(
                              draft,
                              selection,
                              'vertical',
                              publishedSeatIds,
                            ),
                          )
                        }
                      >
                        {tr('Распределить Y')}
                      </button>
                    </>
                  )}
                </div>
              )}
              {editableShape && selection.length === 1 && !readonly && (
                <div
                  className="hall-editor-polygon-actions"
                  aria-label={tr('Изменение размера или формы объекта')}
                >
                  <button
                    type="button"
                    aria-pressed={polygonEditMode === 'resize'}
                    onClick={() => activatePolygonMode('resize')}
                  >
                    {tr('Изменить размер')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={polygonEditMode === 'geometry'}
                    onClick={() => activatePolygonMode('geometry')}
                  >
                    {tr('Изменить форму')}
                  </button>
                  <p>
                    {row
                      ? polygonEditMode === 'resize'
                        ? tr(
                            'Потяните за крайние точки ряда, чтобы изменить длину.',
                          )
                        : polygonEditMode === 'geometry'
                          ? tr(
                              'Перетаскивайте точки ряда, чтобы изменить форму.',
                            )
                          : tr(
                              'Выберите размер или форму, затем перетаскивайте маркеры ряда.',
                            )
                      : polygonEditMode === 'resize'
                        ? tr('Потяните за край или угол.')
                        : polygonEditMode === 'geometry'
                          ? tr('Перетаскивайте точки контура.')
                          : tr(
                              'Выберите действие, затем перетаскивайте маркеры на схеме.',
                            )}
                  </p>
                </div>
              )}
              {selection.length > 1 && (
                <div className="hall-editor-mixed-properties">
                  <h4>
                    {tr('Общие координаты ·')} {selection.length}{' '}
                    {tr('объекта')}
                  </h4>
                  <PropertyField
                    label={tr('Центр X')}
                    kind="number"
                    value={
                      mixedCenterX === null
                        ? null
                        : Math.round(mixedCenterX * 1000) / 1000
                    }
                    disabled={readonly}
                    onCommit={(value) =>
                      commit(
                        setSelectionCenter(
                          draft,
                          selection,
                          'x',
                          Number(value),
                          publishedSeatIds,
                        ),
                      )
                    }
                  />
                  <PropertyField
                    label={tr('Центр Y')}
                    kind="number"
                    value={
                      mixedCenterY === null
                        ? null
                        : Math.round(mixedCenterY * 1000) / 1000
                    }
                    disabled={readonly}
                    onCommit={(value) =>
                      commit(
                        setSelectionCenter(
                          draft,
                          selection,
                          'y',
                          Number(value),
                          publishedSeatIds,
                        ),
                      )
                    }
                  />
                </div>
              )}
              {zone && (
                <>
                  <h4>{tr('Зона')}</h4>
                  <label>
                    {tr('Тип зоны')}
                    <select
                      aria-label={tr('Тип зоны')}
                      value={zone.kind}
                      disabled={readonly}
                      onChange={(event) =>
                        updateZone(zone, {
                          ...zone,
                          kind: event.target.value as Zone['kind'],
                          ...(event.target.value === 'ga'
                            ? { capacity: zone.capacity ?? 20 }
                            : {}),
                        })
                      }
                    >
                      <option value="seated">{tr('С местами')}</option>
                      <option value="ga">{tr('Без мест (GA)')}</option>
                    </select>
                  </label>
                  {zone.kind === 'ga' && (
                    <PropertyField
                      label={tr('Вместимость GA')}
                      value={zone.capacity ?? 20}
                      disabled={readonly}
                      min={1}
                      integer
                      onCommit={(capacity) =>
                        updateZone(zone, {
                          ...zone,
                          capacity: Number(capacity),
                        })
                      }
                    />
                  )}
                  <PropertyField
                    label={tr('Название зоны')}
                    value={zone.name}
                    disabled={readonly}
                    onCommit={(name) =>
                      updateZone(zone, { ...zone, name: String(name) })
                    }
                  />
                </>
              )}
              {decoration && (
                <>
                  <h4>
                    {decoration.kind === 'stage'
                      ? tr('Сцена')
                      : decoration.kind === 'obstacle'
                        ? tr('Препятствие')
                        : tr('Подпись')}
                  </h4>
                  <PropertyField
                    label={tr('Текст объекта')}
                    value={
                      decoration.kind === 'label'
                        ? decoration.text
                        : (decoration.label ?? '')
                    }
                    disabled={readonly}
                    onCommit={(value) =>
                      updateDecoration(
                        decoration,
                        decoration.kind === 'label'
                          ? { ...decoration, text: String(value) }
                          : { ...decoration, label: String(value) },
                      )
                    }
                  />
                  {decoration.kind === 'label' ? (
                    <>
                      <PropertyField
                        label={tr('X подписи')}
                        value={decoration.position.x}
                        disabled={readonly}
                        onCommit={(x) =>
                          updateDecoration(decoration, {
                            ...decoration,
                            position: worldPointSchema.parse({
                              ...decoration.position,
                              x: Number(x),
                            }),
                          })
                        }
                      />
                      <PropertyField
                        label={tr('Y подписи')}
                        value={decoration.position.y}
                        disabled={readonly}
                        onCommit={(y) =>
                          updateDecoration(decoration, {
                            ...decoration,
                            position: worldPointSchema.parse({
                              ...decoration.position,
                              y: Number(y),
                            }),
                          })
                        }
                      />
                    </>
                  ) : null}
                </>
              )}
              {seat && (
                <>
                  <h4>{tr('Место')}</h4>
                  {parentRow && (
                    <button
                      type="button"
                      className="hall-editor-parent-select"
                      title={tr('Alt+щелчок по месту — выбрать ряд')}
                      onClick={() => {
                        if (tool !== 'select') clearCalibration();
                        model.toolChanged('select');
                        model.selectionChanged([
                          { kind: 'row', id: parentRow.id },
                        ]);
                      }}
                    >
                      {tr('Выбрать ряд')}: {parentRow.name}
                      <kbd className="hall-editor-shortcut">Alt+клик</kbd>
                    </button>
                  )}
                  <label className="hall-editor-field">
                    {tr('Тип места')}
                    <select
                      aria-label={tr('Тип места')}
                      value={seat.visualKind ?? 'chair'}
                      disabled={readonly}
                      onChange={(event) =>
                        updateSeat(seat, {
                          ...seat,
                          visualKind: event.target.value as NonNullable<
                            Seat['visualKind']
                          >,
                        })
                      }
                    >
                      <option value="chair">{tr('Стул')}</option>
                      <option value="armchair">{tr('Кресло')}</option>
                      <option value="wheelchairBay">
                        {tr('Место для коляски')}
                      </option>
                    </select>
                  </label>
                  <PropertyField
                    label={tr('Номер места')}
                    value={seat.label}
                    disabled={readonly}
                    onCommit={(label) =>
                      updateSeat(seat, { ...seat, label: String(label) })
                    }
                  />
                  <PropertyField
                    label={tr('X места')}
                    value={seat.position.x}
                    disabled={readonly}
                    onCommit={(x) =>
                      updateSeat(seat, {
                        ...seat,
                        position: { ...seat.position, x: Number(x) },
                      })
                    }
                  />
                  <PropertyField
                    label={tr('Y места')}
                    value={seat.position.y}
                    disabled={readonly}
                    onCommit={(y) =>
                      updateSeat(seat, {
                        ...seat,
                        position: { ...seat.position, y: Number(y) },
                      })
                    }
                  />
                </>
              )}
              {row && (
                <>
                  <h4>{tr('Ряд')}</h4>
                  <PropertyField
                    label={tr('Название ряда')}
                    value={row.name}
                    disabled={readonly}
                    onCommit={(name) =>
                      updateRow(row, { ...row, name: String(name) })
                    }
                  />
                  <RowGenerationControls
                    key={`${row.id}:${JSON.stringify(row.generation)}`}
                    row={row}
                    seatCount={
                      draft.snapshot.seats.filter(
                        (seat) =>
                          seat.placement.kind === 'row' &&
                          seat.placement.rowId === row.id,
                      ).length
                    }
                    readonly={readonly}
                    onPreview={handlePreview}
                    onApply={(after) => updateRow(row, after)}
                  />
                </>
              )}
              {table && (
                <>
                  <h4>{tr('Стол')}</h4>
                  <PropertyField
                    label={tr('Название стола')}
                    value={table.label}
                    disabled={readonly}
                    onCommit={(label) =>
                      updateTable(table, { ...table, label: String(label) })
                    }
                  />
                  <PropertyField
                    label={tr('X стола')}
                    value={table.center.x}
                    disabled={readonly}
                    onCommit={(x) =>
                      updateTable(table, {
                        ...table,
                        center: { ...table.center, x: Number(x) },
                      })
                    }
                  />
                  <PropertyField
                    label={tr('Y стола')}
                    value={table.center.y}
                    disabled={readonly}
                    onCommit={(y) =>
                      updateTable(table, {
                        ...table,
                        center: { ...table.center, y: Number(y) },
                      })
                    }
                  />
                  <PropertyField
                    label={tr('Поворот (рад)')}
                    value={table.rotationRadians}
                    disabled={readonly}
                    onCommit={(rotationRadians) =>
                      updateTable(table, {
                        ...table,
                        rotationRadians: Number(rotationRadians),
                      })
                    }
                  />
                  {table.shape.kind === 'circle' ? (
                    <PropertyField
                      label={tr('Радиус стола')}
                      value={table.shape.radius}
                      disabled={readonly}
                      onCommit={(radius) =>
                        updateTable(table, {
                          ...table,
                          shape: {
                            ...table.shape,
                            radius: Number(radius),
                          } as Table['shape'],
                        })
                      }
                    />
                  ) : (
                    <>
                      <PropertyField
                        label={tr('Ширина стола')}
                        value={table.shape.width}
                        disabled={readonly}
                        onCommit={(width) =>
                          updateTable(table, {
                            ...table,
                            shape: {
                              ...table.shape,
                              width: Number(width),
                            } as Table['shape'],
                          })
                        }
                      />
                      <PropertyField
                        label={tr('Высота стола')}
                        value={table.shape.height}
                        disabled={readonly}
                        onCommit={(height) =>
                          updateTable(table, {
                            ...table,
                            shape: {
                              ...table.shape,
                              height: Number(height),
                            } as Table['shape'],
                          })
                        }
                      />
                    </>
                  )}
                  <TableGenerationControls
                    key={`${table.id}:${JSON.stringify(table.shape)}:${JSON.stringify(table.generation)}`}
                    table={table}
                    readonly={readonly}
                    onPreview={handlePreview}
                    onApply={(after) => updateTable(table, after)}
                  />
                </>
              )}
              {background &&
                background.source.kind === 'pdf' &&
                (() => {
                  const asset = draft.assets[background.source.assetId];
                  return (
                    <>
                      <h4>{tr('PDF-подложка')}</h4>
                      <p>{asset?.name ?? tr('Файл не найден')}</p>
                      {background.locked && (
                        <p className="hall-editor-lock-note" role="status">
                          <span role="img" aria-label={tr('Заблокировано')}>
                            🔒
                          </span>{' '}
                          {tr(
                            'Подложка заблокирована. Снимите блокировку, чтобы изменить положение, видимость или файл.',
                          )}
                        </p>
                      )}

                      <label className="hall-editor-field">
                        {tr('Страница PDF')}
                        <select
                          aria-label={tr('Страница PDF')}
                          value={background.source.pageNumber}
                          disabled={readonly || background.locked}
                          onChange={(event) =>
                            updateBackground({
                              ...background,
                              source: {
                                kind: 'pdf',
                                assetId: background.source.assetId,
                                pageNumber: Number(event.target.value),
                              },
                            })
                          }
                        >
                          {asset?.pages.map((_, index) => (
                            <option key={index + 1} value={index + 1}>
                              {index + 1}
                            </option>
                          ))}
                        </select>
                      </label>

                      <PropertyField
                        label={tr('X подложки')}
                        value={background.position.x}
                        disabled={readonly || background.locked}
                        onCommit={(x) =>
                          updateBackground({
                            ...background,
                            position: { ...background.position, x: Number(x) },
                          })
                        }
                      />

                      <PropertyField
                        label={tr('Y подложки')}
                        value={background.position.y}
                        disabled={readonly || background.locked}
                        onCommit={(y) =>
                          updateBackground({
                            ...background,
                            position: { ...background.position, y: Number(y) },
                          })
                        }
                      />

                      <BackgroundScaleControl
                        value={backgroundScalePercent(
                          background.scale,
                          background.referenceScale ?? background.scale,
                        )}
                        disabled={readonly || background.locked}
                        {...(locale ? { locale } : {})}
                        onPreview={(percent) => setBackgroundScalePreview({
                          backgroundId: background.id,
                          percent,
                        })}
                        onCommit={(percent) => {
                          const referenceScale =
                            background.referenceScale ?? background.scale;
                          const scale = backgroundScaleFromPercent(
                            referenceScale,
                            percent,
                          );
                          const asset = draft.assets[background.source.assetId];
                          const pageNumber =
                            background.source.kind === 'pdf'
                              ? background.source.pageNumber
                              : 0;
                          const pageSize = asset?.pages[pageNumber - 1];
                          updateBackground({
                            ...background,
                            referenceScale,
                            scale,
                            ...(pageSize
                              ? {
                                  position: worldPointSchema.parse(
                                    scaleBackgroundAroundCenter(
                                      background.position,
                                      background.scale,
                                      scale,
                                      pageSize,
                                      background.rotationRadians,
                                    ),
                                  ),
                                }
                              : {}),
                          });
                        }}
                      />

                      <PropertyField
                        label={tr('Размер подложки на схеме (ед.)')}
                        value={backgroundFitTarget}
                        disabled={readonly || background.locked}
                        min={0.001}
                        onCommit={(distance) => {
                          setBackgroundFitTarget(Number(distance));
                          setBackgroundFitFirst(null);
                        }}
                      />
                      <button
                        type="button"
                        disabled={readonly || background.locked || backgroundFitTarget === null}
                        onClick={() => {
                          if (backgroundFitTarget !== null) {
                            setBackgroundFitFirst(null);
                            model.toolChanged('calibrate');
                          }
                        }}
                      >
                        {tr('Подогнать по двум точкам')}
                      </button>
                      {backgroundFitTarget !== null && (
                        <p role="status">
                          {backgroundFitFirst
                            ? tr('Выберите вторую точку на подложке.')
                            : tr('Выберите первую точку на подложке.')}
                          <button
                            type="button"
                            onClick={() => {
                              setBackgroundFitTarget(null);
                              setBackgroundFitFirst(null);
                              model.toolChanged('select');
                            }}
                          >
                            {tr('Отмена')}
                          </button>
                        </p>
                      )}

                      <PropertyField
                        label={tr('Поворот подложки (°)')}
                        value={
                          Math.round(
                            ((background.rotationRadians * 180) / Math.PI) *
                              1000,
                          ) / 1000
                        }
                        disabled={readonly || background.locked}
                        onCommit={(degrees) =>
                          updateBackground({
                            ...background,
                            rotationRadians: (Number(degrees) * Math.PI) / 180,
                          })
                        }
                      />

                      <PropertyField
                        label={tr('Прозрачность подложки')}
                        value={background.opacity}
                        disabled={readonly || background.locked}
                        min={0}
                        max={1}
                        onCommit={(opacity) =>
                          updateBackground({
                            ...background,
                            opacity: Number(opacity),
                          })
                        }
                      />

                      <label className="hall-editor-field">
                        {tr('Видимая')}
                        <input
                          type="checkbox"
                          checked={background.visible}
                          disabled={readonly || background.locked}
                          onChange={(event) =>
                            updateBackground({
                              ...background,
                              visible: event.target.checked,
                            })
                          }
                        />
                      </label>

                      <label className="hall-editor-field">
                        {tr('Заблокирована')}
                        <input
                          type="checkbox"
                          checked={background.locked}
                          disabled={readonly}
                          onChange={(event) =>
                            updateBackground({
                              ...background,
                              locked: event.target.checked,
                            })
                          }
                        />
                      </label>

                      <label className="hall-editor-file-field">
                        {tr('Заменить PDF')}
                        <input
                          aria-label={tr('Заменить PDF')}
                          type="file"
                          accept="application/pdf,.pdf"
                          disabled={
                            readonly || importingPdf || background.locked
                          }
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = '';
                            if (file) void handlePdfImport(file, background);
                          }}
                        />
                      </label>

                      <button
                        type="button"
                        disabled={readonly || background.locked}
                        onClick={deleteBackground}
                      >
                        {tr('Удалить подложку')}
                      </button>
                    </>
                  );
                })()}
              {target && (
                <button
                  type="button"
                  disabled={readonly}
                  onClick={handleDelete}
                >
                  {tr('Удалить объект')}
                </button>
              )}
              {validationIssues.length > 0 && (
                <section
                  className="hall-editor-validation"
                  aria-label={tr('Проверка схемы')}
                >
                  <h3>{tr('Проверка схемы')}</h3>
                  <p>
                    {tr(
                      'Номера проверяются внутри ряда или стола; для отдельных мест — внутри зоны либо этажа.',
                    )}
                  </p>
                  {hasWarnings && (
                    <label>
                      <input
                        type="checkbox"
                        checked={warningsAcknowledged}
                        onChange={(event) =>
                          setWarningAcknowledgement(
                            event.target.checked ? draft.snapshot : null,
                          )
                        }
                      />
                      {tr('Публиковать с предупреждениями')}
                    </label>
                  )}
                  <ul>
                    {validationIssues.slice(0, 20).map((issue, index) => (
                      <li
                        key={`${issue.code}:${issue.targetId ?? index}`}
                        data-severity={issue.severity}
                      >
                        {issue.severity === 'error'
                          ? tr('Ошибка')
                          : tr('Предупреждение')}
                        : {translateEditorError(locale, issue.message)}
                      </li>
                    ))}
                  </ul>
                  {validationIssues.length > 20 && (
                    <p>
                      {tr('Ещё')} {validationIssues.length - 20}{' '}
                      {tr('замечаний')}
                    </p>
                  )}
                </section>
              )}
            </fieldset>
          </PropertiesPanel>
          {mobilePanel && (
            <button
              type="button"
              className="hall-editor-drawer-scrim"
              aria-label={tr('Закрыть панель')}
              onClick={() => setMobilePanel(null)}
            />
          )}
          <nav
            className="hall-editor-mobile-nav"
            aria-label={tr('Панели редактора')}
          >
            <button
              type="button"
              aria-pressed={tool === 'select'}
              aria-label={tr('Выбор')}
              onClick={() => {
                model.toolChanged('select');
                setMobilePanel(null);
              }}
            >
              <MobilePanelIcon name="select" /> <span>{tr('Выбор')}</span>
            </button>
            <button
              type="button"
              disabled={readonly}
              aria-pressed={tool === 'row-line'}
              aria-label={tr('Ряд')}
              onClick={() => {
                model.toolChanged('row-line');
                setMobilePanel(null);
              }}
            >
              <MobilePanelIcon name="row" /> <span>{tr('Ряд')}</span>
            </button>
            <button
              type="button"
              aria-pressed={mobilePanel === 'tools'}
              aria-label={tr('Инструменты')}
              onClick={() =>
                setMobilePanel((current) => toggleEditorPanel(current, 'tools'))
              }
            >
              <MobilePanelIcon name="tools" /> <span>{tr('Инструменты')}</span>
            </button>
            <button
              type="button"
              aria-pressed={mobilePanel === 'layers'}
              aria-label={tr('Слои')}
              onClick={() =>
                setMobilePanel((current) =>
                  toggleEditorPanel(current, 'layers'),
                )
              }
            >
              <MobilePanelIcon name="layers" /> <span>{tr('Слои')}</span>
            </button>
            <button
              type="button"
              aria-pressed={mobilePanel === 'properties'}
              aria-label={tr('Свойства')}
              onClick={() =>
                setMobilePanel((current) =>
                  toggleEditorPanel(current, 'properties'),
                )
              }
            >
              <MobilePanelIcon name="properties" />{' '}
              <span>{tr('Свойства')}</span>
            </button>
          </nav>
        </div>
        <footer className="hall-editor-footer">
          {errorMessage ? (
            <span role="alert">
              {translateEditorError(locale, errorMessage)}
            </span>
          ) : (
            <span>
              {state.past.length > 0
                ? tr(`${state.past.length} изменений`)
                : tr('Нет изменений')}{' '}
              {tr('· Щелчок создаёт объект · Перетаскивание меняет положение')}
            </span>
          )}
        </footer>
      </section>
    </EditorLocaleContext.Provider>
  );
}
