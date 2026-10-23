import { useEffect, useMemo, useState } from 'react';
import type { Row, Table } from '@hall-platform/domain';
import {
  generateRowSeatSlots,
  generateTableSeatSlots,
  type Vector2,
} from '@hall-platform/geometry';

type SharedProps = {
  readonly readonly: boolean;
  readonly onPreview: (positions: readonly Vector2[]) => void;
};

function numbers(value: string, label: string): number[] {
  if (!value.trim()) return [];
  return value.split(',').map((part) => {
    const number = Number(part.trim());
    if (!Number.isSafeInteger(number) || number < 1)
      throw new RangeError(
        `${label}: укажите положительные целые числа через запятую`,
      );
    return number;
  });
}

function count(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 500)
    throw new RangeError(`${label}: от 1 до 500`);
  return parsed;
}

function sideCount(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 500)
    throw new RangeError(`${label}: от 0 до 500`);
  return parsed;
}

type RowForm = {
  count: string;
  mode: 'even' | 'fixed';
  step: string;
  start: string;
  reverse: boolean;
  skipped: string;
  skippedNumbers: string;
  gaps: string;
};

function rowForm(row: Row, seatCount: number): RowForm {
  const generation = row.generation;
  return {
    count: String(generation?.distribution.count ?? (seatCount || 8)),
    mode: generation?.distribution.kind ?? 'even',
    step: String(
      generation?.distribution.kind === 'fixed'
        ? generation.distribution.step
        : 1,
    ),
    start: String(generation?.numbering?.start ?? 1),
    reverse: generation?.numbering?.direction === 'reverse',
    skipped: (generation?.skippedSlots ?? [])
      .map((slot) => slot + 1)
      .join(', '),
    skippedNumbers: (generation?.numbering?.skippedNumbers ?? []).join(', '),
    gaps: (generation?.gaps ?? [])
      .map((gap) => `${gap.afterSlot + 1}:${gap.length}`)
      .join(', '),
  };
}

