import { describe, expect, it } from "vitest";
import { shouldShowInboxOfflineEmptyNotice } from "../inboxOfflineState";

describe("inbox offline empty notice", () => {
  it("shows offline guidance when the initial query is pending and paused without data", () => {
    expect(
      shouldShowInboxOfflineEmptyNotice({
        isOnline: false,
        isPending: true,
        hasData: false,
      }),
    ).toBe(true);
  });

  it("never covers restored inbox data while offline", () => {
    expect(
      shouldShowInboxOfflineEmptyNotice({
        isOnline: false,
        isPending: false,
        hasData: true,
      }),
    ).toBe(false);
  });

  it("leaves an online empty response to the normal empty-state branch", () => {
    expect(
      shouldShowInboxOfflineEmptyNotice({
        isOnline: true,
        isPending: false,
        hasData: true,
      }),
    ).toBe(false);
  });
});