import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRecordControlsTimer,
  getNextRecordControlsVisibility,
  getRecordControlsScrollVisibility,
  RECORD_CONTROLS_INACTIVITY_MS,
  RECORD_CONTROLS_SCROLL_THRESHOLD,
  restartRecordControlsTimer,
} from "../recordControlsInactivity";

describe("record controls scroll visibility", () => {
  it("ignores movement below the existing threshold", () => {
    expect(getRecordControlsScrollVisibility(
      20,
      20 + RECORD_CONTROLS_SCROLL_THRESHOLD - 1,
    )).toBe("unchanged");
    expect(getRecordControlsScrollVisibility(
      20,
      20 - RECORD_CONTROLS_SCROLL_THRESHOLD + 1,
    )).toBe("unchanged");
  });

  it("hides while scrolling down and shows while scrolling up", () => {
    expect(getRecordControlsScrollVisibility(20, 26)).toBe("hide");
    expect(getRecordControlsScrollVisibility(26, 20)).toBe("show");
  });

  it("always shows at the top even after a sub-threshold move", () => {
    expect(getRecordControlsScrollVisibility(4, 0)).toBe("show");
  });
});

describe("record controls visibility priority", () => {
  it("keeps current visibility for directionless activity", () => {
    expect(getNextRecordControlsVisibility(true, "activity", false)).toBe(true);
    expect(getNextRecordControlsVisibility(false, "activity", false)).toBe(false);
  });

  it("applies immediate direction and inactivity changes", () => {
    expect(getNextRecordControlsVisibility(true, "hide", false)).toBe(false);
    expect(getNextRecordControlsVisibility(false, "show", false)).toBe(true);
    expect(getNextRecordControlsVisibility(true, "inactive", false)).toBe(false);
  });

  it("keeps controls hidden throughout search", () => {
    expect(getNextRecordControlsVisibility(true, "show", true)).toBe(false);
    expect(getNextRecordControlsVisibility(false, "activity", true)).toBe(false);
  });
});

describe("record controls inactivity timer", () => {
  afterEach(() => vi.useRealTimers());

  it("hides after five seconds and restarts from user activity", () => {
    vi.useFakeTimers();
    const onInactive = vi.fn();
    let timer = restartRecordControlsTimer(null, onInactive);

    vi.advanceTimersByTime(RECORD_CONTROLS_INACTIVITY_MS - 100);
    timer = restartRecordControlsTimer(timer, onInactive);
    vi.advanceTimersByTime(100);
    expect(onInactive).not.toHaveBeenCalled();

    vi.advanceTimersByTime(RECORD_CONTROLS_INACTIVITY_MS - 100);
    expect(onInactive).toHaveBeenCalledOnce();
    clearRecordControlsTimer(timer);
  });

  it("does not run a cleared inactivity callback", () => {
    vi.useFakeTimers();
    const onInactive = vi.fn();
    const timer = restartRecordControlsTimer(null, onInactive);

    clearRecordControlsTimer(timer);
    vi.advanceTimersByTime(RECORD_CONTROLS_INACTIVITY_MS);

    expect(onInactive).not.toHaveBeenCalled();
  });
});