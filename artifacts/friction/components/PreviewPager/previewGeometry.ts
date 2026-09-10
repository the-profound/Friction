export interface PreviewPagerDimensions {
  width: number;
  height: number;
}

/**
 * Returns the largest paper-sized rectangle that fits inside the measured
 * pager area. The caller is responsible for reserving header, page-navigation,
 * safe-area, and shadow spacing before passing the available size.
 */
export function fitPreviewPagerDimensions(
  availableSize: PreviewPagerDimensions,
  aspectRatio: number,
): PreviewPagerDimensions {
  if (
    availableSize.width <= 0
    || availableSize.height <= 0
    || aspectRatio <= 0
  ) {
    return { width: 0, height: 0 };
  }

  const width = Math.min(
    availableSize.width,
    availableSize.height * aspectRatio,
  );

  return {
    width,
    height: width / aspectRatio,
  };
}