import type { HallLayoutDraft } from './hallLayoutDraft.js';
import type { LayoutSnapshot } from './layoutSnapshot.js';

/** Returns a buyer/preview-safe snapshot without editor-only backgrounds. */
export function withoutBackgrounds(snapshot: LayoutSnapshot): LayoutSnapshot {
  if (snapshot.backgrounds.length === 0) return snapshot;
  return { ...snapshot, backgrounds: [] };
}

/** Drops local PDF assets and background references from an editor draft. */
export function withoutEditorBackgrounds(
  draft: HallLayoutDraft,
): HallLayoutDraft {
  const snapshot = withoutBackgrounds(draft.snapshot);
  if (snapshot === draft.snapshot && Object.keys(draft.assets).length === 0)
    return draft;
  return { ...draft, snapshot, assets: {} };
}
