import {
  CURRENT_DRAFT_SCHEMA_VERSION,
  layoutSnapshotSchema,
  type HallLayoutDraft,
  type LayoutSnapshot,
  type SeatStatus,
} from '@hall-platform/domain';

export const PERFORMANCE_HALL_SIZES = [5_000, 50_000, 100_000] as const;
export type PerformanceHallSize = (typeof PERFORMANCE_HALL_SIZES)[number];
export const PERFORMANCE_HALL_SEAT_COUNT = 50_000;
export const PERFORMANCE_HALL_PROFILES = [
  'multi-floor',
  'single-floor',
  'dense-overlap',
  'realistic-layout',
] as const;
export type PerformanceHallProfile = (typeof PERFORMANCE_HALL_PROFILES)[number];

export function getPerformanceHallId(
  seatCount: PerformanceHallSize = PERFORMANCE_HALL_SEAT_COUNT,
  profile: PerformanceHallProfile = 'multi-floor',
): string {
  return profile === 'multi-floor'
    ? `performance-hall-${seatCount}`
    : `performance-hall-${seatCount}-${profile}`;
}

export const PERFORMANCE_HALL_ID = getPerformanceHallId();
export const PERFORMANCE_HALL_NAME = 'Тестовый зал — 50 000 мест';

const floorIds = ['f1', 'f2', 'f3'] as const;
const zoneIds = Array.from({ length: 12 }, (_, index) => `z${index + 1}`);
const seatsPerRow = 180;
const pdfAssetId = 'performance-plan-pdf';
const pdfDataUrl =
  'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA3OTIgNjEyXSAvUmVzb3VyY2VzIDw8ID4+IC9Db250ZW50cyA0IDAgUiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDAgPj4Kc3RyZWFtCgplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDIxOSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDUgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjI2OAolJUVPRg==';

const statuses: readonly SeatStatus[] = [
  'available',
  'held',
  'sold',
  'blocked',
  'unavailable',
];
const priceCategories = [
  { amount: 1_500, category: 'Эконом' },
  { amount: 2_000, category: 'Стандарт' },
  { amount: 2_500, category: 'Комфорт' },
  { amount: 3_500, category: 'Премиум' },
  { amount: 1_500, category: 'Доступные места' },
] as const;

type FanCurve = {
  kind: 'bezier';
  p0: { x: number; y: number };
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  p3: { x: number; y: number };
};

function fanCurvePoint(curve: FanCurve, t: number) {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * curve.p0.x +
      3 * inverse ** 2 * t * curve.p1.x +
      3 * inverse * t ** 2 * curve.p2.x +
      t ** 3 * curve.p3.x,
    y:
      inverse ** 3 * curve.p0.y +
      3 * inverse ** 2 * t * curve.p1.y +
      3 * inverse * t ** 2 * curve.p2.y +
      t ** 3 * curve.p3.y,
  };
}

function markPerformance(name: string): void {
  if (typeof globalThis.performance !== 'undefined')
    globalThis.performance.mark(name);
}

function measurePerformance(name: string, start: string, end: string): void {
  if (typeof globalThis.performance !== 'undefined')
    globalThis.performance.measure(name, start, end);
}

function getHallName(
  seatCount: number,
  profile: PerformanceHallProfile,
): string {
  const baseName = `Тестовый зал — ${seatCount.toLocaleString('ru-RU')} мест`;
  if (profile === 'single-floor') return `${baseName} · один этаж`;
  if (profile === 'dense-overlap') return `${baseName} · плотная посадка`;
  if (profile === 'realistic-layout') return `${baseName} · веерная схема`;
  return baseName;
}

function getZoneSeatCounts(seatCount: number): number[] {
  const largeSectorCount = Math.ceil(seatCount * 0.42);
  const smallerSectorCount = seatCount - largeSectorCount;
  const seatsPerSmallerSector = Math.floor(smallerSectorCount / 11);
  const counts = Array.from({ length: 12 }, (_, index) =>
    index === 0 ? largeSectorCount : seatsPerSmallerSector,
  );
  counts[counts.length - 1]! += smallerSectorCount - seatsPerSmallerSector * 11;
  return counts;
}

function createZones(profile: PerformanceHallProfile) {
  return zoneIds.map((id, index) => {
    const floorIndex = Math.floor(index / 4);
    const sectorIndex = index % 4;
    const x = sectorIndex * 2_200;
    const y = floorIndex * 12_000 + sectorIndex * 3_000;

    return {
      id,
      floorId:
        profile === 'single-floor' ? floorIds[0]! : floorIds[floorIndex]!,
      name: `Сектор ${index + 1}`,
      kind: 'seated' as const,
      polygon:
        profile === 'realistic-layout'
          ? [
              { x: x + 100, y },
              { x: x + 1_950, y: y + 100 },
              { x: x + 1_900, y: y + 2_900 },
              { x: x + 200, y: y + 2_900 },
            ]
          : [
              { x, y },
              { x: x + 2_050, y },
              { x: x + 2_050, y: y + 2_900 },
              { x, y: y + 2_900 },
            ],
    };
  });
}

