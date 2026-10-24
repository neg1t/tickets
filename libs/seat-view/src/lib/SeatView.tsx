import { useId, useState } from 'react';
import { useUnit } from 'effector-react';
import type { LayoutSnapshot, SeatStatus } from '@hall-platform/domain';
import type { SpatialBounds } from '@hall-platform/geometry';
import {
  HallViewer,
  type HallTarget,
  type HallViewerLabels,
} from '@hall-platform/renderer-konva';
import { createSeatViewModel } from './seatView.model.js';

export type PublishedHallLayout = {
  readonly hallName: string;
  readonly snapshot: LayoutSnapshot;
  readonly zoneBounds?: Readonly<Record<string, SpatialBounds>>;
};

export type SeatSelectionItem =
  | { readonly kind: 'seat'; readonly seatId: string }
  | {
      readonly kind: 'generalAdmission';
      readonly zoneId: string;
      readonly quantity: number;
    };

export type SeatViewData = {
  readonly occurrenceId: string;
  readonly selection: readonly SeatSelectionItem[];
};

export type SeatAvailabilityMap = {
  readonly seats: Readonly<Record<string, SeatStatus>>;
  readonly zones?: Readonly<
    Record<
      string,
      { readonly available: number; readonly maxPerOrder?: number }
    >
  >;
};

export type SeatPrice = {
  readonly amount: number;
  readonly currency: string;
  readonly category?: string;
};

export type SeatPriceMap = {
  readonly seats: Readonly<Record<string, SeatPrice>>;
  readonly zones?: Readonly<Record<string, SeatPrice>>;
};

export type SeatViewProps = {
  readonly layout: PublishedHallLayout;
  readonly occurrenceId: string;
  readonly availability: SeatAvailabilityMap;
  readonly prices: SeatPriceMap;
  readonly selection: readonly SeatSelectionItem[];
  readonly locale?: string;
  readonly loading?: boolean;
  readonly buying?: boolean;
  readonly error?: string | null;
  readonly onSelectionChange: (selection: SeatSelectionItem[]) => void;
  readonly onBuyClick: (data: SeatViewData) => void | Promise<void>;
  readonly onError?: (error: Error) => void;
};

const statusColors: Record<SeatStatus, string> = {
  available: '#18784a',
  held: '#b97819',
  sold: '#9a4450',
  blocked: '#67717e',
  unavailable: '#a5adb6',
};

const translations = {
  ru: {
    seats: 'Места',
    seat: 'Место',
    floor: 'Этаж',
    allZones: 'Все сектора',
    quantity: 'Количество билетов',
    generalAdmission: 'Свободное размещение',
    selected: 'Выбрано',
    buy: 'Купить',
    buying: 'Ожидание…',
    loading: 'Загрузка доступности…',
    total: 'Итого',
    missingPrice: 'Цена не указана',
    invalidSelection: 'Выбранные места больше недоступны',
    remove: 'Убрать',
    legend: 'Легенда мест',
    statuses: {
      available: 'доступно',
      held: 'удерживается',
      sold: 'продано',
      blocked: 'заблокировано',
      unavailable: 'недоступно',
      selected: 'выбрано',
    },
  },
  en: {
    seats: 'Seats',
    seat: 'Seat',
    floor: 'Floor',
    allZones: 'All sections',
    quantity: 'Ticket quantity',
    generalAdmission: 'General admission',
    selected: 'Selected',
    buy: 'Buy',
    buying: 'Waiting…',
    loading: 'Loading availability…',
    total: 'Total',
    missingPrice: 'Price unavailable',
    invalidSelection: 'Selected places are no longer available',
    remove: 'Remove',
    legend: 'Seat legend',
    statuses: {
      available: 'available',
      held: 'held',
      sold: 'sold',
      blocked: 'blocked',
      unavailable: 'unavailable',
      selected: 'selected',
    },
  },
} as const;

