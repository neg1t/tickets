// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  buyerOccurrenceSummarySchema,
  buyerPublicLayoutSchema,
  buyerPricesSchema,
} from '@hall-platform/api-contracts';
import { createEmptyDraft, layoutSnapshotSchema } from '@hall-platform/domain';
import { OccurrenceSelector } from './OccurrenceSelector.js';
import { SelectedTicketsList } from './SelectedTicketsList.js';

afterEach(cleanup);

const occurrence = (occurrenceId: string, startsAt: string) => buyerOccurrenceSummarySchema.parse({
  occurrenceId,
  eventId: 'event-1',
  title: 'Concert',
  startsAt,
  timeZone: 'Asia/Yerevan',
  venue: { name: 'Hall', city: 'Yerevan' },
  salesStatus: 'open',
  currency: 'AMD',
  capabilities: { seats: true, generalAdmission: true },
});

function purchaseLayout() {
  const draft = createEmptyDraft('Hall');
  const floorId = draft.snapshot.floors[0]?.id;
  if (!floorId) throw new Error('Expected the draft layout to contain a floor');
  return buyerPublicLayoutSchema.parse({
    apiVersion: 'v2',
    hallName: 'Hall',
    snapshot: layoutSnapshotSchema.parse({
      ...draft.snapshot,
      layoutVersionId: 'layout-1',
      floors: draft.snapshot.floors.map((floor) => ({ ...floor, layoutVersionId: 'layout-1' })),
      zones: [{ id: 'zone-ga', floorId, name: 'Партер', kind: 'ga', capacity: 40 }],
      seats: [{ id: 'seat-a', floorId, label: 'A-1', position: { x: 0, y: 0 }, placement: { kind: 'standalone' } }],
    }),
  });
}

describe('ticket selection components', () => {
  it('groups occurrence options by the venue timezone date', () => {
    const onChange = vi.fn();
    const options = [
      occurrence('first', '2026-10-30T20:30:00Z'),
      occurrence('second', '2026-10-30T21:30:00Z'),
    ];
    render(
      <OccurrenceSelector
        occurrences={options}
        selectedOccurrenceId="first"
        timeZone="Asia/Yerevan"
        locale="en-GB"
        onChange={onChange}
      />,
    );

    const select = screen.getByRole('combobox', { name: 'Event time' });
    expect(select.querySelectorAll('optgroup')).toHaveLength(1);
    expect(select.querySelectorAll('option')).toHaveLength(2);
    fireEvent.change(select, { target: { value: 'second' } });
    expect(onChange).toHaveBeenCalledWith('second');
  });

  it('shows a general admission sector and quantity without inventing seat details', () => {
    const layout = purchaseLayout();
    const prices = buyerPricesSchema.parse({
      apiVersion: 'v2', occurrenceId: 'occ-1', layoutVersionId: 'layout-1', pricingRevision: 1,
      currency: 'AMD', seats: { 'seat-a': { amountMinor: 8_000 } }, zones: { 'zone-ga': { amountMinor: 4_500 } },
    });
    const onRemove = vi.fn();
    const onQuantityChange = vi.fn();
    render(
      <SelectedTicketsList
        layout={layout}
        availability={{ seats: { 'seat-a': 'available' }, zones: { 'zone-ga': { available: 30, maxPerOrder: 6 } } }}
        prices={prices}
        selection={[{ kind: 'generalAdmission', zoneId: 'zone-ga', quantity: 2 }]}
        locale="ru-RU"
        onRemove={onRemove}
        onQuantityChange={onQuantityChange}
      />,
    );

    expect(screen.getByText('Партер')).toBeTruthy();
    expect(screen.getByText(/2 ×/)).toBeTruthy();
    expect(screen.getByLabelText('Количество: Партер')).toBeTruthy();
    expect(screen.queryByText(/ряд|место/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить Партер' }));
    expect(onRemove).toHaveBeenCalledWith({ kind: 'generalAdmission', zoneId: 'zone-ga', quantity: 2 });
    fireEvent.change(screen.getByLabelText('Количество: Партер'), { target: { value: '3' } });
    expect(onQuantityChange).toHaveBeenCalledWith('zone-ga', 3);
  });

  it('keeps selections removable when a refreshed layout no longer contains their IDs', () => {
    const layout = purchaseLayout();
    const prices = buyerPricesSchema.parse({
      apiVersion: 'v2', occurrenceId: 'occ-1', layoutVersionId: 'layout-1', pricingRevision: 2,
      currency: 'AMD', seats: {}, zones: {},
    });
    const onRemove = vi.fn();
    render(
      <SelectedTicketsList
        layout={layout}
        availability={{ seats: {}, zones: {} }}
        prices={prices}
        selection={[
          { kind: 'seat', seatId: 'old-seat' },
          { kind: 'generalAdmission', zoneId: 'old-zone', quantity: 2 },
        ]}
        locale="ru-RU"
        onRemove={onRemove}
        onQuantityChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Место old-seat')).toBeTruthy();
    expect(screen.getByText('Сектор old-zone')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить Место old-seat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить Сектор old-zone' }));
    expect(onRemove).toHaveBeenCalledTimes(2);
  });
});
