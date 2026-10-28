/** A stable, renderer-neutral reference to an interactive hall object. */
export type HallTarget = Readonly<{
  kind: 'seat' | 'row' | 'table' | 'zone' | 'decoration';
  id: string;
}>;
