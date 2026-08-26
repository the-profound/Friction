/** Shared, platform-independent horizontal carousel geometry. */
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