import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import type { LayoutSnapshot, SeatStatus } from '@hall-platform/domain';
import type { SpatialBounds } from '@hall-platform/geometry';
import {
  HallViewer,
  type HallTarget,
  type HallViewerLabels,
} from '@hall-platform/renderer-konva';
import { createSeatViewModel } from './seatView.model.js';
import {
  validateSeatPrice,
  validateSelection,
  type SelectionValidationIssueCode,
} from './selectionValidation.js';
import { SeatDetails, type PlaceDetails } from './ui/SeatDetails.js';
import { SeatFilters } from './ui/SeatFilters.js';
import { AccessibleSeatList } from './ui/AccessibleSeatList.js';
import { SelectionBasket } from './ui/SelectionBasket.js';

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
    priceLegend: 'Ценовые категории',
    details: 'Информация о месте',
    row: 'Ряд',
    status: 'Статус',
    price: 'Цена',
    availableOnly: 'Только доступные',
    noSeats: 'По фильтру мест не найдено',
    previousSeats: 'Предыдущие места',
    nextSeats: 'Следующие места',
    seatRange: (first: number, last: number, total: number) =>
      `${first}–${last} из ${total}`,
    invalidPrice: 'Некорректная цена билета',
    duplicate: 'Место выбрано повторно',
    mixedCurrencies: 'В заказе разные валюты',
    invalidQuantity: 'Проверьте количество билетов',
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
    priceLegend: 'Price categories',
    details: 'Seat details',
    row: 'Row',
    status: 'Status',
    price: 'Price',
    availableOnly: 'Available only',
    noSeats: 'No seats match the filter',
    previousSeats: 'Previous seats',
    nextSeats: 'Next seats',
    seatRange: (first: number, last: number, total: number) =>
      `${first}–${last} of ${total}`,
    invalidPrice: 'Invalid ticket price',
    duplicate: 'Seat selected twice',
    mixedCurrencies: 'Mixed currencies in basket',
    invalidQuantity: 'Check ticket quantity',
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
  const [availableOnly, setAvailableOnly] = useState(false);
  const [inspectedSeatId, setInspectedSeatId] = useState<string | null>(null);
  const [hoveredSeatId, setHoveredSeatId] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const contextKey = `${occurrenceId}:${layout.snapshot.id}`;
  const previousContext = useRef(contextKey);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (previousContext.current === contextKey) return;
    previousContext.current = contextKey;
    setSearch('');
    setAvailableOnly(false);
    setInspectedSeatId(null);
    setLocalError(null);
    setPending(false);
    model.floorSelected(layout.snapshot.floors[0]?.id ?? '');
  }, [contextKey, layout.snapshot.floors, model]);
  const instanceId = useId().replace(/:/g, '');
  const layoutIndex = useMemo(() => {
    const snapshot = layout.snapshot;
    const floorById = new Map<string, (typeof snapshot.floors)[number]>(
      snapshot.floors.map((floor) => [floor.id, floor]),
    );
    const zoneById = new Map<string, (typeof snapshot.zones)[number]>(
      snapshot.zones.map((zone) => [zone.id, zone]),
    );
    const rowById = new Map<string, (typeof snapshot.rows)[number]>(
      snapshot.rows.map((row) => [row.id, row]),
    );
    const seatById = new Map<string, (typeof snapshot.seats)[number]>(
      snapshot.seats.map((seat) => [seat.id, seat]),
    );
    const searchTextById = new Map(
      snapshot.seats.map((seat) => [
        seat.id,
        `${seat.label} ${zoneById.get(seat.zoneId ?? '')?.name ?? ''} ${seat.placement.kind === 'row' ? (rowById.get(seat.placement.rowId)?.name ?? '') : ''}`.toLowerCase(),
      ]),
    );
    return { floorById, zoneById, rowById, seatById, searchTextById };
  }, [layout.snapshot]);
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
  const normalizedSearch = search.trim().toLowerCase();
  const snapshotSeats = layout.snapshot.seats;
  const availabilitySeats = availability.seats;
  const searchTextById = layoutIndex.searchTextById;
  const seats = snapshotSeats.filter(
    (seat) =>
      seat.floorId === activeFloorId &&
      (!activeZoneId || seat.zoneId === activeZoneId) &&
      (!availableOnly || availabilitySeats[seat.id] === 'available') &&
      (searchTextById.get(seat.id)?.includes(normalizedSearch) ?? false),
  );
  const { seatById, zoneById } = layoutIndex;
  const safeSelection = selection.filter(
    (item): item is SeatSelectionItem =>
      Boolean(item) &&
      (item.kind === 'seat'
        ? typeof item.seatId === 'string'
        : item.kind === 'generalAdmission' &&
          typeof item.zoneId === 'string' &&
          typeof item.quantity === 'number'),
  );
  const selectedSeatIds = new Set(
    safeSelection.flatMap((item) =>
      item.kind === 'seat' ? [item.seatId] : [],
    ),
  );
  const selectedZoneForMobile = compact
    ? [...selectedSeatIds].map((id) => seatById.get(id)?.zoneId).find(Boolean)
    : null;
  const focusedZoneId = activeZoneId ?? selectedZoneForMobile ?? null;
  const seatAppearance = useMemo(
    () =>
      Object.fromEntries(
        layout.snapshot.seats.map((seat) => [
          seat.id,
          { fill: statusColors[availability.seats[seat.id] ?? 'unavailable'] },
        ]),
      ),
    [layout.snapshot.seats, availability.seats],
  );
  const selectedTargets: HallTarget[] = [...selectedSeatIds].map((id) => ({
    kind: 'seat',
    id,
  }));
  const priceLegend = useMemo(() => {
    const unique = new Map<string, SeatPrice>();
    for (const seat of layout.snapshot.seats) {
      if (seat.floorId !== activeFloorId) continue;
      const price = prices.seats[seat.id];
      if (price && validateSeatPrice(price).valid) {
        unique.set(`${price.category ?? labels.seat}:${price.amount}:${price.currency}`, price);
      }
    }
    return [...unique.values()];
  }, [layout.snapshot.seats, activeFloorId, prices.seats, labels.seat]);
  const locked = loading || buying || pending;
  const validation = useMemo(
    () => validateSelection({ layout, selection, availability, prices }),
    [layout, selection, availability, prices],
  );
  const selectedCount = validation.count;
  const total = validation.total;
  const selectionValid = validation.valid;
  const inspectedSeat = inspectedSeatId ? seatById.get(inspectedSeatId) : null;
  const hoveredSeat = hoveredSeatId ? seatById.get(hoveredSeatId) : null;
  const selectedDetailSeat = safeSelection
    .flatMap((item) =>
      item.kind === 'seat' ? [seatById.get(item.seatId)] : [],
    )
    .find(Boolean);
  const detailSeat = inspectedSeat ?? selectedDetailSeat;
  const tooltipSeat =
    hoveredSeat && hoveredSeat.id !== detailSeat?.id ? hoveredSeat : null;
  function placeDetails(seat: NonNullable<typeof detailSeat>): PlaceDetails {
    const floor = layoutIndex.floorById.get(seat.floorId);
    const zone = layoutIndex.zoneById.get(seat.zoneId ?? '');
    const rowId = seat.placement.kind === 'row' ? seat.placement.rowId : null;
    const row = rowId ? layoutIndex.rowById.get(rowId) : undefined;
    const price = prices.seats[seat.id];
    const checked = validateSeatPrice(price);
    return {
      hall: layout.hallName,
      floor: floor?.name ?? labels.floor,
      zone: zone?.name ?? labels.allZones,
      row: row?.name ?? '—',
      seat: seat.label,
      status: availability.seats[seat.id] ?? 'unavailable',
      price:
        checked.valid && price
          ? formatPrice(price, locale)
          : labels.missingPrice,
      ...(price?.category ? { category: price.category } : {}),
    };
  }
  function selectionIssue(code: SelectionValidationIssueCode): string {
    if (code === 'missing_price') return labels.missingPrice;
    if (code === 'invalid_price' || code === 'total_overflow')
      return labels.invalidPrice;
    if (code === 'duplicate_item') return labels.duplicate;
    if (code === 'mixed_currencies') return labels.mixedCurrencies;
    if (code === 'invalid_quantity' || code.startsWith('quantity_'))
      return labels.invalidQuantity;
    return labels.invalidSelection;
  }

  function handleSeatClick(seatId: string) {
    if (locked) return;
    if (selectedSeatIds.has(seatId)) {
      onSelectionChange(
        safeSelection.filter(
          (item) => item.kind !== 'seat' || item.seatId !== seatId,
        ),
      );
      return;
    }
    if (
      availability.seats[seatId] !== 'available' ||
      !validateSeatPrice(prices.seats[seatId]).valid
    )
      return;
    onSelectionChange([...safeSelection, { kind: 'seat', seatId }]);
  }

  function handleQuantityChange(zoneId: string, rawValue: string) {
    if (locked) return;
    const zone = availability.zones?.[zoneId];
    if (!zone) return;
    const limit = Math.min(zone.available, zone.maxPerOrder ?? zone.available);
    const quantity = Number(rawValue);
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > limit) {
      setLocalError(labels.invalidQuantity);
      return;
    }
    setLocalError(null);
    onSelectionChange([
      ...safeSelection.filter(
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
    if (locked || !selectionValid || !total) return;
    const submittedContext = contextKey;
    setLocalError(null);
    setPending(true);
    try {
      await onBuyClick({ occurrenceId, selection: [...selection] });
    } catch (cause) {
      const failure = cause instanceof Error ? cause : new Error(String(cause));
      if (previousContext.current === submittedContext) {
        setLocalError(failure.message);
        onError?.(failure);
      }
    } finally {
      if (previousContext.current === submittedContext) setPending(false);
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
            fitKey={`${layout.snapshot.id}:${activeFloorId}:${focusedZoneId ?? ''}`}
            focusedFloorId={activeFloorId}
            {...(focusedZoneId ? { focusedZoneId } : {})}
            height={compact ? 300 : 400}
            onCanvasClick={handleCanvasClick}
            onFloorChange={selectFloor}
            onHoverTarget={(target) =>
              setHoveredSeatId(target?.kind === 'seat' ? target.id : null)
            }
          />

          {tooltipSeat && (
            <SeatDetails
              details={placeDetails(tooltipSeat)}
              title={labels.details}
              seatLabel={labels.seat}
              rowLabel={labels.row}
              statusLabel={labels.status}
              priceLabel={labels.price}
              statuses={labels.statuses}
              tooltip
            />
          )}

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
          {priceLegend.length > 0 && (
            <div
              className="seat-view-price-legend"
              aria-label={labels.priceLegend}
            >
              <strong>{labels.priceLegend}</strong>
              {priceLegend.map((price) => (
                <span
                  key={`${price.category ?? labels.seat}:${price.amount}:${price.currency}`}
                >
                  {price.category ?? labels.seat} · {formatPrice(price, locale)}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="seat-view-panel">
          <SeatFilters
            floorLabel={labels.floor}
            zoneLabel={labels.allZones}
            searchLabel={labels.seats}
            availableOnlyLabel={labels.availableOnly}
            floors={layout.snapshot.floors}
            zones={zones}
            floorId={activeFloorId}
            zoneId={activeZoneId ?? ''}
            search={search}
            availableOnly={availableOnly}
            onFloorChange={selectFloor}
            onZoneChange={selectZone}
            onSearchChange={setSearch}
            onAvailableOnlyChange={setAvailableOnly}
          />

          <AccessibleSeatList
            key={`${contextKey}:${activeFloorId}:${activeZoneId ?? ''}:${availableOnly}:${normalizedSearch}`}
            label={labels.seats}
            seatLabel={labels.seat}
            emptyLabel={labels.noSeats}
            previousLabel={labels.previousSeats}
            nextLabel={labels.nextSeats}
            rangeLabel={labels.seatRange}
            seats={seats}
            getItem={(id) => {
              const seat = seatById.get(id);
              if (!seat) throw new Error(`Unknown seat ${id}`);
              const details = placeDetails(seat);
              const selected = selectedSeatIds.has(seat.id);
              return {
                id: seat.id,
                label: seat.label,
                address: `${details.hall} · ${details.floor} · ${details.zone} · ${labels.row} ${details.row}`,
                status: labels.statuses[details.status],
                price: details.price,
                ...(details.category ? { category: details.category } : {}),
                selected,
                disabled:
                  locked ||
                  (!selected &&
                    (details.status !== 'available' ||
                      !validateSeatPrice(prices.seats[seat.id]).valid)),
              };
            }}
            isEnabled={(id) =>
              !locked &&
              (selectedSeatIds.has(id) ||
                (availability.seats[id] === 'available' &&
                  validateSeatPrice(prices.seats[id]).valid))
            }
            onSelect={handleSeatClick}
            onInspect={setInspectedSeatId}
          />

          {detailSeat && (
            <SeatDetails
              details={placeDetails(detailSeat)}
              title={labels.details}
              seatLabel={labels.seat}
              rowLabel={labels.row}
              statusLabel={labels.status}
              priceLabel={labels.price}
              statuses={labels.statuses}
            />
          )}

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
              const selectedZone = safeSelection.find(
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
                      locked ||
                      ((!validateSeatPrice(price).valid || limit === 0) &&
                        quantity === 0)
                    }
                    onChange={(event) =>
                      handleQuantityChange(zone.id, event.target.value)
                    }
                  />
                  <span>
                    {validateSeatPrice(price).valid && price
                      ? formatPrice(price, locale)
                      : labels.missingPrice}
                  </span>
                </label>
              );
            })}

          <SelectionBasket
            selectedLabel={labels.selected}
            totalLabel={labels.total}
            missingPriceLabel={labels.missingPrice}
            buyLabel={labels.buy}
            buyingLabel={labels.buying}
            removeLabel={labels.remove}
            count={selectedCount}
            total={selectionValid && total ? formatPrice(total, locale) : null}
            items={safeSelection.map((item) => {
              const seat =
                item.kind === 'seat' ? seatById.get(item.seatId) : null;
              const zone =
                item.kind === 'generalAdmission'
                  ? zoneById.get(item.zoneId)
                  : null;
              const name = seat
                  ? `${labels.seat} ${seat.label} · ${layoutIndex.floorById.get(seat.floorId)?.name ?? ''} · ${seat.zoneId ? (zoneById.get(seat.zoneId)?.name ?? '') : ''}`
                : `${zone?.name ?? (item.kind === 'generalAdmission' ? item.zoneId : item.seatId)} × ${item.kind === 'generalAdmission' ? item.quantity : 1}`;
              const price =
                item.kind === 'seat'
                  ? prices.seats[item.seatId]
                  : prices.zones?.[item.zoneId];
              return {
                key:
                  item.kind === 'seat'
                    ? `seat:${item.seatId}`
                    : `zone:${item.zoneId}`,
                name,
                price:
                  validateSeatPrice(price).valid && price
                    ? formatPrice(price, locale)
                    : null,
              };
            })}
            disabled={locked}
            buyDisabled={!selectionValid}
            buying={buying || pending}
            issue={
              selection.length > 0 && !selectionValid ? (
                <span role="alert">
                  {selectionIssue(validation.issues[0]?.code ?? 'invalid_item')}
                </span>
              ) : null
            }
            onRemove={(key) =>
              onSelectionChange(
                safeSelection.filter(
                  (item) =>
                    key !==
                    (item.kind === 'seat'
                      ? `seat:${item.seatId}`
                      : `zone:${item.zoneId}`),
                ),
              )
            }
            onBuy={() => void handleBuyClick()}
          />
        </div>
      </div>
    </section>
  );
}
