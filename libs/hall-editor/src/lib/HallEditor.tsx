import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
} from 'react';
import { useUnit } from 'effector-react';
import {
  backgroundIdSchema,
  backgroundSchema,
  calibrateWorldDistance,
  worldPointSchema,
  type Background,
  type Decoration,
  type Row,
  type Seat,
  type Table,
  type Zone,
} from '@hall-platform/domain';
import type { SpatialBounds, Vector2 } from '@hall-platform/geometry';
import { encodePdfDataUrl, inspectPdfBytes } from '@hall-platform/pdf';
import type { HallTarget } from '@hall-platform/renderer-konva';

import type { EditorCommand } from './editorCommands.js';
import type { HallLayoutDraft } from './editorDraft.js';
import { createEditorModel } from './editorModel.js';
import { PdfHallViewer } from './PdfHallViewer.js';
import {
  RowGenerationControls,
  TableGenerationControls,
} from './ui/GenerationControls.js';
import { ToolsPanel, editorTools } from './ui/ToolsPanel.js';
import { toggleEditorPanel, type EditorPanel } from './ui/editorPanels.js';
import { useCanvasHeight } from './ui/useCanvasHeight.js';
import {
  createObjectAt,
  deleteTargets,
  moveTargets,
} from './editorOperations.js';
import { preserveSeatManualAdjustment } from './commands/regenerateSeats.js';
import {
  createFloor,
  deleteFloor,
  renameFloor,
} from './commands/structureOperations.js';
import { validateLayout } from './validation/validateLayout.js';
import { transformRow, transformTable } from './commands/transformSelection.js';

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
};

type PropertyFieldProps = {
  readonly label: string;
  readonly value: string | number;
  readonly disabled?: boolean;
  readonly onCommit: (value: string | number) => void;
};

function PropertyField(props: PropertyFieldProps) {
  const { label, value, disabled, onCommit } = props;
  return (
    <label className="hall-editor-field">
      <span>{label}</span>
      <input
        key={`${label}:${value}`}
        aria-label={label}
        type={typeof value === 'number' ? 'number' : 'text'}
        step={typeof value === 'number' ? '0.1' : undefined}
        defaultValue={value}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        onBlur={(event) => {
          const next =
            typeof value === 'number'
              ? Number(event.currentTarget.value)
              : event.currentTarget.value.trim();
          if (
            next === value ||
            (typeof next === 'number' && !Number.isFinite(next)) ||
            next === ''
          )
            return;
          onCommit(next);
        }}
      />
    </label>
  );
}

