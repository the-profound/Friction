import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detailSource = readFileSync(
  new URL("../../app/of-space-detail.tsx", import.meta.url),
  "utf8",
);
const scheduleSource = readFileSync(
  new URL("../../app/of-space-schedule-send.tsx", import.meta.url),
  "utf8",
);
const sheetSource = readFileSync(
  new URL("../../components/ArticleScheduleSheet/ArticleScheduleSheet.tsx", import.meta.url),
  "utf8",
);

describe("past assigned CENTER slot catch-up flow", () => {
  it("keeps the past owner CTA behind an explicit explanation", () => {
    expect(detailSource).toContain(
      "{isMySlot && !isScheduled && !schedulingDisabled && (",
    );
    expect(detailSource).toContain('"지난 차례 채우기"');
    expect(detailSource).toContain('title="지난 차례를 지금 채울까요?"');
    expect(detailSource).toContain("가장 가까운 발신 가능 시각으로 자동 예약돼요.");
    expect(detailSource).toContain('catchUp: "1"');
  });

  it("keeps catch-up available after round completion but hides it after space archival", () => {
    expect(detailSource).toContain("schedulingDisabled={isSpaceArchived}");
    expect(detailSource).not.toContain(
      'schedulingDisabled={roundStatus === "COMPLETED" || isSpaceArchived}',
    );
  });

  it("revalidates the exact expired owner slot and excludes used rounds", () => {
    expect(scheduleSource).toContain("const catchUpCenterSlots = useMemo(");
    expect(scheduleSource).toContain("!isKstSlotReservable(s.date, now)");
    expect(scheduleSource).toContain("!pendingCenterRoundIds.has(s.roundId)");
    expect(scheduleSource).toContain("!sentCenterRoundIds.has(s.roundId)");
    expect(scheduleSource).toContain(
      "slot.slotId === slotId && (!roundId || slot.roundId === roundId)",
    );
    expect(scheduleSource).toContain("catchUp: true");
  });

  it("fixes the slot and omits all date selection and client dates", () => {
    expect(sheetSource).toContain('export type ArticleScheduleSheetMode = "general" | "opening-letter" | "catch-up"');
    expect(sheetSource).toMatch(/isCatchUp\s*\?\s*\{ catchUp: true \}/);
    expect(sheetSource).toContain("날짜는 직접 선택할 수 없어요.");
    expect(sheetSource).not.toContain("catchUp: true, scheduledAt");
  });
});