import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRecordControlsTimer,
  RECORD_CONTROLS_INACTIVITY_MS,
  restartRecordControlsTimer,
} from "../recordControlsInactivity";

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
});