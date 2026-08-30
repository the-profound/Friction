/** Shared, platform-independent horizontal carousel geometry. */
export function clampCarouselIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.max(0, Math.min(index, itemCount - 1));
}

/**
 * Keeps the selected entity stable while a queue refresh changes its slots.
 * If that entity disappeared, retain the nearest still-valid numeric slot.
 */
export function preserveCarouselIndex(
  activeItemKey: string | null,
  currentIndex: number,
  itemKeys: readonly string[],
): number {
  const selectedIndex = activeItemKey ? itemKeys.indexOf(activeItemKey) : -1;
  return selectedIndex >= 0
    ? selectedIndex
    : clampCarouselIndex(currentIndex, itemKeys.length);
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

/** Exact outer height reserved by DateGroupCarousel for one date group. */
export function getDateGroupCarouselHeight(
  cardHeight: number,
  actionAreaHeight: number,
  chromeHeight: number,
): number {
  return cardHeight + actionAreaHeight + chromeHeight;
}