import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useUnit } from 'effector-react';
import {
  withoutBackgrounds,
  type LayoutSnapshot,
} from '@hall-platform/domain';
import type { SpatialBounds } from '@hall-platform/geometry';
import type { RendererPreference } from '@hall-platform/hall-viewer';
import { createSeatViewModel } from './seatView.model.js';
import { buildSeatIndexes } from './seatIndexes.js';
import {
  applySeatAvailabilityDeltas,
  type SeatAvailabilityDelta,
  type SeatAvailabilityMap,
} from './availabilityDeltas.js';
import {
  validateSeatPrice,
  validateSelection,
} from './selectionValidation.js';
import {
  selectionIssueMessage,
  useSeatSelection,
  useSeatSelectionController,
} from './useSeatSelection.js';
import { SeatMap, seatStatusColors } from './SeatMap.js';
import { SeatSelectionProvider } from './SeatSelectionProvider.js';
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

let buyerIndexBuildSequence = 0;

export type SeatViewData = {
  readonly occurrenceId: string;
  readonly selection: readonly SeatSelectionItem[];
};

export type {
  SeatAvailabilityDelta,
  SeatAvailabilityMap,
} from './availabilityDeltas.js';

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
  /** Revision of the full availability snapshot passed in `availability`. */
  readonly availabilityRevision?: number;
  /** Contiguous changes to apply after the full snapshot revision. */
  readonly availabilityDeltas?: readonly SeatAvailabilityDelta[];
  readonly prices: SeatPriceMap;
  readonly selection: readonly SeatSelectionItem[];
  /** Authoritative seats/GA currently held by this buyer session. */
  readonly ownHoldSelection?: readonly SeatSelectionItem[];
  readonly locale?: string;
  readonly loading?: boolean;
  readonly buying?: boolean;
  /** Disable checkout while retaining price and availability preview. */
  readonly purchaseDisabled?: boolean;
  readonly error?: string | null;
  readonly onSelectionChange: (selection: SeatSelectionItem[]) => void;
  readonly onBuyClick: (data: SeatViewData) => void | Promise<void>;
  readonly onError?: (error: Error) => void;
  /** Called when the delta chain has a gap and a fresh full snapshot is needed. */
  readonly onAvailabilityResync?: () => void;
  readonly rendererPreference?: RendererPreference;
  readonly webglEnabled?: boolean;
};

const priceFormatters = new Map<string, Intl.NumberFormat>();
const noAvailabilityDeltas: readonly SeatAvailabilityDelta[] = [];

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
    seatUnavailable: 'Это место уже недоступно',
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
    seatUnavailable: 'This seat is no longer available',
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

function formatPrice(price: SeatPrice, locale: string): string {
  try {
    const key = `${locale}\u0000${price.currency}`;
    let formatter = priceFormatters.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: price.currency,
        maximumFractionDigits: 2,
      });
      priceFormatters.set(key, formatter);
    }
    return formatter.format(price.amount);
  } catch {
    return `${price.amount} ${price.currency}`;
  }
}

