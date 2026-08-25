export interface CardReturnTransform {
  startTx: number;
  startTy: number;
  originScale: number;
  finalScale: number;
  cardWidth: number;
  progress: number;
  swipeY: number;
  carouselX: number;
  carouselTargetX: number;
}

/**
 * Returns the current visual distance from the card back to its originating
 * slot. The card's base translation at a given progress is
 * `startT * (1 - progress)`; a downward swipe is added after that base
 * translation, so it is subtracted when measuring the remaining distance.
 */
export const calculateCardReturnDistance = ({
  startTx,
  startTy,
  originScale,
  finalScale,
  cardWidth,
  progress,
  swipeY,
  carouselX,
  carouselTargetX,
}: CardReturnTransform) => {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const cardTranslationDistance = Math.hypot(
    startTx * clampedProgress,
    startTy * clampedProgress - swipeY,
  );
  const scaleDistance =
    Math.abs(finalScale - originScale) * cardWidth * clampedProgress;
  const carouselDistance = Math.abs(carouselX - carouselTargetX);

  return cardTranslationDistance + scaleDistance + carouselDistance;
};