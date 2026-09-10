import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveReservationIntentAction } from "../spaceReservationIntent";

const read = (relativePath: string) =>
  fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("space send reservation route", () => {
  const sendScreen = read("../../app/to-send.tsx");
  const sendInline = read("../../components/ToInline/SendInline.tsx");
  const scheduleScreen = read("../../app/of-space-schedule-send.tsx");
  const scheduleSheet = read(
    "../../components/ArticleScheduleSheet/ArticleScheduleSheet.tsx",
  );

  it("routes only the confirmed space action into the reservation flow", () => {
    expect(sendInline).toContain(
      'if (mode === "space" && selectedSpace && displayedArticle)',
    );
    expect(sendInline).toContain(
      "onScheduleSpace(selectedSpace.id, displayedArticle.id)",
    );
    expect(sendScreen).toContain('pathname: "/of-space-schedule-send"');
    expect(sendScreen).toContain('startReservation: "1"');
    expect(sendScreen).toContain("prefillArticleId: articleId");
    expect(sendScreen).toContain(
      "if (scheduleNavigationStartedRef.current) return",
    );
  });

  it("revalidates and consumes the prefilled article intent once", () => {
    expect(scheduleScreen).toContain(
      "consumedReservationIntentRef.current === intentKey",
    );
    expect(scheduleScreen).toContain(
      "articles.some((article) => article.id === prefillArticleId)",
    );
    expect(scheduleScreen).toContain('if (action === "wait") return');
    expect(scheduleScreen).toContain("initialArticleId={initialArticleId}");
  });

  it("waits when the article resolves before slots, then opens once eligibility is ready", () => {
    expect(
      resolveReservationIntentAction({
        articleQueryPending: false,
        eligibilityPending: true,
        isSchedulingBlocked: false,
        slotCount: 0,
        hasUnresolvedCenterAssignment: false,
      }),
    ).toBe("wait");
    expect(
      resolveReservationIntentAction({
        articleQueryPending: false,
        eligibilityPending: false,
        isSchedulingBlocked: false,
        slotCount: 1,
        hasUnresolvedCenterAssignment: false,
      }),
    ).toBe("open-slot-picker");
  });

  it("settles blocked and empty-slot intents without reopening", () => {
    expect(
      resolveReservationIntentAction({
        articleQueryPending: false,
        eligibilityPending: false,
        isSchedulingBlocked: true,
        slotCount: 1,
        hasUnresolvedCenterAssignment: false,
      }),
    ).toBe("blocked");
    expect(
      resolveReservationIntentAction({
        articleQueryPending: false,
        eligibilityPending: false,
        isSchedulingBlocked: false,
        slotCount: 0,
        hasUnresolvedCenterAssignment: true,
      }),
    ).toBe("unresolved-slot");
    expect(
      resolveReservationIntentAction({
        articleQueryPending: false,
        eligibilityPending: false,
        isSchedulingBlocked: false,
        slotCount: 0,
        hasUnresolvedCenterAssignment: false,
      }),
    ).toBe("no-slots");
  });

  it("skips the letter picker for a valid prefill and rejects stale selections", () => {
    expect(scheduleSheet).toContain("() => !initialArticleId");
    expect(scheduleSheet).toContain(
      "articles.some((article) => article.id === selectedArticleId)",
    );
    expect(scheduleSheet).toContain("setLetterPickerVisible(true)");
  });
});