export function HallEditor(props: HallEditorProps) {
  const {
    value,
    readonly = false,
    saving = false,
    onChange,
    onSave,
    onPublish,
    onError,
    publishedSeatIds = [],
  } = props;
  const [model] = useState(() => createEditorModel(value));
  const [mobilePanel, setMobilePanel] = useState<EditorPanel | null>(null);
  const { setElement: setCanvasElement, height: canvasHeight } =
    useCanvasHeight();
  const [floorId, setFloorId] = useState(value.snapshot.floors[0]?.id ?? '');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [knownMillimeters, setKnownMillimeters] = useState(1000);
  const [calibrationFirst, setCalibrationFirst] = useState<Vector2 | null>(
    null,
  );
  const [importingPdf, setImportingPdf] = useState(false);
  const [previewState, setPreviewState] = useState<{
    key: string;
    seats: readonly Vector2[];
  }>({ key: '', seats: [] });
  const [warningAcknowledgement, setWarningAcknowledgement] = useState<
    HallLayoutDraft['snapshot'] | null
  >(null);
  const [state, selection, tool, zoneId, backgroundId] = useUnit([
    model.$state,
    model.$selection,
    model.$tool,
    model.$zoneId,
    model.$backgroundId,
  ]);
  const draft = state.draft;
  const validationIssues = validateLayout(draft);
  const hasBlockingIssues = validationIssues.some(
    (issue) => issue.severity === 'error',
  );
  const hasWarnings = validationIssues.some(
    (issue) => issue.severity === 'warning',
  );
  const warningsAcknowledged = warningAcknowledgement === draft.snapshot;
  const activeFloorId = draft.snapshot.floors.some(
    (floor) => floor.id === floorId,
  )
    ? floorId
    : (draft.snapshot.floors[0]?.id ?? '');
  const target = selection[0] ?? null;
  const targetKey = target ? `${target.kind}:${target.id}` : '';
  const previewSeats = previewState.key === targetKey ? previewState.seats : [];
  const handlePreview = useCallback(
    (seats: readonly Vector2[]) => setPreviewState({ key: targetKey, seats }),
    [targetKey],
  );
  const background =
    draft.snapshot.backgrounds.find((item) => item.id === backgroundId) ?? null;

  useEffect(() => {
    model.replace(value);
  }, [model, value]);

  function report(error: unknown) {
    const failure = error instanceof Error ? error : new Error(String(error));
    setErrorMessage(failure.message);
    onError?.(failure);
  }

  function commit(
    command: EditorCommand,
    selected: HallTarget | null = target,
  ) {
    if (readonly || command.patches.length === 0) return false;
    try {
      const next = model.commit(command);
      setErrorMessage(null);
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
      setErrorMessage(null);
      onChange(next.draft, { kind: 'undo', target: null });
    } catch (error) {
      report(error);
    }
  }

  function handleRedo() {
    if (readonly || state.future.length === 0) return;
    try {
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
      setErrorMessage(null);
      onChange(next.draft, { kind: 'redo', target: null });
    } catch (error) {
      report(error);
    }
  }

  function handleCanvasClick(point: Vector2) {
    if (readonly || tool === 'select' || tool === 'pan') return;
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

  async function handlePdfImport(file: File, replace?: Background) {
    if (readonly) return;
    if (replace?.locked) return;
    if (file.size > 20 * 1024 * 1024) {
      report(new RangeError('PDF должен быть не больше 20 МБ'));
      return;
    }
    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      report(new TypeError('Выберите PDF-файл'));
      return;
    }
    setImportingPdf(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pages = await inspectPdfBytes(bytes);
      const assetId = replace?.source.assetId ?? `asset-${crypto.randomUUID()}`;
      const beforeAsset = draft.assets[assetId] ?? null;
      const asset = {
        kind: 'pdf' as const,
        name: file.name,
        dataUrl: encodePdfDataUrl(bytes),
        pages: [...pages],
      };
      const firstPage = pages[0];
      if (!firstPage) throw new Error('PDF не содержит страниц');
      const scale = Math.min(1, 20 / firstPage.width);
      const nextBackground = replace
        ? backgroundSchema.parse({
            ...replace,
            source: { kind: 'pdf', assetId, pageNumber: 1 },
          })
        : backgroundSchema.parse({
            id: backgroundIdSchema.parse(`background-${crypto.randomUUID()}`),
            floorId: activeFloorId,
            order: draft.snapshot.backgrounds.length,
            position: {
              x: (-firstPage.width * scale) / 2,
              y: (-firstPage.height * scale) / 2,
            },
            scale,
            rotationRadians: 0,
            opacity: 0.7,
            visible: true,
            locked: false,
            source: { kind: 'pdf', assetId, pageNumber: 1 },
          });
      const patches: EditorCommand['patches'][number][] = [
        {
          collection: 'assets',
          id: assetId,
          before: beforeAsset,
          after: asset,
        },
        {
          collection: 'backgrounds',
          id: nextBackground.id,
          before: replace ?? null,
          after: nextBackground,
        },
      ];
      if (commit({ kind: replace ? 'update' : 'create', patches }, null)) {
        model.backgroundChanged(nextBackground.id);
        model.selectionChanged([]);
        model.toolChanged('select');
      }
    } catch (error) {
      report(error);
    } finally {
      setImportingPdf(false);
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
    if (!target) return;
    if (!commit(deleteTargets(draft, selection), target)) return;
    model.selectionChanged([]);
    if (selection.some((item) => item.kind === 'zone' && item.id === zoneId))
      model.zoneChanged('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      setMobilePanel(null);
      if (tool !== 'select') model.toolChanged('select');
    }
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) handleRedo();
      else handleUndo();
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'y'
    ) {
      event.preventDefault();
      handleRedo();
    } else if (event.key === 'Delete') {
      handleDelete();
    }
  }

  function runCallback(
    callback?: (
      layout: HallLayoutDraft,
      warningsAcknowledged: boolean,
    ) => void | Promise<void>,
    acknowledgeWarnings = false,
  ) {
    if (!callback) return;
    try {
      Promise.resolve(callback(draft, acknowledgeWarnings)).catch(report);
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
  function updateBounds(
    id: string,
    before: SpatialBounds,
    after: SpatialBounds,
  ) {
    commit({
      kind: 'update',
      patches: [{ collection: 'zoneBounds', id, before, after }],
    });
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
  const lineCurve = row?.curve.kind === 'line' ? row.curve : null;
  const arcCurve = row?.curve.kind === 'arc' ? row.curve : null;
  const bezierCurve = row?.curve.kind === 'bezier' ? row.curve : null;

  return (
    <section
      className="hall-editor"
      aria-label={`Редактор зала ${draft.hallName}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <header className="hall-editor-header">
        <strong>{draft.hallName}</strong>

        <span>
          Черновик · {draft.snapshot.zones.length} зон ·{' '}
          {draft.snapshot.rows.length} рядов · {draft.snapshot.seats.length}{' '}
          мест · {draft.snapshot.tables.length} столов
        </span>

        <button
          type="button"
          disabled={readonly || state.past.length === 0}
          onClick={handleUndo}
        >
          Отменить
        </button>

        <button
          type="button"
          disabled={readonly || state.future.length === 0}
          onClick={handleRedo}
        >
          Повторить
        </button>

        {onSave && (
          <button
            type="button"
            disabled={readonly || saving}
            onClick={() => runCallback(onSave)}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        )}

        {onPublish && (
          <button
            type="button"
            disabled={
              readonly ||
              saving ||
              hasBlockingIssues ||
              (hasWarnings && !warningsAcknowledged)
            }
            onClick={() => runCallback(onPublish, warningsAcknowledged)}
          >
            Опубликовать
          </button>
        )}
      </header>

      <div className="hall-editor-workspace">
        <ToolsPanel
          activeTool={tool}
          readonly={readonly}
          onSelect={(next) => {
            model.toolChanged(next);
            setMobilePanel(null);
          }}
        />
        <aside
          className="hall-editor-tools"
          aria-label="Структура и настройки"
          data-mobile-open={mobilePanel === 'layers' || mobilePanel === 'tools'}
          data-mobile-panel={mobilePanel ?? ''}
        >
          <div className="hall-editor-panel-heading">
            <h3>{mobilePanel === 'tools' ? 'Инструменты' : 'Структура'}</h3>
            <button
              type="button"
              className="hall-editor-panel-close"
              aria-label="Закрыть панель"
              onClick={() => setMobilePanel(null)}
            >
              ×
            </button>
          </div>
          {mobilePanel === 'tools' && (
            <div className="hall-editor-mobile-tools">
              {editorTools.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={tool === item.id}
                  disabled={readonly && item.id !== 'select' && item.id !== 'pan'}
                  onClick={() => {
                    model.toolChanged(item.id);
                    setMobilePanel(null);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          <h3>Этажи</h3>
          <label>
            Активный этаж
            <select
              aria-label="Активный этаж"
              value={activeFloorId}
              onChange={(event) => {
                setFloorId(event.target.value);
                model.selectionChanged([]);
                model.zoneChanged('');
              }}
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
                `Этаж ${draft.snapshot.floors.length + 1}`,
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
            Добавить этаж
          </button>
          {draft.snapshot.floors
            .filter((floor) => floor.id === activeFloorId)
            .map((floor) => (
              <Fragment key={floor.id}>
                <PropertyField
                  label="Название этажа"
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
                  Удалить этаж
                </button>
              </Fragment>
            ))}
          <label>
            Зона для новых объектов
            <select
              aria-label="Зона для новых объектов"
              value={zoneId}
              onChange={(event) => model.zoneChanged(event.target.value)}
            >
              <option value="">Без зоны</option>
              {draft.snapshot.zones
                .filter((item) => item.floorId === activeFloorId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>

          <h3>PDF-подложки</h3>
          <label className="hall-editor-file-field">
            Загрузить PDF
            <input
              aria-label="Загрузить PDF"
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
          {importingPdf && <span role="status">Чтение PDF…</span>}
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
                    ? `${asset.name} · ${asset.pages.length} ${asset.pages.length === 1 ? 'страница' : 'страницы'}`
                    : item.id}
                </button>
              );
            })}

          <h3>Калибровка</h3>
          <label className="hall-editor-field">
            Известное расстояние (мм)
            <input
              aria-label="Известное расстояние (мм)"
              type="number"
              min="0.1"
              step="0.1"
              value={knownMillimeters}
              disabled={readonly}
              onChange={(event) =>
                setKnownMillimeters(Number(event.target.value))
              }
            />
          </label>
          <p>
            {draft.calibration
              ? `Калибровка: ${draft.calibration.millimetersPerWorldUnit.toFixed(3)} мм/ед`
              : 'Калибровка отсутствует'}
          </p>
          {tool === 'calibrate' && (
            <p>
              {calibrationFirst
                ? 'Выберите вторую точку на схеме'
                : 'Выберите первую точку на схеме'}
            </p>
          )}
        </aside>

        <div className="hall-editor-canvas" ref={setCanvasElement}>
          <PdfHallViewer
            height={canvasHeight}
            draft={draft}
            focusedFloorId={activeFloorId}
            previewSeats={previewSeats}
            onError={report}
            activeTool={tool}
            selectedTargets={selection}
            onCanvasClick={handleCanvasClick}
            {...(!readonly ? { onObjectsMove: handleMove } : {})}
            onSelectionChange={(next) => {
              model.selectionChanged(next);
              if (next.length > 0) model.backgroundChanged('');
            }}
            onFloorChange={(nextFloorId) => {
              setFloorId(nextFloorId);
              model.selectionChanged([]);
              model.zoneChanged('');
              model.backgroundChanged('');
            }}
          />
        </div>

        <aside
          className="hall-editor-properties"
          aria-label="Свойства объекта"
          data-mobile-open={mobilePanel === 'properties'}
        >
          <div className="hall-editor-panel-heading">
            <h3>Свойства</h3>
            <button
              type="button"
              className="hall-editor-panel-close"
              aria-label="Закрыть панель"
              onClick={() => setMobilePanel(null)}
            >
              ×
            </button>
          </div>
          {(target || background) && (
            <p className="hall-editor-selection-path">
              {target ? `${target.kind} · ${target.id}` : 'PDF-подложка'}
            </p>
          )}
          {!target && !background && (
            <p>Выберите объект на схеме или подложку в списке.</p>
          )}
          {zone && (
            <>
              <h4>Зона</h4>
              <label>
                Тип зоны
                <select
                  aria-label="Тип зоны"
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
                  <option value="seated">С местами</option>
                  <option value="ga">Без мест (GA)</option>
                </select>
              </label>
              {zone.kind === 'ga' && (
                <PropertyField
                  label="Вместимость GA"
                  value={zone.capacity ?? 20}
                  disabled={readonly}
                  onCommit={(capacity) =>
                    updateZone(zone, { ...zone, capacity: Number(capacity) })
                  }
                />
              )}
              <button
                type="button"
                disabled={readonly || !bounds}
                onClick={() => {
                  if (!bounds) return;
                  updateZone(zone, {
                    ...zone,
                    polygon: [
                      worldPointSchema.parse({
                        x: bounds.minX,
                        y: bounds.minY,
                      }),
                      worldPointSchema.parse({
                        x: bounds.maxX,
                        y: bounds.minY,
                      }),
                      worldPointSchema.parse({
                        x: bounds.maxX,
                        y: bounds.maxY,
                      }),
                      worldPointSchema.parse({
                        x: bounds.minX,
                        y: bounds.maxY,
                      }),
                    ],
                  });
                }}
              >
                Преобразовать в полигон
              </button>
              {zone.polygon?.map((point, index) => (
                <div key={index}>
                  <PropertyField
                    label={`Вершина ${index + 1} X`}
                    value={point.x}
                    disabled={readonly}
                    onCommit={(x) =>
                      updateZone(zone, {
                        ...zone,
                        polygon: zone.polygon?.map((item, i) =>
                          i === index
                            ? worldPointSchema.parse({ ...item, x: Number(x) })
                            : item,
                        ),
                      })
                    }
                  />
                  <PropertyField
                    label={`Вершина ${index + 1} Y`}
                    value={point.y}
                    disabled={readonly}
                    onCommit={(y) =>
                      updateZone(zone, {
                        ...zone,
                        polygon: zone.polygon?.map((item, i) =>
                          i === index
                            ? worldPointSchema.parse({ ...item, y: Number(y) })
                            : item,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              <PropertyField
                label="Название зоны"
                value={zone.name}
                disabled={readonly}
                onCommit={(name) =>
                  updateZone(zone, { ...zone, name: String(name) })
                }
              />
              {bounds && !zone.polygon && (
                <>
                  <PropertyField
                    label="X зоны"
                    value={bounds.minX}
                    disabled={readonly}
                    onCommit={(x) => {
                      const delta = Number(x) - bounds.minX;
                      updateBounds(zone.id, bounds, {
                        ...bounds,
                        minX: Number(x),
                        maxX: bounds.maxX + delta,
                      });
                    }}
                  />
                  <PropertyField
                    label="Y зоны"
                    value={bounds.minY}
                    disabled={readonly}
                    onCommit={(y) => {
                      const delta = Number(y) - bounds.minY;
                      updateBounds(zone.id, bounds, {
                        ...bounds,
                        minY: Number(y),
                        maxY: bounds.maxY + delta,
                      });
                    }}
                  />
                  <PropertyField
                    label="Ширина зоны"
                    value={bounds.maxX - bounds.minX}
                    disabled={readonly}
                    onCommit={(width) =>
                      updateBounds(zone.id, bounds, {
                        ...bounds,
                        maxX: bounds.minX + Number(width),
                      })
                    }
                  />
                  <PropertyField
                    label="Высота зоны"
                    value={bounds.maxY - bounds.minY}
                    disabled={readonly}
                    onCommit={(height) =>
                      updateBounds(zone.id, bounds, {
                        ...bounds,
                        maxY: bounds.minY + Number(height),
                      })
                    }
                  />
                </>
              )}
            </>
          )}
          {decoration && (
            <>
              <h4>
                {decoration.kind === 'stage'
                  ? 'Сцена'
                  : decoration.kind === 'obstacle'
                    ? 'Препятствие'
                    : 'Подпись'}
              </h4>
              <PropertyField
                label="Текст объекта"
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
                    label="X подписи"
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
                    label="Y подписи"
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
              ) : (
                decoration.polygon.map((point, index) => (
                  <div key={index}>
                    <PropertyField
                      label={`Вершина объекта ${index + 1} X`}
                      value={point.x}
                      disabled={readonly}
                      onCommit={(x) =>
                        updateDecoration(decoration, {
                          ...decoration,
                          polygon: decoration.polygon.map((item, i) =>
                            i === index
                              ? worldPointSchema.parse({
                                  ...item,
                                  x: Number(x),
                                })
                              : item,
                          ),
                        })
                      }
                    />
                    <PropertyField
                      label={`Вершина объекта ${index + 1} Y`}
                      value={point.y}
                      disabled={readonly}
                      onCommit={(y) =>
                        updateDecoration(decoration, {
                          ...decoration,
                          polygon: decoration.polygon.map((item, i) =>
                            i === index
                              ? worldPointSchema.parse({
                                  ...item,
                                  y: Number(y),
                                })
                              : item,
                          ),
                        })
                      }
                    />
                  </div>
                ))
              )}
            </>
          )}
          {seat && (
            <>
              <h4>Место</h4>
              <PropertyField
                label="Номер места"
                value={seat.label}
                disabled={readonly}
                onCommit={(label) =>
                  updateSeat(seat, { ...seat, label: String(label) })
                }
              />
              <PropertyField
                label="X места"
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
                label="Y места"
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
              <h4>Ряд</h4>
              <PropertyField
                label="Название ряда"
                value={row.name}
                disabled={readonly}
                onCommit={(name) =>
                  updateRow(row, { ...row, name: String(name) })
                }
              />
              {lineCurve && (
                <>
                  <PropertyField
                    label="Начало X"
                    value={lineCurve.start.x}
                    disabled={readonly}
                    onCommit={(x) =>
                      updateRow(row, {
                        ...row,
                        curve: {
                          ...lineCurve,
                          start: { ...lineCurve.start, x: Number(x) },
                        },
                      })
                    }
                  />
                  <PropertyField
                    label="Начало Y"
                    value={lineCurve.start.y}
                    disabled={readonly}
                    onCommit={(y) =>
                      updateRow(row, {
                        ...row,
                        curve: {
                          ...lineCurve,
                          start: { ...lineCurve.start, y: Number(y) },
                        },
                      })
                    }
                  />
                  <PropertyField
                    label="Конец X"
                    value={lineCurve.end.x}
                    disabled={readonly}
                    onCommit={(x) =>
                      updateRow(row, {
                        ...row,
                        curve: {
                          ...lineCurve,
                          end: { ...lineCurve.end, x: Number(x) },
                        },
                      })
                    }
                  />
                  <PropertyField
                    label="Конец Y"
                    value={lineCurve.end.y}
                    disabled={readonly}
                    onCommit={(y) =>
                      updateRow(row, {
                        ...row,
                        curve: {
                          ...lineCurve,
                          end: { ...lineCurve.end, y: Number(y) },
                        },
                      })
                    }
                  />
                </>
              )}
              {arcCurve && (
                <>
                  <PropertyField
                    label="Центр X"
                    value={arcCurve.center.x}
                    disabled={readonly}
                    onCommit={(x) =>
                      updateRow(row, {
                        ...row,
                        curve: {
                          ...arcCurve,
                          center: { ...arcCurve.center, x: Number(x) },
                        },
                      })
                    }
                  />
                  <PropertyField
                    label="Центр Y"
                    value={arcCurve.center.y}
                    disabled={readonly}
                    onCommit={(y) =>
                      updateRow(row, {
                        ...row,
                        curve: {
                          ...arcCurve,
                          center: { ...arcCurve.center, y: Number(y) },
                        },
                      })
                    }
                  />
                  <PropertyField
                    label="Радиус ряда"
                    value={arcCurve.radius}
                    disabled={readonly}
                    onCommit={(radius) =>
                      updateRow(row, {
                        ...row,
                        curve: { ...arcCurve, radius: Number(radius) },
                      })
                    }
                  />
                  <PropertyField
                    label="Угол начала"
                    value={arcCurve.startAngle}
                    disabled={readonly}
                    onCommit={(startAngle) =>
                      updateRow(row, {
                        ...row,
                        curve: { ...arcCurve, startAngle: Number(startAngle) },
                      })
                    }
                  />
                  <PropertyField
                    label="Угол конца"
                    value={arcCurve.endAngle}
                    disabled={readonly}
                    onCommit={(endAngle) =>
                      updateRow(row, {
                        ...row,
                        curve: { ...arcCurve, endAngle: Number(endAngle) },
                      })
                    }
                  />
                </>
              )}
              {bezierCurve &&
                (['p0', 'p1', 'p2', 'p3'] as const).map((pointKey) => (
                  <div key={pointKey}>
                    <PropertyField
                      label={`${pointKey} X`}
                      value={bezierCurve[pointKey].x}
                      disabled={readonly}
                      onCommit={(x) =>
                        updateRow(row, {
                          ...row,
                          curve: {
                            ...bezierCurve,
                            [pointKey]: {
                              ...bezierCurve[pointKey],
                              x: Number(x),
                            },
                          },
                        })
                      }
                    />
                    <PropertyField
                      label={`${pointKey} Y`}
                      value={bezierCurve[pointKey].y}
                      disabled={readonly}
                      onCommit={(y) =>
                        updateRow(row, {
                          ...row,
                          curve: {
                            ...bezierCurve,
                            [pointKey]: {
                              ...bezierCurve[pointKey],
                              y: Number(y),
                            },
                          },
                        })
                      }
                    />
                  </div>
                ))}
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
              <h4>Стол</h4>
              <PropertyField
                label="Название стола"
                value={table.label}
                disabled={readonly}
                onCommit={(label) =>
                  updateTable(table, { ...table, label: String(label) })
                }
              />
              <PropertyField
                label="X стола"
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
                label="Y стола"
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
                label="Поворот (рад)"
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
                  label="Радиус стола"
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
                    label="Ширина стола"
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
                    label="Высота стола"
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
                  <h4>PDF-подложка</h4>
                  <p>{asset?.name ?? 'Файл не найден'}</p>

                  <label className="hall-editor-field">
                    Страница PDF
                    <select
                      aria-label="Страница PDF"
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
                    label="X подложки"
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
                    label="Y подложки"
                    value={background.position.y}
                    disabled={readonly || background.locked}
                    onCommit={(y) =>
                      updateBackground({
                        ...background,
                        position: { ...background.position, y: Number(y) },
                      })
                    }
                  />

                  <PropertyField
                    label="Масштаб подложки"
                    value={background.scale}
                    disabled={readonly || background.locked}
                    onCommit={(scale) =>
                      updateBackground({ ...background, scale: Number(scale) })
                    }
                  />

                  <PropertyField
                    label="Поворот подложки (°)"
                    value={
                      Math.round(
                        ((background.rotationRadians * 180) / Math.PI) * 1000,
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
                    label="Прозрачность подложки"
                    value={background.opacity}
                    disabled={readonly || background.locked}
                    onCommit={(opacity) =>
                      updateBackground({
                        ...background,
                        opacity: Number(opacity),
                      })
                    }
                  />

                  <label className="hall-editor-field">
                    Видимая
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
                    Заблокирована
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
                    Заменить PDF
                    <input
                      aria-label="Заменить PDF"
                      type="file"
                      accept="application/pdf,.pdf"
                      disabled={readonly || importingPdf || background.locked}
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
                    Удалить подложку
                  </button>
                </>
              );
            })()}
          {target && (
            <button type="button" disabled={readonly} onClick={handleDelete}>
              Удалить объект
            </button>
          )}
          {validationIssues.length > 0 && (
            <section
              className="hall-editor-validation"
              aria-label="Проверка схемы"
            >
              <h3>Проверка схемы</h3>
              <p>
                Номера проверяются внутри ряда или стола; для отдельных мест —
                внутри зоны либо этажа.
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
                  Публиковать с предупреждениями
                </label>
              )}
              <ul>
                {validationIssues.slice(0, 20).map((issue, index) => (
                  <li
                    key={`${issue.code}:${issue.targetId ?? index}`}
                    data-severity={issue.severity}
                  >
                    {issue.severity === 'error' ? 'Ошибка' : 'Предупреждение'}:{' '}
                    {issue.message}
                  </li>
                ))}
              </ul>
              {validationIssues.length > 20 && (
                <p>Ещё {validationIssues.length - 20} замечаний</p>
              )}
            </section>
          )}
        </aside>
        {mobilePanel && (
          <button
            type="button"
            className="hall-editor-drawer-scrim"
            aria-label="Закрыть панель"
            onClick={() => setMobilePanel(null)}
          />
        )}
        <nav className="hall-editor-mobile-nav" aria-label="Панели редактора">
          <button
            type="button"
            aria-pressed={tool === 'select'}
            onClick={() => {
              model.toolChanged('select');
              setMobilePanel(null);
            }}
          >
            ↖ <span>Выбор</span>
          </button>
          <button
            type="button"
            aria-pressed={tool === 'row-line'}
            onClick={() => {
              model.toolChanged('row-line');
              setMobilePanel(null);
            }}
          >
            ▤ <span>Ряд</span>
          </button>
          <button
            type="button"
            aria-pressed={mobilePanel === 'tools'}
            onClick={() =>
              setMobilePanel((current) => toggleEditorPanel(current, 'tools'))
            }
          >
            ✥ <span>Инструменты</span>
          </button>
          <button
            type="button"
            aria-pressed={mobilePanel === 'layers'}
            onClick={() =>
              setMobilePanel((current) => toggleEditorPanel(current, 'layers'))
            }
          >
            ▦ <span>Слои</span>
          </button>
          <button
            type="button"
            aria-pressed={mobilePanel === 'properties'}
            onClick={() =>
              setMobilePanel((current) =>
                toggleEditorPanel(current, 'properties'),
              )
            }
          >
            ☷ <span>Свойства</span>
          </button>
        </nav>
      </div>
      <footer className="hall-editor-footer">
        {errorMessage ? (
          <span role="alert">{errorMessage}</span>
        ) : (
          <span>
            {state.past.length > 0
              ? `${state.past.length} изменений`
              : 'Нет изменений'}{' '}
            · Щелчок создаёт объект · Перетаскивание меняет положение
          </span>
        )}
      </footer>
    </section>
  );
}
