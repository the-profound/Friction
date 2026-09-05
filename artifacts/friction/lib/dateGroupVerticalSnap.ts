export interface DateGroupLayout {
  dateKey: string;
  offset: number;
  height: number;
}

export interface DateGroupPageDecision {
  index: number;
  dateKey: string | null;
  targetOffset: number | null;
}

export const DATE_GROUP_SEARCH_GESTURE_THRESHOLD = 18;

export function isDateGroupSearchBoundaryGesture(
  currentKey: string | null,
  groupKeys: readonly string[],
  distanceY: number,
  pageThreshold: number,
  searchThreshold = DATE_GROUP_SEARCH_GESTURE_THRESHOLD,
  velocityY = 0,
  flingVelocity = Number.POSITIVE_INFINITY,
): boolean {
  if (!currentKey || groupKeys[0] !== currentKey) return false;
  if (Math.abs(velocityY) > flingVelocity) return false;
  const distance = -distanceY;
  return distance >= searchThreshold && distance < pageThreshold;
}

export function isListSearchBoundaryGesture(
  startOffset: number,
  distanceY: number,
  pageThreshold: number,
  velocityY = 0,
  flingVelocity = Number.POSITIVE_INFINITY,
): boolean {
  return startOffset <= 1 && isDateGroupSearchBoundaryGesture(
    "top",
    ["top"],
    distanceY,
    pageThreshold,
    undefined,
    velocityY,
    flingVelocity,
  );
}

export function shouldApplyDateGroupMeasurement(
  measurementGeneration: number,
  currentGeneration: number,
  nodeIsCurrent: boolean,
  height: number,
): boolean {
  return measurementGeneration === currentGeneration
    && nodeIsCurrent
    && Number.isFinite(height)
    && height > 0;
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
 * Resolves one vertical page gesture from the date key that was active when
 * the gesture began. A gesture can move at most one item, even when its
 * velocity is high or the list contains many groups.
 *
 * Finger/mouse movement uses the usual screen convention: a negative y
 * distance is an upward swipe and advances to the next (older) date.
 */
export function getDateGroupPageIndex(
  currentKey: string | null,
  groupKeys: readonly string[],
  distanceY: number,
  velocityY: number,
  threshold: number,
  flingVelocity: number,
): number {
  if (groupKeys.length === 0) return 0;
  const currentIndex = currentKey ? groupKeys.indexOf(currentKey) : -1;
  const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  const shouldAdvance =
    Math.abs(velocityY) > flingVelocity || Math.abs(distanceY) >= threshold;
  if (!shouldAdvance) return safeCurrentIndex;

  const direction = velocityY < 0
    || (Math.abs(velocityY) <= flingVelocity && distanceY < 0)
    ? 1
    : -1;
  return Math.max(0, Math.min(safeCurrentIndex + direction, groupKeys.length - 1));
}

/**
 * Converts a single gesture into a deterministic date-key and header target.
 * Missing measurements are intentionally a no-op; callers can keep the
 * current page rather than guessing an offset from an incomplete virtualized
 * list.
 */
export function getDateGroupPageDecision(
  currentKey: string | null,
  groupKeys: readonly string[],
  layouts: readonly DateGroupLayout[],
  distanceY: number,
  velocityY: number,
  threshold: number,
  flingVelocity: number,
): DateGroupPageDecision {
  const index = getDateGroupPageIndex(
    currentKey,
    groupKeys,
    distanceY,
    velocityY,
    threshold,
    flingVelocity,
  );
  const dateKey = groupKeys[index] ?? null;
  const layout = dateKey
    ? layouts.find((candidate) => candidate.dateKey === dateKey)
    : undefined;
  return {
    index,
    dateKey,
    targetOffset: layout ? Math.max(0, layout.offset) : null,
  };
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

export function resolveDateGroupAnchor(
  previousKey: string | null,
  previousKeys: readonly string[],
  nextKeys: readonly string[],
  resetToFirst: boolean,
): string | null {
  return resetToFirst
    ? nextKeys[0] ?? null
    : preserveDateGroupAnchor(previousKey, previousKeys, nextKeys);
}