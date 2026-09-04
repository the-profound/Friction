import type { BodyTypographyMetrics } from "./bodyLayout";
import type { BodyFontReadyStatus } from "@/components/shared/bodyTypographyFonts";

declare const __DEV__: boolean | undefined;

export type BodyTypographyRenderer = "reader" | "editor" | "measure";

export function shouldApplyBodyTypographyGeneration(
  incomingGeneration: number,
  appliedGeneration: number,
): boolean {
  return incomingGeneration >= appliedGeneration;
}

export interface BodyFontLoadStatus {
  eulyooRegular: boolean;
  eulyooSemiBold: boolean;
  notoRegular: boolean;
  notoSemiBold: boolean;
}

export interface BodyTypographyDiagnostic {
  layoutGeneration?: number;
  domWidthPx: number;
  fontSizePx: number;
  lineHeightPx: number;
  letterSpacingPx: number;
  textSizeAdjust: string;
  devicePixelRatio: number;
  configuredTextZoomPercent: number;
  effectiveFontScaleRatio: number;
  fontFamily: string;
  fonts: BodyFontLoadStatus;
  lineBreakOffsets?: number[];
}

const FONT_PROBES = [
  ["eulyooRegular", "400 16px 'Eulyoo1945-Regular'"],
  ["eulyooSemiBold", "600 16px 'Eulyoo1945-SemiBold'"],
  ["notoRegular", "400 16px 'NotoSerifKR_400Regular'"],
  ["notoSemiBold", "600 16px 'NotoSerifKR_600SemiBold'"],
] as const;

let webBodyFontReadyPromise: Promise<BodyFontLoadStatus> | null = null;

export function hasCompleteBodyFontSet(status: BodyFontLoadStatus | null): boolean {
  return !!(
    status?.eulyooRegular &&
    status.eulyooSemiBold &&
    status.notoRegular &&
    status.notoSemiBold
  );
}

export function hasPrimaryBodyFontSet(status: BodyFontLoadStatus | null): boolean {
  return !!(status?.eulyooRegular && status.eulyooSemiBold);
}

function readWebBodyFontStatus(): BodyFontLoadStatus {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  return Object.fromEntries(
    FONT_PROBES.map(([key, shorthand]) => [
      key,
      !!fonts?.check(shorthand, "가잓"),
    ]),
  ) as unknown as BodyFontLoadStatus;
}

/**
 * Expo Web registers the same font-family names in document.fonts that native
 * WebViews embed as WOFF2. Wait for all four faces (or the bounded fallback)
 * before a renderer reports ready or measures text.
 */
export async function waitForWebBodyFonts(): Promise<BodyFontLoadStatus> {
  if (webBodyFontReadyPromise) return webBodyFontReadyPromise;
  webBodyFontReadyPromise = waitForWebBodyFontsOnce();
  return webBodyFontReadyPromise;
}

async function waitForWebBodyFontsOnce(): Promise<BodyFontLoadStatus> {
  if (typeof document === "undefined" || !document.fonts) {
    return {
      eulyooRegular: false,
      eulyooSemiBold: false,
      notoRegular: false,
      notoSemiBold: false,
    };
  }

  const load = Promise.all(
    FONT_PROBES.map(([, shorthand]) => document.fonts.load(shorthand, "가잓")),
  ).then(() => document.fonts.ready);
  await Promise.race([
    load,
    new Promise<void>((resolve) => setTimeout(resolve, 4000)),
  ]).catch(() => undefined);
  return readWebBodyFontStatus();
}

export function logWebBodyTypographyDiagnostic(
  renderer: BodyTypographyRenderer,
  element: HTMLElement,
  metrics: BodyTypographyMetrics,
  fonts = readWebBodyFontStatus(),
): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  const computed = window.getComputedStyle(element);
  logBodyTypographyDiagnostic(renderer, {
    domWidthPx: element.getBoundingClientRect().width,
    fontSizePx: Number.parseFloat(computed.fontSize),
    lineHeightPx: Number.parseFloat(computed.lineHeight),
    letterSpacingPx: Number.parseFloat(computed.letterSpacing),
    textSizeAdjust:
      computed.getPropertyValue("text-size-adjust") ||
      computed.getPropertyValue("-webkit-text-size-adjust") ||
      "unknown",
    devicePixelRatio: window.devicePixelRatio || 1,
    configuredTextZoomPercent: metrics.textScalePercent,
    effectiveFontScaleRatio:
      Number.parseFloat(computed.fontSize) / metrics.fontSizePx,
    fontFamily: computed.fontFamily,
    fonts,
  });
}

export function logBodyTypographyDiagnostic(
  renderer: BodyTypographyRenderer,
  diagnostic: BodyTypographyDiagnostic,
): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  // eslint-disable-next-line no-console
  console.info(`[bodyTypography:${renderer}]`, diagnostic);
}

export function logBodyFontReadyDiagnostic(
  renderer: BodyTypographyRenderer,
  status: BodyFontReadyStatus,
): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  // Keep face decoding and actual glyph selection separate in diagnostics.
  // eslint-disable-next-line no-console
  console.info(`[bodyFonts:${renderer}]`, status);
}