import { runtimeConfig } from "./runtimeConfig";

const INLINE_IMAGE_MARKDOWN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const MAX_SOURCE_EDGE = 1600;

export function isPersistableInlineImageUrl(value: string): boolean {
  const url = value.trim().toLowerCase();
  // Article photos must have a stable remote source. Historical object-storage
  // URLs are HTTP(S), so they remain readable while device/blob/data URLs are
  // excluded from every persistence boundary.
  return url.startsWith("https://") || url.startsWith("http://");
}

/**
 * Removes unresolved local image nodes before an editor export reaches
 * autosave. The editor performs the same check, but this is a second boundary
 * for the web editor and for interrupted WebView exports.
 */
export function removeUnpersistableInlineImages(markdown: string): string {
  return markdown.replace(INLINE_IMAGE_MARKDOWN, (full, _alt: string, rawUrl: string) =>
    isPersistableInlineImageUrl(rawUrl) ? full : "",
  );
}

export function getInlineImageTransformUrl(
  originalUrl: string,
  displayWidth: number,
  pixelRatio: number,
  configuredSupabaseUrl = runtimeConfig.supabaseUrl,
): string {
  const supabaseUrl = configuredSupabaseUrl?.replace(/\/+$/, "");
  if (!supabaseUrl || !Number.isFinite(displayWidth) || !Number.isFinite(pixelRatio)) {
    return originalUrl;
  }

  const publicPrefix = `${supabaseUrl}/storage/v1/object/public/`;
  if (!originalUrl.startsWith(publicPrefix)) return originalUrl;

  const objectRef = originalUrl.slice(publicPrefix.length);
  if (!objectRef || objectRef.includes("?")) return originalUrl;

  const width = Math.max(1, Math.min(MAX_SOURCE_EDGE, Math.round(displayWidth * pixelRatio)));
  return `${supabaseUrl}/storage/v1/render/image/public/${objectRef}?width=${width}&resize=contain&quality=80`;
}

export const INLINE_IMAGE_DISPLAY_WIDTH = 240;