export function createPerformanceHallSnapshot(
  seatCount: PerformanceHallSize = PERFORMANCE_HALL_SEAT_COUNT,
  profile: PerformanceHallProfile = 'multi-floor',
): LayoutSnapshot {
  const measurePrefix = `hall:performance:${profile}:${seatCount}`;
  markPerformance(`${measurePrefix}:geometry:start`);
  const layoutVersionId = `performance-layout-${seatCount}-${profile}-v1`;
  const id = getPerformanceHallId(seatCount, profile);
  const selectedFloorIds =
    profile === 'single-floor' ? floorIds.slice(0, 1) : floorIds;
  const floors = selectedFloorIds.map((floorId, index) => ({
    id: floorId,
    layoutVersionId,
    name: ['Партер', 'Балкон', 'Верхний ярус'][index]!,
  }));
  const zones = createZones(profile);
  const zoneSeatCounts = getZoneSeatCounts(seatCount);
  const rows: unknown[] = [];
  const seats: unknown[] = [];
  let globalSeatIndex = 0;
  let globalRowIndex = 0;

  for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex += 1) {
    const zone = zones[zoneIndex]!;
    let remaining = zoneSeatCounts[zoneIndex]!;
    let rowIndex = 0;

    while (remaining > 0) {
      const count = Math.min(seatsPerRow, remaining);
      const rowId = `r${globalRowIndex + 1}`;
      globalRowIndex += 1;
      const floorIndex = Math.floor(zoneIndex / 4);
      const sectorIndex = zoneIndex % 4;
      const zoneY = floorIndex * 12_000 + sectorIndex * 3_000;
      const rowY = zoneY + rowIndex * (10 + (rowIndex % 3) * 0.9);
      const x = sectorIndex * 2_200;
      const spacing =
        8 +
        ((zoneIndex + rowIndex) % 4) *
          (profile === 'realistic-layout' ? 0.2 : 0.65);
      const rowLength = count * spacing;
      const rowX =
        profile === 'realistic-layout' ? x + 180 + (1_600 - rowLength) / 2 : x;
      const fanCurve =
        profile === 'realistic-layout'
          ? {
              kind: 'bezier' as const,
              p0: { x: rowX, y: rowY + 8 },
              p1: {
                x: rowX + rowLength * 0.25,
                y: rowY + 38 + sectorIndex * 5 + (rowIndex % 5) * 3,
              },
              p2: {
                x: rowX + rowLength * 0.75,
                y: rowY + 38 + sectorIndex * 5 + (rowIndex % 5) * 3,
              },
              p3: { x: rowX + rowLength, y: rowY + 8 },
            }
          : null;

      rows.push({
        id: rowId,
        floorId: zone.floorId,
        zoneId: zone.id,
        name: `Ряд ${rowIndex + 1}`,
        curve:
          fanCurve ??
          (rowIndex % 3 === 0
            ? {
                kind: 'arc',
                center: { x: x + 1_000, y: rowY - 40 },
                radius: 900 + rowIndex * 0.25,
                startAngle: 0.2,
                endAngle: 2.94,
              }
            : {
                kind: 'line',
                start: { x, y: rowY },
                end: { x: x + count * spacing, y: rowY + (rowIndex % 2) },
              }),
        generation: {
          distribution: { kind: 'fixed', count, step: spacing },
        },
      });

      for (let column = 0; column < count; column += 1) {
        const visualIndex = globalSeatIndex;
        seats.push({
          id: `ps-${visualIndex + 1}`,
          floorId: zone.floorId,
          zoneId: zone.id,
          label: `${column + 1}`,
          position:
            profile === 'dense-overlap'
              ? {
                  x: x + (column % 4) * 0.12,
                  y: rowY + (Math.floor(column / 4) % 4) * 0.12,
                }
              : fanCurve
                ? fanCurvePoint(
                    fanCurve,
                    count === 1 ? 0.5 : column / (count - 1),
                  )
                : {
                    x: x + column * spacing,
                    y: rowY + (column % 7 === 0 ? 0.2 : 0),
                  },
          placement: { kind: 'row', rowId },
          ...(visualIndex % 997 === 0
            ? { visualKind: 'wheelchairBay' as const }
            : visualIndex % 7 === 0
              ? { visualKind: 'armchair' as const }
              : {}),
          ...(visualIndex % 31 === 0
            ? { rotationRadians: ((visualIndex % 16) * Math.PI) / 8 }
            : {}),
        });
        globalSeatIndex += 1;
      }

      remaining -= count;
      rowIndex += 1;
    }
  }

  const tables = zones.map((zone, index) => {
    const sectorIndex = index % 4;
    const floorIndex = Math.floor(index / 4);
    return {
      id: `performance-table-${index + 1}`,
      floorId: zone.floorId,
      zoneId: zone.id,
      label: `Стол ${index + 1}`,
      center: {
        x:
          sectorIndex * 2_200 +
          (profile === 'realistic-layout' ? 1_000 : 2_000),
        y: floorIndex * 12_000 + sectorIndex * 3_000 + 20,
      },
      rotationRadians: (index * Math.PI) / 12,
      shape: {
        kind: 'rectangle',
        width: 24,
        height: 12,
        seatsPerSide: { top: 2, right: 1, bottom: 2, left: 1 },
      },
    };
  });

  const decorations = floors.flatMap((floor, floorIndex) => [
    {
      id: `performance-stage-${floorIndex + 1}`,
      floorId: floor.id,
      kind: 'stage' as const,
      label: 'Сцена',
      polygon: [
        { x: 30, y: floorIndex * 12_000 - 200 },
        { x: 2_000, y: floorIndex * 12_000 - 200 },
        { x: 2_000, y: floorIndex * 12_000 - 160 },
        { x: 30, y: floorIndex * 12_000 - 160 },
      ],
    },
    {
      id: `performance-obstacle-${floorIndex + 1}`,
      floorId: floor.id,
      kind: 'obstacle' as const,
      label: 'Техническая зона',
      polygon: [
        { x: 2_020, y: floorIndex * 12_000 + 250 },
        { x: 2_050, y: floorIndex * 12_000 + 250 },
        { x: 2_050, y: floorIndex * 12_000 + 280 },
        { x: 2_020, y: floorIndex * 12_000 + 280 },
      ],
    },
  ]);
  const backgrounds = floors.map((floor, index) => ({
    id: `performance-background-${index + 1}`,
    floorId: floor.id,
    order: 0,
    position: { x: 0, y: index * 12_000 },
    scale: 1,
    rotationRadians: 0,
    opacity: 0.35,
    visible: true,
    locked: true,
    source: { kind: 'pdf', assetId: pdfAssetId, pageNumber: 1 },
  }));

  markPerformance(`${measurePrefix}:geometry:end`);
  measurePerformance(
    `${measurePrefix}:geometry`,
    `${measurePrefix}:geometry:start`,
    `${measurePrefix}:geometry:end`,
  );
  markPerformance(`${measurePrefix}:schema-parse:start`);
  const snapshot = layoutSnapshotSchema.parse({
    id,
    layoutVersionId,
    floors,
    zones,
    rows,
    seats,
    tables,
    backgrounds,
    decorations,
  });
  markPerformance(`${measurePrefix}:schema-parse:end`);
  measurePerformance(
    `${measurePrefix}:schema-parse`,
    `${measurePrefix}:schema-parse:start`,
    `${measurePrefix}:schema-parse:end`,
  );
  return snapshot;
}

