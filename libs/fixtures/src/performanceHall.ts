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

export function getPerformanceHallId(
  seatCount: PerformanceHallSize = PERFORMANCE_HALL_SEAT_COUNT,
): string {
  return `performance-hall-${seatCount}`;
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

function markPerformance(name: string): void {
  if (typeof globalThis.performance !== 'undefined')
    globalThis.performance.mark(name);
}

function measurePerformance(name: string, start: string, end: string): void {
  if (typeof globalThis.performance !== 'undefined')
    globalThis.performance.measure(name, start, end);
}

function getHallName(seatCount: number): string {
  return `Тестовый зал — ${seatCount.toLocaleString('ru-RU')} мест`;
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

function createZones() {
  return zoneIds.map((id, index) => {
    const floorIndex = Math.floor(index / 4);
    const sectorIndex = index % 4;
    const x = sectorIndex * 2_200;
    const y = floorIndex * 12_000 + sectorIndex * 3_000;

    return {
      id,
      floorId: floorIds[floorIndex]!,
      name: `Сектор ${index + 1}`,
      kind: 'seated' as const,
      polygon: [
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
): LayoutSnapshot {
  const measurePrefix = `hall:performance:${seatCount}`;
  markPerformance(`${measurePrefix}:geometry:start`);
  const layoutVersionId = `performance-layout-${seatCount}-v1`;
  const id = getPerformanceHallId(seatCount);
  const floors = floorIds.map((floorId, index) => ({
    id: floorId,
    layoutVersionId,
    name: ['Партер', 'Балкон', 'Верхний ярус'][index]!,
  }));
  const zones = createZones();
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
      const spacing = 8 + ((zoneIndex + rowIndex) % 4) * 0.65;

      rows.push({
        id: rowId,
        floorId: zone.floorId,
        zoneId: zone.id,
        name: `Ряд ${rowIndex + 1}`,
        curve:
          rowIndex % 3 === 0
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
              },
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
          position: {
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
        x: sectorIndex * 2_200 + 2_000,
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
): HallLayoutDraft {
  const snapshot = createPerformanceHallSnapshot(seatCount);
  return {
    schemaVersion: CURRENT_DRAFT_SCHEMA_VERSION,
    hallName: getHallName(seatCount),
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
