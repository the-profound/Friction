import { describe, expect, it } from "vitest";
import { createSelectionScrollRestorationState } from "../useSelectionScrollRestoration";

describe("selection scroll restoration state", () => {
  it("returns the captured position only after selection mode closes", () => {
    const state = createSelectionScrollRestorationState();

    state.capture(428);
    expect(state.consumeForClose(true)).toBeNull();
    expect(state.consumeForClose(false)).toEqual({ offset: 428, session: 1 });
    expect(state.consumeForClose(false)).toBeNull();
  });

  it("does not restore after reader navigation cancels the selection", () => {
    const state = createSelectionScrollRestorationState();

    state.capture(428);
    state.cancel();

    expect(state.consumeForClose(false)).toBeNull();
  });

  it("invalidates a close frame when another cover is selected immediately", () => {
    const state = createSelectionScrollRestorationState();

    state.capture(428);
    const closingRestore = state.consumeForClose(false);
    state.capture(972);

    expect(closingRestore).toEqual({ offset: 428, session: 1 });
    expect(state.isCurrentSession(closingRestore!.session)).toBe(false);
    expect(state.consumeForClose(false)).toEqual({ offset: 972, session: 2 });
  });
});