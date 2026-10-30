// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import type { BuyerOccurrenceSummary } from '@hall-platform/api-contracts';
import type { PurchaseDataSource } from './lib/model/purchase.types.js';
import { mountTicketPurchaseWidget } from './dom.js';

afterEach(cleanup);

const occurrence: BuyerOccurrenceSummary = {
  occurrenceId: 'dom-occurrence',
  eventId: 'dom-event',
  title: 'DOM Example',
  startsAt: '2026-09-04T20:00:00+04:00',
  timeZone: 'Asia/Yerevan',
  venue: { name: 'Concert hall', city: 'Yerevan' },
  salesStatus: 'open',
  currency: 'AMD',
  capabilities: { seats: true, generalAdmission: true },
};

describe('ticket-purchase DOM adapter', () => {
  it('mounts and unmounts an isolated widget in the host-owned element', async () => {
    const container = document.createElement('div');
    const dataSource = {} as PurchaseDataSource;
    document.body.append(container);
    let mount: ReturnType<typeof mountTicketPurchaseWidget> | undefined;

    await act(async () => {
      mount = mountTicketPurchaseWidget(container, {
        dataSource,
        instanceId: 'dom-instance',
        occurrence,
        children: <p>Host composition</p>,
      });
    });

    expect(container.querySelector('[data-ticket-purchase-instance="dom-instance"]')).toBeTruthy();
    expect(screen.getByText('Host composition')).toBeTruthy();

    await act(async () => mount?.unmount());
    expect(container.querySelector('[data-ticket-purchase-root]')).toBeNull();
    container.remove();
  });
});
