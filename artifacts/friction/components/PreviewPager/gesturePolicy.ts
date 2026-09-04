export const PREVIEW_PAGER_HORIZONTAL_ACTIVATION = 20;
export const PREVIEW_PAGER_VERTICAL_FAILURE = 15;

export type PreviewPagerGestureDecision = "active" | "failed" | "undetermined";

export interface PreviewPagerTurnInput {
  pageIndex: number;
  pageCount: number;
  width: number;
  translationX: number;
  velocityX: number;
}


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

export function getPreviewPagerTurn({
  pageIndex,
  pageCount,
  width,
  translationX,
  velocityX,
}: PreviewPagerTurnInput): number {
  const lastPage = Math.max(0, pageCount - 1);
  const currentPage = Math.max(0, Math.min(pageIndex, lastPage));
  const direction = translationX < 0 ? 1 : -1;
  const destination = currentPage + direction;
  const canNavigate = destination >= 0 && destination <= lastPage;
  const shouldCommit =
    Math.abs(translationX) > width * 0.22 || Math.abs(velocityX) > 450;

  return canNavigate && shouldCommit ? destination : currentPage;
}