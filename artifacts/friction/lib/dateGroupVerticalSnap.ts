export interface DateGroupLayout {
  dateKey: string;
  offset: number;
  height: number;
}

export function resolveDateGroupLayouts(
  groupKeys: readonly string[],
  heights: ReadonlyMap<string, number>,
  measuredLayouts: ReadonlyMap<string, DateGroupLayout>,
): DateGroupLayout[] {
  const layouts: DateGroupLayout[] = [];
  let nextOffset = 0;

  for (const dateKey of groupKeys) {
    const measured = measuredLayouts.get(dateKey);
    const height = measured?.height ?? heights.get(dateKey);
    if (!height || height <= 0) break;

    const layout = measured && Number.isFinite(measured.offset)
      ? { dateKey, offset: Math.max(0, measured.offset), height }
      : { dateKey, offset: nextOffset, height };
    layouts.push(layout);
    nextOffset = layout.offset + layout.height;
  }

  return layouts;
}

/**
 * Returns the group whose header is at or immediately before the current
 * scroll position. Layouts can be incomplete while FlatList virtualizes rows,
 * so callers should treat a null result as "do not snap".
 */
export function findDateGroupAtOffset(
  offset: number,
  layouts: readonly DateGroupLayout[],
): DateGroupLayout | null {
  const sorted = [...layouts]
    .filter((layout) => Number.isFinite(layout.offset) && layout.height > 0)
    .sort((left, right) => left.offset - right.offset);
  let current: DateGroupLayout | null = null;

  for (const layout of sorted) {
    if (layout.offset > offset + 1) break;
    current = layout;
  }

  return current;
}

/**
 * A group that fits in the available viewport is anchored to its date header.
 *
 * An oversized group cannot align both its header and its actions, so it snaps
 * only near its two edges: its date header, and the position that brings the
 * end of the group to the bottom of the viewport. Between those edges it
 * returns null, leaving the group's interior freely readable. Record cards use
 * a fixed 5:8 ratio and are routinely taller than the list viewport, so
 * treating oversized groups as entirely unsnappable disables date snapping on
 * that screen altogether.
 */
export function getDateGroupSnapTarget(
  offset: number,
  viewportHeight: number,
  layouts: readonly DateGroupLayout[],
): number | null {
  if (viewportHeight <= 0) return null;
  const sorted = [...layouts].sort((left, right) => left.offset - right.offset);
  const current = findDateGroupAtOffset(offset, sorted);
  if (!current) return null;

  const currentIndex = sorted.findIndex((layout) => layout.dateKey === current.dateKey);
  const next = currentIndex >= 0 ? sorted[currentIndex + 1] : undefined;
  const nearest = next && Math.abs(next.offset - offset) < Math.abs(current.offset - offset)
    ? next
    : current;

  if (nearest.height <= viewportHeight) return Math.max(0, nearest.offset);

  const headerTarget = Math.max(0, nearest.offset);
  const endTarget = Math.max(headerTarget, nearest.offset + nearest.height - viewportHeight);
  // Each zone stays strictly below half the distance between the two targets,
  // so every oversized group keeps a free interior around its midpoint and the
  // list never pulls the user away from content they are reading.
  const captureDistance = Math.min(160, viewportHeight * 0.25, (endTarget - headerTarget) * 0.4);
  const headerDistance = Math.abs(headerTarget - offset);
  const endDistance = Math.abs(endTarget - offset);

  if (headerDistance > captureDistance && endDistance > captureDistance) return null;
  return headerDistance <= endDistance ? headerTarget : endTarget;
}

/**
 * Keeps a date-key anchor after filtering or refreshing changes the set of
 * groups. If the selected date disappeared, choose the nearest surviving
 * index rather than resetting to the first row.
 */
export function preserveDateGroupAnchor(
  previousKey: string | null,
  previousKeys: readonly string[],
  nextKeys: readonly string[],
): string | null {
  if (nextKeys.length === 0) return null;
  if (previousKey && nextKeys.includes(previousKey)) return previousKey;

  const previousIndex = previousKey ? previousKeys.indexOf(previousKey) : -1;
  const fallbackIndex = previousIndex >= 0
    ? Math.min(previousIndex, nextKeys.length - 1)
    : 0;
  return nextKeys[fallbackIndex] ?? null;
}