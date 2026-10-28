import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutSnapshotSchema } from '@hall-platform/domain';
import type { HallTarget } from '@hall-platform/renderer-core';
import { PricingEditor, type PricingEditorProps } from './PricingEditor.js';

vi.mock('@hall-platform/hall-viewer', () => ({
  HallViewport: (props: {
    viewerMode?: string;
    selectableKinds?: readonly string[];
    selectedTargets?: readonly HallTarget[];
    onSelectionChange?: (targets: readonly HallTarget[]) => void;
  }) => (
    <div
      data-testid="pricing-map"
      data-mode={props.viewerMode}
      data-selectable-kinds={props.selectableKinds?.join(',')}
    >
      <button
        type="button"
        onClick={() =>
          props.onSelectionChange?.([{ kind: 'zone', id: 'zone-main' }])
        }
      >
        mock-select-zone
      </button>
      <button
        type="button"
        onClick={() => props.onSelectionChange?.([{ kind: 'zone', id: 'zone-ga' }])}
      >
        mock-select-ga-zone
      </button>
      <button
        type="button"
        onClick={() =>
          props.onSelectionChange?.([{ kind: 'seat', id: 'seat-1' }])
        }
      >
        mock-select-seat
      </button>
      <span data-testid="selected-kind-count">{props.selectedTargets?.length}</span>
      <span data-testid="selectable-kinds">{props.selectableKinds?.join(',')}</span>
    </div>
  ),
}));

afterEach(cleanup);

const snapshot = layoutSnapshotSchema.parse({
  id: 'snapshot-1',
  layoutVersionId: 'layout-1',
  floors: [{ id: 'floor-1', layoutVersionId: 'layout-1', name: 'Основной' }],
  zones: [
    {
      id: 'zone-main',
      floorId: 'floor-1',
      name: 'Партер',
      polygon: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    },
    { id: 'zone-ga', floorId: 'floor-1', name: 'Танцпол', kind: 'ga', capacity: 500 },
  ],
  rows: [],
  seats: [
    {
      id: 'seat-1',
      floorId: 'floor-1',
      zoneId: 'zone-main',
      label: 'A1',
      position: { x: 1, y: 1 },
      placement: { kind: 'standalone' },
    },
    {
      id: 'seat-2', floorId: 'floor-1', zoneId: 'zone-main', label: 'A2',
      position: { x: 2, y: 1 }, placement: { kind: 'standalone' },
    },
  ],
  tables: [],
  backgrounds: [],
  decorations: [],
});

const catalog: PricingEditorProps['catalog'] = {
  occurrenceId: 'occurrence-1',
  revision: 2,
  items: [
    {
      id: 'standard',
      name: 'Стандарт',
      color: '#336699',
      status: 'active',
      price: { amountMinor: 100000, currency: 'RUB' },
    },
    {
      id: 'vip', name: 'VIP', color: '#663399', status: 'active',
      price: { amountMinor: 200000, currency: 'RUB' },
    },
    {
      id: 'economy', name: 'Эконом', color: '#339966', status: 'active',
      price: { amountMinor: 50000, currency: 'RUB' },
    },
  ],
};

const document: PricingEditorProps['value'] = {
  schemaVersion: 1,
  occurrenceId: 'occurrence-1',
  layoutVersionId: 'layout-1',
  revision: 4,
  catalogRevision: 2,
  assignments: { seatSegments: {}, gaZoneSegments: {} },
};

function editorProps(overrides: Partial<PricingEditorProps> = {}) {
  return {
    layout: { hallName: 'Большой зал', snapshot },
    value: document,
    catalog,
    onChange: vi.fn(),
    ...overrides,
  } satisfies PricingEditorProps;
}

describe('PricingEditor', () => {
  it('assigns a whole zone through the selection-only viewer and emits the controlled value', () => {
    const props = editorProps();
    render(<PricingEditor {...props} />);

    expect(screen.getByTestId('pricing-map').getAttribute('data-mode')).toBe(
      'selection',
    );
    fireEvent.click(screen.getByRole('button', { name: 'mock-select-zone' }));
    expect(screen.getByTestId('selected-kind-count').textContent).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Назначить выбранным' }));

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        assignments: { seatSegments: { 'seat-1': 'standard', 'seat-2': 'standard' }, gaZoneSegments: {} },
      }),
      expect.objectContaining({ operation: 'assign', affectedSeatCount: 2 }),
    );
  });

  it('overwrites zone exceptions and undo restores the prior per-seat assignments', () => {
    const initial = {
      ...document,
      assignments: { seatSegments: { 'seat-1': 'standard', 'seat-2': 'vip' }, gaZoneSegments: {} },
    };
    const props = editorProps({ value: initial });
    render(<PricingEditor {...props} />);

    fireEvent.click(screen.getByRole('radio', { name: /Эконом/ }));
    fireEvent.click(screen.getByRole('button', { name: 'mock-select-zone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить выбранным' }));
    expect(props.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignments: { seatSegments: { 'seat-1': 'economy', 'seat-2': 'economy' }, gaZoneSegments: {} } }),
      expect.objectContaining({ operation: 'assign', affectedSeatCount: 2 }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(props.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignments: initial.assignments }),
      expect.objectContaining({ operation: 'undo', affectedSeatCount: 2 }),
    );
  });

  it('allows a manual seat override and keeps GA assignments separate from seats', () => {
    const props = editorProps();
    render(<PricingEditor {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'mock-select-seat' }));
    fireEvent.click(screen.getByRole('radio', { name: /VIP/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить выбранным' }));
    expect(props.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignments: { seatSegments: { 'seat-1': 'vip' }, gaZoneSegments: {} } }),
      expect.objectContaining({ operation: 'assign', affectedSeatCount: 1 }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'mock-select-ga-zone' }));
    fireEvent.click(screen.getByRole('radio', { name: /Стандарт/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить выбранным' }));
    expect(props.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignments: { seatSegments: { 'seat-1': 'vip' }, gaZoneSegments: { 'zone-ga': 'standard' } } }),
      expect.objectContaining({ operation: 'assign', affectedSeatCount: 0, affectedGaZoneCount: 1 }),
    );
    expect(snapshot.zones.find(({ id }) => id === 'zone-ga')?.capacity).toBe(500);
  });

  it('automatically allows seat and zone targets without mode, selection-operation, or summary controls', () => {
    render(<PricingEditor {...editorProps()} />);

    expect(screen.getByTestId('pricing-map').getAttribute('data-selectable-kinds')).toBe('seat,row,table,zone');
    expect(screen.getByTestId('pricing-map').getAttribute('data-mode')).toBe(
      'selection',
    );
    expect(screen.queryByRole('button', { name: /^Места$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Сектора$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Заменить выбор' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить к выбору' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Убрать из выбора' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Перед применением' })).toBeNull();
    expect(screen.queryByRole('button', { name: /изменить форму|переместить/i })).toBeNull();
  });

  it('does not enable save for an unchanged document', () => {
    const onSave = vi.fn();
    render(<PricingEditor {...editorProps({ onSave })} />);

    expect((screen.getByRole('button', { name: 'Сохранить цены' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
