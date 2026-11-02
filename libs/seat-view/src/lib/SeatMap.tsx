import { useId, useMemo, type PropsWithChildren } from 'react';
import { withoutBackgrounds } from '@hall-platform/domain';
// eslint-disable-next-line @nx/enforce-module-boundaries -- SeatMap renders the shared hall canvas for this reusable seat selection feature.
import {
  HallViewport,
  type HallViewportProps,
  type RendererPreference,
} from '@hall-platform/hall-viewer';
import type { HallTarget, RendererSeatUpdate } from '@hall-platform/renderer-core';
import { useSeatSelectionContext } from './SeatSelectionProvider.js';
import type { PublishedHallLayout, SeatAvailabilityMap } from './SeatView.js';

export const seatStatusColors = {
  available: '#18784a',
  held: '#b97819',
  sold: '#9a4450',
  blocked: '#67717e',
  unavailable: '#a5adb6',
} as const;

const englishViewerLabels: NonNullable<HallViewportProps['labels']> = {
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

export type SeatMapProps = PropsWithChildren<{
  readonly layout: PublishedHallLayout;
  readonly availability: SeatAvailabilityMap;
  readonly focusedFloorId: string;
  readonly focusedZoneId?: string | null;
  readonly locale?: string;
  readonly height?: number;
  readonly showReset?: boolean;
  readonly showStatus?: boolean;
  readonly rendererPreference?: RendererPreference;
  readonly webglEnabled?: boolean;
  /** undefined means a full availability snapshot; an empty list means no seat updates. */
  readonly updatedSeatIds?: readonly string[];
  readonly onSeatClick: (seatId: string) => void;
  readonly onZoneClick: (zoneId: string) => void;
  readonly onFloorChange: (floorId: string) => void;
  readonly onHoverSeatChange?: (seatId: string | null) => void;
  readonly onError?: (error: Error) => void;
}>;

/** Renders only the reusable hall map. Selection comes from its shared provider. */
export function SeatMap({
  layout,
  availability,
  focusedFloorId,
  focusedZoneId = null,
  locale = 'ru-RU',
  height = 400,
  showReset = true,
  showStatus = true,
  rendererPreference = 'auto',
  webglEnabled = false,
  updatedSeatIds,
  onSeatClick,
  onZoneClick,
  onFloorChange,
  onHoverSeatChange,
  onError,
  children,
}: SeatMapProps) {
  const { selection } = useSeatSelectionContext();
  const instanceId = useId().replace(/:/g, '');
  const snapshot = useMemo(
    () => withoutBackgrounds(layout.snapshot),
    [layout.snapshot],
  );
  const seats = snapshot.seats;
  const seatsById = useMemo(
    () => new Map<string, (typeof seats)[number]>(seats.map((seat) => [seat.id, seat])),
    [seats],
  );
  const seatAppearance = useMemo(
    () =>
      Object.fromEntries(
        seats.map((seat) => [
          seat.id,
          {
            fill: seatStatusColors[availability.seats[seat.id] ?? 'unavailable'],
          },
        ]),
      ),
    [availability.seats, seats],
  );
  const seatUpdates = useMemo<readonly RendererSeatUpdate[]>(
    () => {
      const ids = updatedSeatIds ?? seats.map(({ id }) => id);
      return ids.flatMap((id) => {
        const seat = seatsById.get(id);
        return seat ? [{ id, status: availability.seats[id] ?? 'unavailable', label: seat.label }] : [];
      });
    },
    [availability.seats, seats, seatsById, updatedSeatIds],
  );
  const selectedTargets: HallTarget[] = useMemo(() => {
    const targets = new Map<string, HallTarget>();
    for (const item of selection) {
      if (!item) continue;
      if (item.kind === 'seat' && typeof item.seatId === 'string') {
        targets.set(`seat:${item.seatId}`, { kind: 'seat', id: item.seatId });
      } else if (
        item.kind === 'generalAdmission' &&
        typeof item.zoneId === 'string' &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0
      ) {
        targets.set(`zone:${item.zoneId}`, { kind: 'zone', id: item.zoneId });
      }
    }
    return [...targets.values()];
  }, [selection]);

  function handleCanvasClick(_point: unknown, target: HallTarget | null) {
    if (target?.kind === 'seat') onSeatClick(target.id);
    if (target?.kind === 'zone') onZoneClick(target.id);
  }

  return (
    <div className="seat-view-map">
      <HallViewport
        snapshot={snapshot}
        hallName={layout.hallName}
        {...(layout.zoneBounds ? { zoneBounds: layout.zoneBounds } : {})}
        viewerMode="pick"
        selectedTargets={selectedTargets}
        {...(locale.toLowerCase().startsWith('en')
          ? { labels: englishViewerLabels }
          : {})}
        seatAppearance={seatAppearance}
        seatUpdates={seatUpdates}
        renderer={rendererPreference}
        webglEnabled={webglEnabled}
        {...(onError ? { onRendererError: onError } : {})}
        stageId={`seat-stage-${instanceId}`}
        showReset={showReset}
        showStatus={showStatus}
        fitKey={`${snapshot.id}:${focusedFloorId}:${focusedZoneId ?? ''}`}
        focusedFloorId={focusedFloorId}
        {...(focusedZoneId ? { focusedZoneId } : {})}
        height={height}
        onCanvasClick={handleCanvasClick}
        onFloorChange={onFloorChange}
        onHoverTarget={(target) =>
          onHoverSeatChange?.(target?.kind === 'seat' ? target.id : null)
        }
      />
      {children}
    </div>
  );
}
