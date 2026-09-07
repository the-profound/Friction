import { describe, expect, it } from "vitest";
import {
  INLINE_PANEL_FALLBACK_MAX_PX,
  INLINE_PANEL_FALLBACK_SCREEN_RATIO,
  resolveFloatingChromeOffset,
} from "../floatingChromeOffset";

describe("resolveFloatingChromeOffset", () => {
  it("uses the live keyboard height while the keyboard is visible", () => {
    expect(
      resolveFloatingChromeOffset({
        keyboardVisible: true,
        keyboardHeight: 336,
        lastKnownKeyboardHeight: 300,
        screenHeight: 812,
      }),
    ).toBe(336);
  });

  it("freezes at the last known keyboard height once the keyboard hides", () => {
    // This is the exact transition that used to cause a double jump: the
    // keyboard hide event zeroes keyboardHeight/keyboardVisible, but a panel
    // (or the toolbar) that stays visible must not collapse toward 0.
    expect(
      resolveFloatingChromeOffset({
        keyboardVisible: false,
        keyboardHeight: 0,
        lastKnownKeyboardHeight: 336,
        screenHeight: 812,
      }),
    ).toBe(336);
  });

  it("falls back to a screen-relative estimate only when no keyboard height was ever seen", () => {
    expect(
      resolveFloatingChromeOffset({
        keyboardVisible: false,
        keyboardHeight: 0,
        lastKnownKeyboardHeight: 0,
        screenHeight: 800,
      }),
    ).toBe(Math.round(800 * INLINE_PANEL_FALLBACK_SCREEN_RATIO));
  });

  it("caps the screen-relative fallback so it never exceeds the max", () => {
    expect(
      resolveFloatingChromeOffset({
        keyboardVisible: false,
        keyboardHeight: 0,
        lastKnownKeyboardHeight: 0,
        screenHeight: 2000,
      }),
    ).toBe(INLINE_PANEL_FALLBACK_MAX_PX);
  });

  it("prefers the live keyboard height over a stale last-known value", () => {
    expect(
      resolveFloatingChromeOffset({
        keyboardVisible: true,
        keyboardHeight: 300,
        lastKnownKeyboardHeight: 336,
        screenHeight: 812,
      }),
    ).toBe(300);
  });
});
