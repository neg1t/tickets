export type EditorPanel = 'tools' | 'layers' | 'properties';

export function toggleEditorPanel(
  current: EditorPanel | null,
  requested: EditorPanel,
): EditorPanel | null {
  return current === requested ? null : requested;
}
