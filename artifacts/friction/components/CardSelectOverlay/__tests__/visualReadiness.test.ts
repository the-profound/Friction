import { describe, expect, it } from "vitest";
import {
  advanceVisualGate,
  isCurrentVisualReady,
  type VisualGate,
} from "../visualReadiness";

const initialGate: VisualGate = {
  key: "0:letter-a:https://example.com/a.jpg",
  token: 4,
  session: 12,
  slotIndex: 0,
  imageUrl: "https://example.com/a.jpg",
};

describe("CardSelectOverlay image readiness gate", () => {
  it("accepts only the display callback for its exact session, generation, slot, and URL", () => {
    expect(
      isCurrentVisualReady(initialGate, {
        token: 4,
        session: 12,
        slotIndex: 0,
        imageUrl: "https://example.com/a.jpg",
      }),
    ).toBe(true);
    expect(
      isCurrentVisualReady(initialGate, {
        token: 4,
        session: 12,
        slotIndex: 0,
        imageUrl: "https://example.com/other.jpg",
      }),
    ).toBe(false);
  });

  it("rejects a queued callback after the selected slot shifts in the same open session", () => {
    const shiftedGate = advanceVisualGate(initialGate, {
      key: "1:letter-a:https://example.com/a.jpg",
      session: 12,
      slotIndex: 1,
      imageUrl: "https://example.com/a.jpg",
    });

    expect(
      isCurrentVisualReady(shiftedGate, {
        token: initialGate.token,
        session: 12,
        slotIndex: 0,
        imageUrl: "https://example.com/a.jpg",
      }),
    ).toBe(false);
    expect(
      isCurrentVisualReady(shiftedGate, {
        token: shiftedGate.token,
        session: 12,
        slotIndex: 1,
        imageUrl: "https://example.com/a.jpg",
      }),
    ).toBe(true);
  });

  it("rejects delivery from a prior close and reopen session", () => {
    const reopenedGate = advanceVisualGate(initialGate, {
      key: initialGate.key,
      session: 13,
      slotIndex: 0,
      imageUrl: "https://example.com/a.jpg",
    });

    expect(
      isCurrentVisualReady(reopenedGate, {
        token: initialGate.token,
        session: 12,
        slotIndex: 0,
        imageUrl: "https://example.com/a.jpg",
      }),
    ).toBe(false);
  });
});