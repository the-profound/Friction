/**
 * Shared, platform-independent carousel geometry. Keeping these rules outside
 * the view lets the inbox and record screens verify the same behavior.
 */
export function clampCarouselIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.max(0, Math.min(index, itemCount - 1));
}

export function getCarouselNextIndex(
  currentIndex: number,
  itemCount: number,
  distanceX: number,
  velocityX: number,
  threshold: number,
  flingVelocity: number,
): number {
  const shouldAdvance = Math.abs(velocityX) > flingVelocity || Math.abs(distanceX) >= threshold;
  if (!shouldAdvance) return clampCarouselIndex(currentIndex, itemCount);
  const direction = velocityX < 0 || (Math.abs(velocityX) <= flingVelocity && distanceX < 0) ? 1 : -1;
  return clampCarouselIndex(currentIndex + direction, itemCount);
}

/** Returns the real, measured date-header offsets in their visual order. */
export function buildDateSnapOffsets(
  dateKeys: readonly string[],
  measuredOffsets: ReadonlyMap<string, number>,
): number[] {
  const offsets = dateKeys
    .map((dateKey) => measuredOffsets.get(dateKey))
    .filter((offset): offset is number => offset !== undefined)
    .map((offset) => Math.max(0, Math.round(offset)));

  return Array.from(new Set([0, ...offsets.filter((offset) => offset > 0)]));
}

export function findNearestDateSnapOffset(offset: number, snapOffsets: readonly number[]): number | null {
  if (snapOffsets.length === 0) return null;
  return snapOffsets.reduce(
    (closest, candidate) =>
      Math.abs(candidate - offset) < Math.abs(closest - offset) ? candidate : closest,
    snapOffsets[0],
  );
}