const englishViewerLabels: HallViewerLabels = {
  hall: 'Hall map',
  toolbar: 'Map controls',
  select: 'Select',
  pan: 'Pan',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fit: 'Fit',
  reset: '100%',
  zoomSelection: 'Zoom to selection',
  zone: 'Section',
  zoomZone: 'Zoom to section',
  allZones: 'All sections',
  floor: 'Floor',
  scale: 'Zoom',
  selected: 'Selected',
  grid: 'Grid',
};

function formatPrice(price: SeatPrice, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: price.currency,
      maximumFractionDigits: 2,
    }).format(price.amount);
  } catch {
    return `${price.amount} ${price.currency}`;
  }
}

export function SeatView(props: SeatViewProps) {
  const {
    layout,
    occurrenceId,
    availability,
    prices,
    selection,
    locale = 'ru-RU',
    loading = false,
    buying = false,
    error = null,
    onSelectionChange,
    onBuyClick,
    onError,
  } = props;
  const labels = locale.toLowerCase().startsWith('en')
    ? translations.en
    : translations.ru;
  const [model] = useState(() =>
    createSeatViewModel(layout.snapshot.floors[0]?.id ?? ''),
  );
  const [floorId, zoneId, selectFloor, selectZone] = useUnit([
    model.$floorId,
    model.$zoneId,
    model.floorSelected,
    model.zoneSelected,
  ]);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const instanceId = useId().replace(/:/g, '');
  const activeFloorId = layout.snapshot.floors.some(
    (floor) => floor.id === floorId,
  )
    ? floorId
    : (layout.snapshot.floors[0]?.id ?? '');
  const activeZoneId = layout.snapshot.zones.some(
    (zone) => zone.id === zoneId && zone.floorId === activeFloorId,
  )
    ? zoneId
    : null;
  const zones = layout.snapshot.zones.filter(
    (zone) => zone.floorId === activeFloorId,
  );
  const seats = layout.snapshot.seats.filter(
    (seat) =>
      seat.floorId === activeFloorId &&
      (!activeZoneId || seat.zoneId === activeZoneId) &&
      seat.label.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const seatById = new Map<string, (typeof layout.snapshot.seats)[number]>(
    layout.snapshot.seats.map((seat) => [seat.id, seat]),
  );
  const zoneById = new Map<string, (typeof layout.snapshot.zones)[number]>(
    layout.snapshot.zones.map((zone) => [zone.id, zone]),
  );
  const selectedSeatIds = new Set(
    selection.flatMap((item) => (item.kind === 'seat' ? [item.seatId] : [])),
  );
  const seatAppearance = Object.fromEntries(
    layout.snapshot.seats.map((seat) => [
      seat.id,
      {
        fill: statusColors[availability.seats[seat.id] ?? 'unavailable'],
      },
    ]),
  );
  const selectedTargets: HallTarget[] = [...selectedSeatIds].map((id) => ({
    kind: 'seat',
    id,
  }));
  const locked = loading || buying || pending;
  const selectedCount = selection.reduce(
    (count, item) =>
      count + (item.kind === 'seat' ? 1 : Math.max(0, item.quantity)),
    0,
  );
  const selectedPrices = selection.flatMap((item) => {
    const price =
      item.kind === 'seat'
        ? prices.seats[item.seatId]
        : prices.zones?.[item.zoneId];
    return price
      ? [{ price, quantity: item.kind === 'seat' ? 1 : item.quantity }]
      : [];
  });
  const currencies = new Set(selectedPrices.map(({ price }) => price.currency));
  const total =
    selectedPrices.length === selection.length && currencies.size === 1
      ? {
          amount: selectedPrices.reduce(
            (sum, { price, quantity }) => sum + price.amount * quantity,
            0,
          ),
          currency: selectedPrices[0]?.price.currency ?? 'RUB',
        }
      : null;
  const selectionValid = selection.every((item) => {
    if (item.kind === 'seat')
      return (
        seatById.has(item.seatId) &&
        availability.seats[item.seatId] === 'available' &&
        Boolean(prices.seats[item.seatId])
      );
    const zone = availability.zones?.[item.zoneId];
    return (
      zoneById.has(item.zoneId) &&
      Boolean(prices.zones?.[item.zoneId]) &&
      Boolean(
        zone &&
        item.quantity > 0 &&
        item.quantity <= zone.available &&
        item.quantity <= (zone.maxPerOrder ?? zone.available),
      )
    );
  });

  function handleSeatClick(seatId: string) {
    if (locked) return;
    if (selectedSeatIds.has(seatId)) {
      onSelectionChange(
        selection.filter(
          (item) => item.kind !== 'seat' || item.seatId !== seatId,
        ),
      );
      return;
    }
    if (availability.seats[seatId] !== 'available' || !prices.seats[seatId])
      return;
    onSelectionChange([...selection, { kind: 'seat', seatId }]);
  }

  function handleQuantityChange(zoneId: string, rawValue: string) {
    if (locked) return;
    const zone = availability.zones?.[zoneId];
    if (!zone) return;
    const limit = Math.min(zone.available, zone.maxPerOrder ?? zone.available);
    const quantity = Math.min(
      limit,
      Math.max(0, Math.trunc(Number(rawValue) || 0)),
    );
    onSelectionChange([
      ...selection.filter(
        (item) => item.kind !== 'generalAdmission' || item.zoneId !== zoneId,
      ),
      ...(quantity > 0
        ? [{ kind: 'generalAdmission' as const, zoneId, quantity }]
        : []),
    ]);
  }

  function handleCanvasClick(_point: unknown, target: HallTarget | null) {
    if (target?.kind === 'seat') handleSeatClick(target.id);
    if (target?.kind === 'zone') selectZone(target.id);
  }

  async function handleBuyClick() {
    if (locked || selectedCount === 0 || !selectionValid || !total) return;
    setLocalError(null);
    setPending(true);
    try {
      await onBuyClick({ occurrenceId, selection: [...selection] });
    } catch (cause) {
      const failure = cause instanceof Error ? cause : new Error(String(cause));
      setLocalError(failure.message);
      onError?.(failure);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="seat-view"
      aria-label={`${labels.seats}: ${layout.hallName}`}
    >
      {loading && <p role="status">{labels.loading}</p>}

      {(error || localError) && <p role="alert">{error || localError}</p>}

      <div className="seat-view-layout">
        <div className="seat-view-map">
          <HallViewer
            snapshot={layout.snapshot}
            hallName={layout.hallName}
            {...(layout.zoneBounds ? { zoneBounds: layout.zoneBounds } : {})}
            activeTool="pick"
            selectedTargets={selectedTargets}
            {...(locale.toLowerCase().startsWith('en')
              ? { labels: englishViewerLabels }
              : {})}
            seatAppearance={seatAppearance}
            stageId={`seat-stage-${instanceId}`}
            fitKey={`${layout.snapshot.id}:${activeFloorId}:${activeZoneId ?? ''}`}
            focusedFloorId={activeFloorId}
            {...(activeZoneId ? { focusedZoneId: activeZoneId } : {})}
            height={400}
            onCanvasClick={handleCanvasClick}
            onFloorChange={selectFloor}
          />

          <div className="seat-view-legend" aria-label={labels.legend}>
            {(
              ['available', 'held', 'sold', 'blocked', 'unavailable'] as const
            ).map((status) => (
              <span key={status}>
                <i style={{ backgroundColor: statusColors[status] }} />
                {labels.statuses[status]}
              </span>
            ))}
            <span>
              <i className="seat-view-selected-dot" />
              {labels.statuses.selected}
            </span>
          </div>
        </div>

        <div className="seat-view-panel">
          <div className="seat-view-filters">
            <label>
              {labels.floor}
              <select
                aria-label={labels.floor}
                value={activeFloorId}
                onChange={(event) => selectFloor(event.target.value)}
              >
                {layout.snapshot.floors.map((floor) => (
                  <option key={floor.id} value={floor.id}>
                    {floor.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.allZones}
              <select
                aria-label={labels.allZones}
                value={activeZoneId ?? ''}
                onChange={(event) => selectZone(event.target.value || null)}
              >
                <option value="">{labels.allZones}</option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="seat-view-search">
            {labels.seats}
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <div className="seat-view-seat-list" aria-label={labels.seats}>
            {seats.map((seat) => {
              const status = availability.seats[seat.id] ?? 'unavailable';
              const price = prices.seats[seat.id];
              const available = status === 'available' && Boolean(price);
              return (
                <button
                  key={seat.id}
                  type="button"
                  aria-label={`${labels.seat} ${seat.label} — ${labels.statuses[status]}`}
                  aria-pressed={selectedSeatIds.has(seat.id)}
                  disabled={
                    locked || (!available && !selectedSeatIds.has(seat.id))
                  }
                  onClick={() => handleSeatClick(seat.id)}
                >
                  <span>{seat.label}</span>
                  <span>{labels.statuses[status]}</span>
                  <span>
                    {price ? formatPrice(price, locale) : labels.missingPrice}
                  </span>
                  {price?.category && <small>{price.category}</small>}
                </button>
              );
            })}
          </div>

          {zones
            .filter(
              (zone) =>
                (!activeZoneId || zone.id === activeZoneId) &&
                availability.zones?.[zone.id],
            )
            .map((zone) => {
              const stock = availability.zones?.[zone.id];
              if (!stock) return null;
              const limit = Math.min(
                stock.available,
                stock.maxPerOrder ?? stock.available,
              );
              const selectedZone = selection.find(
                (item) =>
                  item.kind === 'generalAdmission' && item.zoneId === zone.id,
              );
              const quantity =
                selectedZone?.kind === 'generalAdmission'
                  ? selectedZone.quantity
                  : 0;
              const price = prices.zones?.[zone.id];
              return (
                <label className="seat-view-general-admission" key={zone.id}>
                  <span>
                    {labels.generalAdmission}: {zone.name}
                  </span>
                  <input
                    type="number"
                    aria-label={`${labels.quantity}: ${zone.name}`}
                    min={0}
                    max={limit}
                    value={quantity}
                    disabled={
                      locked || ((!price || limit === 0) && quantity === 0)
                    }
                    onChange={(event) =>
                      handleQuantityChange(zone.id, event.target.value)
                    }
                  />
                  <span>
                    {price ? formatPrice(price, locale) : labels.missingPrice}
                  </span>
                </label>
              );
            })}

          <div className="seat-view-basket" aria-live="polite">
            <strong>
              {labels.selected}: {selectedCount}
            </strong>
            {selection.map((item) => {
              const name =
                item.kind === 'seat'
                  ? `${labels.seat} ${seatById.get(item.seatId)?.label ?? item.seatId}`
                  : `${zoneById.get(item.zoneId)?.name ?? item.zoneId} × ${item.quantity}`;
              const key =
                item.kind === 'seat'
                  ? `seat:${item.seatId}`
                  : `zone:${item.zoneId}`;
              return (
                <div className="seat-view-basket-item" key={key}>
                  <span>{name}</span>
                  <button
                    type="button"
                    aria-label={`${labels.remove} ${name}`}
                    disabled={locked}
                    onClick={() =>
                      onSelectionChange(
                        selection.filter((candidate) =>
                          item.kind === 'seat'
                            ? candidate.kind !== 'seat' ||
                              candidate.seatId !== item.seatId
                            : candidate.kind !== 'generalAdmission' ||
                              candidate.zoneId !== item.zoneId,
                        ),
                      )
                    }
                  >
                    {labels.remove}
                  </button>
                </div>
              );
            })}
            {selectedCount > 0 && (
              <span>
                {labels.total}:{' '}
                {total ? formatPrice(total, locale) : labels.missingPrice}
              </span>
            )}
            {selectedCount > 0 && !selectionValid && (
              <span role="alert">{labels.invalidSelection}</span>
            )}
            <button
              type="button"
              disabled={
                locked || selectedCount === 0 || !selectionValid || !total
              }
              onClick={() => void handleBuyClick()}
            >
              {locked && (buying || pending) ? labels.buying : labels.buy}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
