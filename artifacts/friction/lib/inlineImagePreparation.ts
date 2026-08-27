export const INLINE_IMAGE_MAX_EDGE = 1600;
export const INLINE_IMAGE_COMPRESSION = 0.8;

export function getInlineImageResizeAction(
  width: number | null | undefined,
  height: number | null | undefined,
): { width: number } | { height: number } | null {
  const safeWidth = width ?? 0;
  const safeHeight = height ?? 0;
  const longestEdge = Math.max(safeWidth, safeHeight);
  if (longestEdge <= INLINE_IMAGE_MAX_EDGE) return null;
  return safeWidth >= safeHeight
    ? { width: INLINE_IMAGE_MAX_EDGE }
    : { height: INLINE_IMAGE_MAX_EDGE };
}