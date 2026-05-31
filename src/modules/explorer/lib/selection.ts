export type SelectModifiers = {
  shift?: boolean;
  toggle?: boolean;
};

export function rangeBetween(
  order: string[],
  a: string,
  b: string,
): string[] {
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  if (ai === -1 || bi === -1) return [b];
  const lo = Math.min(ai, bi);
  const hi = Math.max(ai, bi);
  return order.slice(lo, hi + 1);
}

export type SelectionResult = {
  selected: Set<string>;
  anchor: string;
  active: string;
};

export function applySelection(
  order: string[],
  current: Set<string>,
  anchor: string | null,
  path: string,
  mods: SelectModifiers,
): SelectionResult {
  if (mods.shift && anchor && order.includes(anchor)) {
    const range = rangeBetween(order, anchor, path);
    return { selected: new Set(range), anchor, active: path };
  }
  if (mods.toggle) {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return { selected: next, anchor: path, active: path };
  }
  return { selected: new Set([path]), anchor: path, active: path };
}
