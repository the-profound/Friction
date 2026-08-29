export interface HsvColor {
  /** Hue in degrees [0, 360). */
  h: number;
  /** Saturation in the range [0, 1]. */
  s: number;
  /** Value/brightness in the range [0, 1]. */
  v: number;
}

export interface CoverColorSettings {
  type?: string;
  textColor?: string;
  bgColor?: string;
}

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Returns a canonical opaque hex color, or null for unsupported input.
 *
 * Cover colors intentionally do not support alpha. Keeping this check in one
 * place prevents invalid strings from reaching React Native's color parser.
 */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(HEX_COLOR_PATTERN);
  if (!match) return null;

  const raw = match[1];
  const expanded =
    raw.length === 3
      ? raw
          .split("")
          .map((character) => character + character)
          .join("")
      : raw;
  return `#${expanded.toUpperCase()}`;
}

export function hexToHsv(value: unknown): HsvColor | null {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;

  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }

  return {
    h: hue < 0 ? hue + 360 : hue,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

/**
 * Converts HSV to a canonical opaque hex color. Out-of-range values are
 * clamped so a boundary event can never create an invalid cover value.
 */
export function hsvToHex(color: HsvColor): string {
  const hue = ((Number.isFinite(color.h) ? color.h : 0) % 360 + 360) % 360;
  const saturation = clamp(
    Number.isFinite(color.s) ? color.s : 0,
    0,
    1,
  );
  const value = clamp(Number.isFinite(color.v) ? color.v : 0, 0, 1);
  const chroma = value * saturation;
  const huePrime = hue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = value - chroma;

  let red = 0;
  let green = 0;
  let blue = 0;
  if (huePrime < 1) {
    red = chroma;
    green = x;
  } else if (huePrime < 2) {
    red = x;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = x;
  } else if (huePrime < 4) {
    green = x;
    blue = chroma;
  } else if (huePrime < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  const toByte = (channel: number) =>
    Math.round(clamp(channel + match, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();

  return `#${toByte(red)}${toByte(green)}${toByte(blue)}`;
}

export function getHsvFromHex(value: unknown, fallback: HsvColor): HsvColor {
  return hexToHsv(value) ?? fallback;
}

/** Maps a measured horizontal hue strip position to the HSV hue range. */
export function getHueAtPosition(positionX: number, width: number): number {
  if (!Number.isFinite(positionX) || !Number.isFinite(width) || width <= 0) {
    return 0;
  }
  return (clamp(positionX / width, 0, 1) * 360) % 360;
}

/** Maps a measured spectrum position to saturation and brightness. */
export function getSpectrumAtPosition(
  current: HsvColor,
  positionX: number,
  positionY: number,
  width: number,
  height: number,
): HsvColor {
  if (
    !Number.isFinite(positionX) ||
    !Number.isFinite(positionY) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return current;
  }
  return {
    ...current,
    s: clamp(positionX / width, 0, 1),
    v: 1 - clamp(positionY / height, 0, 1),
  };
}

/**
 * Keeps a saved cover's color fields safe before they reach a preview, editor,
 * or save request. Valid colors are returned in the canonical form used by the
 * color picker; an invalid color cover gets a usable neutral background.
 */
export function normalizeCoverColorSettings<T extends CoverColorSettings>(
  cover: T,
  fallbackTextColor: string,
  fallbackBackgroundColor: string,
): T {
  const textColor =
    normalizeHexColor(cover.textColor) ??
    normalizeHexColor(fallbackTextColor) ??
    "#18181B";
  const bgColor = normalizeHexColor(cover.bgColor);

  return {
    ...cover,
    textColor,
    ...(bgColor
      ? { bgColor }
      : cover.type === "color"
        ? {
            bgColor:
              normalizeHexColor(fallbackBackgroundColor) ?? "#FAFAFA",
          }
        : { bgColor: undefined }),
  } as T;
}