export function RowGenerationControls({
  row,
  seatCount,
  readonly,
  onPreview,
  onApply,
}: SharedProps & {
  readonly row: Row;
  readonly seatCount: number;
  readonly onApply: (row: Row) => void;
}) {
  const [form, setForm] = useState(() => rowForm(row, seatCount));
  const preview = useMemo(() => {
    try {
      const requestedCount = count(form.count, 'Мест в ряду');
      const step = Number(form.step);
      const start = count(form.start, 'Начальный номер');
      const skippedSlots = numbers(form.skipped, 'Пропуски').map(
        (number) => number - 1,
      );
      const skippedNumbers = numbers(form.skippedNumbers, 'Пропущенные номера');
      const gaps = form.gaps.trim()
        ? form.gaps.split(',').map((part) => {
            const [after, length] = part.trim().split(':');
            const afterSlot = Number(after) - 1;
            const gapLength = Number(length);
            if (
              !Number.isSafeInteger(afterSlot) ||
              afterSlot < 0 ||
              !Number.isFinite(gapLength) ||
              gapLength <= 0
            )
              throw new RangeError(
                'Проходы: формат место:ширина через запятую',
              );
            return { afterSlot, length: gapLength };
          })
        : [];
      const generation: NonNullable<Row['generation']> = {
        ...row.generation,
        distribution:
          form.mode === 'fixed'
            ? { kind: 'fixed', count: requestedCount, step }
            : { kind: 'even', count: requestedCount },
        skippedSlots,
        gaps,
        numbering: {
          ...row.generation?.numbering,
          start,
          direction: form.reverse ? 'reverse' : 'forward',
          skippedNumbers,
        },
      };
      const next = { ...row, generation };
      const positions = generateRowSeatSlots(next.curve, generation).map(
        ({ position }) => position,
      );
      const changed =
        JSON.stringify(form) !== JSON.stringify(rowForm(row, seatCount));
      return { next, positions, changed, error: null as string | null };
    } catch (error) {
      return {
        next: null,
        positions: [] as Vector2[],
        changed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [form, row, seatCount]);
  useEffect(
    () => onPreview(preview.changed ? preview.positions : []),
    [onPreview, preview],
  );

  return (
    <fieldset disabled={readonly} className="hall-editor-generation">
      <legend>Генерация мест</legend>
      <label>
        Мест в ряду{' '}
        <input
          aria-label="Мест в ряду"
          type="number"
          min={1}
          max={500}
          value={form.count}
          onChange={(event) => setForm({ ...form, count: event.target.value })}
        />
      </label>
      <label>
        Распределение{' '}
        <select
          aria-label="Распределение мест"
          value={form.mode}
          onChange={(event) =>
            setForm({ ...form, mode: event.target.value as RowForm['mode'] })
          }
        >
          <option value="even">Равномерно</option>
          <option value="fixed">С шагом</option>
        </select>
      </label>
      {form.mode === 'fixed' && (
        <label>
          Шаг{' '}
          <input
            aria-label="Шаг мест"
            type="number"
            min="0.1"
            step="0.1"
            value={form.step}
            onChange={(event) => setForm({ ...form, step: event.target.value })}
          />
        </label>
      )}
      <label>
        Начальный номер{' '}
        <input
          aria-label="Начальный номер ряда"
          type="number"
          min={1}
          value={form.start}
          onChange={(event) => setForm({ ...form, start: event.target.value })}
        />
      </label>
      <label>
        Нумерация обратно{' '}
        <input
          aria-label="Обратная нумерация ряда"
          type="checkbox"
          checked={form.reverse}
          onChange={(event) =>
            setForm({ ...form, reverse: event.target.checked })
          }
        />
      </label>
      <label>
        Пропустить позиции{' '}
        <input
          aria-label="Пропустить позиции"
          type="text"
          placeholder="3, 7"
          value={form.skipped}
          onChange={(event) =>
            setForm({ ...form, skipped: event.target.value })
          }
        />
      </label>
      <label>
        Пропустить номера{' '}
        <input
          aria-label="Пропустить номера"
          type="text"
          placeholder="13"
          value={form.skippedNumbers}
          onChange={(event) =>
            setForm({ ...form, skippedNumbers: event.target.value })
          }
        />
      </label>
      <label>
        Проходы (место:ширина){' '}
        <input
          aria-label="Проходы в ряду"
          type="text"
          placeholder="4:1.5"
          value={form.gaps}
          onChange={(event) => setForm({ ...form, gaps: event.target.value })}
        />
      </label>
      {preview.error ? (
        <p role="alert">{preview.error}</p>
      ) : preview.changed ? (
        <p role="status">Предпросмотр: {preview.positions.length} мест</p>
      ) : null}
      <button
        type="button"
        disabled={!preview.changed || !!preview.error}
        onClick={() => {
          if (preview.next) onApply(preview.next);
        }}
      >
        Применить места
      </button>
    </fieldset>
  );
}

type TableForm = {
  count: string;
  top: string;
  right: string;
  bottom: string;
  left: string;
  offset: string;
  start: string;
  reverse: boolean;
  skipped: string;
};

function tableForm(table: Table): TableForm {
  const shape = table.shape;
  return {
    count: String(shape.kind === 'circle' ? shape.seatCount : 0),
    top: String(shape.kind === 'rectangle' ? shape.seatsPerSide.top : 0),
    right: String(shape.kind === 'rectangle' ? shape.seatsPerSide.right : 0),
    bottom: String(shape.kind === 'rectangle' ? shape.seatsPerSide.bottom : 0),
    left: String(shape.kind === 'rectangle' ? shape.seatsPerSide.left : 0),
    offset: String(table.generation?.seatOffset ?? 0.6),
    start: String(table.generation?.numbering?.start ?? 1),
    reverse: table.generation?.numbering?.direction === 'reverse',
    skipped: (table.generation?.skippedSlotKeys ?? []).join(', '),
  };
}

export function TableGenerationControls({
  table,
  readonly,
  onPreview,
  onApply,
}: SharedProps & {
  readonly table: Table;
  readonly onApply: (table: Table) => void;
}) {
  const [form, setForm] = useState(() => tableForm(table));
  const preview = useMemo(() => {
    try {
      const shape: Table['shape'] =
        table.shape.kind === 'circle'
          ? { ...table.shape, seatCount: count(form.count, 'Гостей за столом') }
          : {
              ...table.shape,
              seatsPerSide: {
                top: sideCount(form.top, 'Сверху'),
                right: sideCount(form.right, 'Справа'),
                bottom: sideCount(form.bottom, 'Снизу'),
                left: sideCount(form.left, 'Слева'),
              },
            };
      if (
        shape.kind === 'rectangle' &&
        Object.values(shape.seatsPerSide).every((value) => value === 0)
      )
        throw new RangeError('Нужно хотя бы одно место за столом');
      const offset = Number(form.offset);
      if (!Number.isFinite(offset) || offset < 0)
        throw new RangeError('Отступ стула должен быть неотрицательным');
      const generation: NonNullable<Table['generation']> = {
        ...table.generation,
        seatOffset: offset,
        skippedSlotKeys: form.skipped.trim()
          ? form.skipped
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean)
          : [],
        numbering: {
          ...table.generation?.numbering,
          start: count(form.start, 'Начальный номер'),
          direction: form.reverse ? 'reverse' : 'forward',
        },
      };
      const next = { ...table, shape, generation };
      const positions = generateTableSeatSlots(next, generation).map(
        ({ position }) => position,
      );
      const changed = JSON.stringify(form) !== JSON.stringify(tableForm(table));
      return { next, positions, changed, error: null as string | null };
    } catch (error) {
      return {
        next: null,
        positions: [] as Vector2[],
        changed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [form, table]);
  useEffect(
    () => onPreview(preview.changed ? preview.positions : []),
    [onPreview, preview],
  );

  return (
    <fieldset disabled={readonly} className="hall-editor-generation">
      <legend>Места за столом</legend>
      {table.shape.kind === 'circle' ? (
        <label>
          Гостей за столом{' '}
          <input
            aria-label="Гостей за столом"
            type="number"
            min={1}
            max={500}
            value={form.count}
            onChange={(event) =>
              setForm({ ...form, count: event.target.value })
            }
          />
        </label>
      ) : (
        (['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <label key={side}>
            {
              {
                top: 'Сверху',
                right: 'Справа',
                bottom: 'Снизу',
                left: 'Слева',
              }[side]
            }{' '}
            <input
              aria-label={`Мест ${side}`}
              type="number"
              min={0}
              max={500}
              value={form[side]}
              onChange={(event) =>
                setForm({ ...form, [side]: event.target.value })
              }
            />
          </label>
        ))
      )}
      <label>
        Отступ стула{' '}
        <input
          aria-label="Отступ стула"
          type="number"
          min={0}
          step="0.1"
          value={form.offset}
          onChange={(event) => setForm({ ...form, offset: event.target.value })}
        />
      </label>
      <label>
        Начальный номер{' '}
        <input
          aria-label="Начальный номер стола"
          type="number"
          min={1}
          value={form.start}
          onChange={(event) => setForm({ ...form, start: event.target.value })}
        />
      </label>
      <label>
        Пропущенные места стола
        <input
          aria-label="Пропущенные места стола"
          type="text"
          value={form.skipped}
          placeholder={
            table.shape.kind === 'circle' ? 'circle:2' : 'top:1, right:0'
          }
          onChange={(event) =>
            setForm({ ...form, skipped: event.target.value })
          }
        />
      </label>
      <label>
        Нумерация обратно{' '}
        <input
          aria-label="Обратная нумерация стола"
          type="checkbox"
          checked={form.reverse}
          onChange={(event) =>
            setForm({ ...form, reverse: event.target.checked })
          }
        />
      </label>
      {preview.error ? (
        <p role="alert">{preview.error}</p>
      ) : preview.changed ? (
        <p role="status">Предпросмотр: {preview.positions.length} мест</p>
      ) : null}
      <button
        type="button"
        disabled={!preview.changed || !!preview.error}
        onClick={() => {
          if (preview.next) onApply(preview.next);
        }}
      >
        Применить места
      </button>
    </fieldset>
  );
}
