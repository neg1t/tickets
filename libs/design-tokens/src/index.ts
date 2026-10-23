export type HallCanvasPalette = Readonly<{
  ink: string;
  seat: string;
  seatStroke: string;
  zone: string;
  zoneStroke: string;
  row: string;
  table: string;
  selected: string;
}>;

export const defaultHallCanvasPalette: HallCanvasPalette = {
  ink: '#193047',
  seat: '#2079a8',
  seatStroke: '#145577',
  zone: '#e7f2f8',
  zoneStroke: '#91b4ca',
  row: '#65869b',
  table: '#c3dbe6',
  selected: '#ed8936',
};

const variables: Record<keyof HallCanvasPalette, string> = {
  ink: '--hall-canvas-ink',
  seat: '--hall-canvas-seat',
  seatStroke: '--hall-canvas-seat-stroke',
  zone: '--hall-canvas-zone',
  zoneStroke: '--hall-canvas-zone-stroke',
  row: '--hall-canvas-row',
  table: '--hall-canvas-table',
  selected: '--hall-canvas-selected',
};

export function readHallCanvasPalette(element: Element | null): HallCanvasPalette {
  if (!element || typeof getComputedStyle !== 'function') return defaultHallCanvasPalette;
  const style = getComputedStyle(element);
  return Object.fromEntries(
    (Object.keys(variables) as (keyof HallCanvasPalette)[]).map((key) => [
      key,
      style.getPropertyValue(variables[key]).trim() || defaultHallCanvasPalette[key],
    ]),
  ) as HallCanvasPalette;
}