function SeatViewContent(props: SeatViewProps) {
  const safeLayout = useMemo(
    () => {
      const { hallName, snapshot, zoneBounds } = props.layout;
      return {
        hallName,
        snapshot: withoutBackgrounds(snapshot),
        ...(zoneBounds ? { zoneBounds } : {}),
      };
    },
    [props.layout],
  );
  const {
    occurrenceId,
    availability,
    availabilityRevision = 0,
    availabilityDeltas = noAvailabilityDeltas,
    prices,
    locale = 'ru-RU',
    loading = false,
    buying = false,
    purchaseDisabled = false,
    error = null,
    onBuyClick,
    onError,
    onAvailabilityResync,
    rendererPreference = 'auto',
    webglEnabled = false,
  } = props;
  const {
    selection,
    ownHoldSelection,
    onSelectionChange,
  } = useSeatSelection();
  const layout = safeLayout;
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
  const [keyboardInset, setKeyboardInset] = useState(0);
  const contextKey = `${occurrenceId}:${layout.snapshot.id}`;
  const previousContext = useRef(contextKey);
  const availabilityResult = useMemo(
    () =>
      applySeatAvailabilityDeltas(
        availability,
        availabilityRevision,
        availabilityDeltas,
      ),
    [availability, availabilityRevision, availabilityDeltas],
  );
  const currentAvailability = availabilityResult.availability;
  const lastResyncRequest = useRef('');
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      setKeyboardInset(
        Math.max(
          0,
          Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
        ),
      );
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  useEffect(() => {
    if (previousContext.current === contextKey) return;
    previousContext.current = contextKey;
    setSearch('');
    setAvailableOnly(false);
    setInspectedSeatId(null);
    model.floorSelected(layout.snapshot.floors[0]?.id ?? '');
  }, [contextKey, layout.snapshot.floors, model]);
  useEffect(() => {
    if (!availabilityResult.resyncRequired) {
      lastResyncRequest.current = '';
      return;
    }
    const latestDelta = availabilityDeltas.at(-1);
    const key = `${contextKey}:${availabilityRevision}:${latestDelta?.baseRevision ?? ''}:${latestDelta?.revision ?? ''}`;
    if (lastResyncRequest.current === key) return;
    lastResyncRequest.current = key;
    onAvailabilityResync?.();
  }, [
    availabilityDeltas,
    availabilityRevision,
    availabilityResult.resyncRequired,
    contextKey,
    onAvailabilityResync,
  ]);
  const layoutIndex = useMemo(() => {
    const snapshot = layout.snapshot;
    const measuredIndex = snapshot.seats.length >= 5_000;
    const indexName = measuredIndex
      ? `hall:buyer-index:${snapshot.id}:${++buyerIndexBuildSequence}`
      : '';
    if (measuredIndex) globalThis.performance?.mark(`${indexName}:start`);
    const index = buildSeatIndexes(snapshot);
    if (measuredIndex) {
      globalThis.performance?.mark(`${indexName}:end`);
      globalThis.performance?.measure(
        indexName,
        `${indexName}:start`,
        `${indexName}:end`,
      );
    }
    return index;
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
  const zones = useMemo(
    () =>
      layout.snapshot.zones.filter((zone) => zone.floorId === activeFloorId),
    [layout.snapshot.zones, activeFloorId],
  );
  const normalizedSearch = search.trim().toLowerCase();
  const availabilitySeats = currentAvailability.seats;
  const searchTextById = layoutIndex.searchTextById;
  const ownHoldSeatIds = useMemo(
    () =>
      new Set(
        ownHoldSelection.flatMap((item) =>
          item.kind === 'seat' ? [item.seatId] : [],
        ),
      ),
    [ownHoldSelection],
  );
  const baseSeats = useMemo(
    () =>
      activeZoneId
        ? (layoutIndex.seatsByFloorZone.get(
            `${activeFloorId}\u0000${activeZoneId}`,
          ) ?? [])
        : (layoutIndex.seatsByFloor.get(activeFloorId) ?? []),
    [
      activeFloorId,
      activeZoneId,
      layoutIndex.seatsByFloor,
      layoutIndex.seatsByFloorZone,
    ],
  );
  const availabilityFilter = availableOnly ? availabilitySeats : null;
  const seats = useMemo(
    () =>
      !normalizedSearch && !availabilityFilter
        ? baseSeats
        : baseSeats.filter(
            (seat) =>
              (!availabilityFilter ||
                availabilityFilter[seat.id] === 'available' ||
                ownHoldSeatIds.has(seat.id)) &&
              (searchTextById.get(seat.id)?.includes(normalizedSearch) ??
                false),
          ),
    [
      baseSeats,
      normalizedSearch,
      availabilityFilter,
      ownHoldSeatIds,
      searchTextById,
    ],
  );
  const { seatById, zoneById } = layoutIndex;
  const selectionController = useSeatSelectionController({
    contextKey,
    occurrenceId,
    selection,
    ownHoldSelection,
    availability: currentAvailability,
    prices,
    locked: loading || buying,
    messages: {
      seatUnavailable: labels.seatUnavailable,
      missingPrice: labels.missingPrice,
      invalidQuantity: labels.invalidQuantity,
    },
    onSelectionChange,
    onBuyClick,
    ...(onError ? { onError } : {}),
  });
  const {
    safeSelection,
    selectedSeatIds,
    pending,
    error: localError,
    handleSeatClick,
    handleQuantityChange,
    removeSelection,
    buy,
  } = selectionController;
  const selectedZoneForMobile = compact
    ? [...selectedSeatIds].map((id) => seatById.get(id)?.zoneId).find(Boolean)
    : null;
  const focusedZoneId = activeZoneId ?? selectedZoneForMobile ?? null;
  const priceLegend = useMemo(() => {
    const unique = new Map<string, SeatPrice>();
    for (const seat of layout.snapshot.seats) {
      if (seat.floorId !== activeFloorId) continue;
      const price = prices.seats[seat.id];
      if (price && validateSeatPrice(price).valid) {
        unique.set(
          `${price.category ?? labels.seat}:${price.amount}:${price.currency}`,
          price,
        );
      }
    }
    return [...unique.values()];
  }, [layout.snapshot.seats, activeFloorId, prices.seats, labels.seat]);
  const locked = loading || buying || pending;
  const validation = useMemo(
    () =>
      validateSelection({
        layout,
        selection,
        availability: currentAvailability,
        prices,
        ownHoldSelection,
        seatIds: layoutIndex.seatById,
        zoneIds: layoutIndex.zoneById,
      }),
    [
      layout,
      layoutIndex,
      selection,
      currentAvailability,
      prices,
      ownHoldSelection,
    ],
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
      status: currentAvailability.seats[seat.id] ?? 'unavailable',
      price:
        checked.valid && price
          ? formatPrice(price, locale)
          : labels.missingPrice,
      ...(price?.category ? { category: price.category } : {}),
    };
  }
  return (
    <section
      className="seat-view"
      aria-label={`${labels.seats}: ${layout.hallName}`}
      style={
        { '--seat-view-keyboard-inset': `${keyboardInset}px` } as CSSProperties
      }
    >
      {loading && <p role="status">{labels.loading}</p>}

      {(error || localError) && <p role="alert">{error || localError}</p>}

      <div className="seat-view-layout">
        <SeatMap
          layout={layout}
          availability={currentAvailability}
          focusedFloorId={activeFloorId}
          focusedZoneId={focusedZoneId}
          locale={locale}
          height={compact ? 300 : 400}
          rendererPreference={rendererPreference}
          webglEnabled={webglEnabled}
          onSeatClick={handleSeatClick}
          onZoneClick={selectZone}
          onFloorChange={selectFloor}
          onHoverSeatChange={setHoveredSeatId}
          {...(onError ? { onError } : {})}
        >
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
                <i style={{ backgroundColor: seatStatusColors[status] }} />
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
        </SeatMap>

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
                    ((details.status !== 'available' &&
                      !(details.status === 'held' && ownHoldSeatIds.has(seat.id))) ||
                      !validateSeatPrice(prices.seats[seat.id]).valid)),
              };
            }}
            isEnabled={(id) =>
              !locked &&
              (selectedSeatIds.has(id) ||
                ((currentAvailability.seats[id] === 'available' ||
                  (currentAvailability.seats[id] === 'held' &&
                    ownHoldSeatIds.has(id))) &&
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
                currentAvailability.zones?.[zone.id],
            )
            .map((zone) => {
              const stock = currentAvailability.zones?.[zone.id];
              if (!stock) return null;
              const ownHeldItem = ownHoldSelection.find(
                (item) =>
                  item.kind === 'generalAdmission' && item.zoneId === zone.id,
              );
              const ownHeldQuantity =
                ownHeldItem?.kind === 'generalAdmission'
                  ? ownHeldItem.quantity
                  : 0;
              const availablePlusOwnHold = stock.available + ownHeldQuantity;
              const limit = Math.min(
                availablePlusOwnHold,
                stock.maxPerOrder ?? availablePlusOwnHold,
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
                ? `${labels.seat} ${seat.label} · ${layoutIndex.floorById.get(seat.floorId)?.name ?? ''} · ${seat.zoneId ? (zoneById.get(seat.zoneId)?.name ?? '') : ''}${currentAvailability.seats[seat.id] !== 'available' ? ` · ${labels.statuses[currentAvailability.seats[seat.id] ?? 'unavailable']}` : ''}`
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
            buyDisabled={!selectionValid || purchaseDisabled}
            buying={buying || pending}
            issue={
              selection.length > 0 && !selectionValid ? (
                <span role="alert">
                  {selectionIssueMessage(
                    validation.issues[0]?.code ?? 'invalid_item',
                    labels,
                  )}
                </span>
              ) : null
            }
            onRemove={removeSelection}
            onBuy={() => void buy(Boolean(selectionValid && total))}
          />
        </div>
      </div>
    </section>
  );
}

/** Backwards-compatible composite with the existing map, controls, and basket. */
export function SeatView(props: SeatViewProps) {
  return (
    <SeatSelectionProvider
      selection={props.selection}
      {...(props.ownHoldSelection
        ? { ownHoldSelection: props.ownHoldSelection }
        : {})}
      onSelectionChange={props.onSelectionChange}
    >
      <SeatViewContent {...props} />
    </SeatSelectionProvider>
  );
}
