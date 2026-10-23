export const CURRENT_DRAFT_SCHEMA_VERSION = 2 as const;

// The original export had no schemaVersion. Both that shape and explicit v1
// exports use the same fields, so the v1 → v2 migration only adds the marker.
export function migrateHallLayoutDraft(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const draft = value as Record<string, unknown>;
  const version = Object.hasOwn(draft, 'schemaVersion')
    ? draft.schemaVersion
    : 1;
  if (version === CURRENT_DRAFT_SCHEMA_VERSION) return draft;
  if (version === 1) {
    return { ...draft, schemaVersion: CURRENT_DRAFT_SCHEMA_VERSION };
  }
  throw new RangeError(
    `Unsupported hall draft schema version: ${String(version)}`,
  );
}
