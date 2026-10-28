import type { HallTarget } from './hallTarget.js';

export type SelectableKind = HallTarget['kind'];
export type SelectionOperation = 'replace' | 'add' | 'subtract' | 'toggle';

export function isSelectionTargetAllowed(
  target: HallTarget,
  allowedKinds?: ReadonlySet<string>,
): boolean {
  return allowedKinds === undefined || allowedKinds.has(target.kind);
}

function targetKey(target: HallTarget): string {
  return `${target.kind}:${target.id}`;
}

function uniqueTargets(targets: readonly HallTarget[]): HallTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = targetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function applySelectionOperation(
  current: readonly HallTarget[],
  incoming: readonly HallTarget[],
  operation: SelectionOperation,
): HallTarget[] {
  const before = uniqueTargets(current);
  const additions = uniqueTargets(incoming);
  if (operation === 'replace') return additions;

  const incomingKeys = new Set(additions.map(targetKey));
  if (operation === 'subtract')
    return before.filter((target) => !incomingKeys.has(targetKey(target)));

  if (operation === 'add') return uniqueTargets([...before, ...additions]);

  const beforeKeys = new Set(before.map(targetKey));
  return uniqueTargets([
    ...before.filter((target) => !incomingKeys.has(targetKey(target))),
    ...additions.filter((target) => !beforeKeys.has(targetKey(target))),
  ]);
}
