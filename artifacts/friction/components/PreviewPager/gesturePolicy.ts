export const PREVIEW_PAGER_HORIZONTAL_ACTIVATION = 20;
export const PREVIEW_PAGER_VERTICAL_FAILURE = 15;

export type PreviewPagerGestureDecision = "active" | "failed" | "undetermined";

/**
 * Mirrors the directional arbitration configured on the native pan gesture.
 * Vertical failure takes precedence so diagonal/vertical-biased movement can
 * never be claimed by the pager after crossing the vertical threshold.
 */
export function classifyPreviewPagerGesture(
  translationX: number,
  translationY: number,
): PreviewPagerGestureDecision {
  if (Math.abs(translationY) > PREVIEW_PAGER_VERTICAL_FAILURE) return "failed";
  if (Math.abs(translationX) > PREVIEW_PAGER_HORIZONTAL_ACTIVATION) return "active";
  return "undetermined";
}