export function createPerformanceHallDraft(
  seatCount: PerformanceHallSize = PERFORMANCE_HALL_SEAT_COUNT,
  profile: PerformanceHallProfile = 'multi-floor',
): HallLayoutDraft {
  const snapshot = createPerformanceHallSnapshot(seatCount, profile);
  return {
    schemaVersion: CURRENT_DRAFT_SCHEMA_VERSION,
    hallName: getHallName(seatCount, profile),
    snapshot,
    zoneBounds: {},
    assets: {
      [pdfAssetId]: {
        kind: 'pdf',
        name: 'Performance hall plan.pdf',
        dataUrl: pdfDataUrl,
        pages: [{ width: 792, height: 612 }],
      },
    },
    calibration: null,
  };
}

export function createPerformanceAvailability(
  seatCount: PerformanceHallSize = PERFORMANCE_HALL_SEAT_COUNT,
) {
  const snapshot = createPerformanceHallSnapshot(seatCount);
  return Object.fromEntries(
    snapshot.seats.map((seat, index) => [seat.id, statuses[index % 5]!]),
  ) as Record<string, SeatStatus>;
}

export function createPerformancePrices(
  seatCount: PerformanceHallSize = PERFORMANCE_HALL_SEAT_COUNT,
) {
  const snapshot = createPerformanceHallSnapshot(seatCount);
  return Object.fromEntries(
    snapshot.seats.map((seat, index) => {
      const price = priceCategories[index % priceCategories.length]!;
      return [seat.id, { ...price, currency: 'RUB' as const }];
    }),
  );
}
