import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routesSource = readFileSync(join(__dirname, "spaces.ts"), "utf8");
const calendarSource = readFileSync(
  join(__dirname, "../../../friction/components/shared/CalendarGrid.tsx"),
  "utf8",
);
const createScreenSource = readFileSync(
  join(__dirname, "../../../friction/app/space-create.tsx"),
  "utf8",
);
const startScreenSource = readFileSync(
  join(__dirname, "../../../friction/app/of-space-start.tsx"),
  "utf8",
);

describe("space start-date policy", () => {
  it("allows today while both shared date pickers continue blocking past dates", () => {
    expect(calendarSource).toContain("return kstToday(referenceDate)");
    expect(calendarSource).not.toContain("MIN_SPACE_START_OFFSET_DAYS");
    expect(createScreenSource).toContain(
      'isDateDisabled={(date) => startOfDay(date) < minStartDate}',
    );
    expect(startScreenSource).toContain(
      'isDateDisabled={(date) => startOfDay(date) < minStartDate}',
    );
    expect(createScreenSource).not.toContain("오늘로부터 3일");
    expect(startScreenSource).not.toContain("오늘로부터 3일");
  });

  it("uses the selected planned date as the schedule origin", () => {
    const startRoute = routesSource.slice(
      routesSource.indexOf('router.post("/spaces/:id/start"'),
      routesSource.indexOf('router.get("/spaces/:id/rounds"'),
    );

    expect(startScreenSource).toContain(
      "plannedStartsAt: formatCalendarDateKey(startDate)",
    );
    expect(startRoute).toContain(
      'const scheduleStartsAt = new Date(`${body.plannedStartsAt}T00:00:00.000Z`)',
    );
    expect(startRoute).toContain("scheduleStartsAt,");
  });

  it("groups preview and persisted slots by the configured daily center count", () => {
    const startRoute = routesSource.slice(
      routesSource.indexOf('router.post("/spaces/:id/start"'),
      routesSource.indexOf('router.get("/spaces/:id/rounds"'),
    );

    expect(startScreenSource).toContain(
      "const baseIdx = (i * centerCount) % (items.length || 1)",
    );
    expect(startRoute).toContain(
      "const centerCount = body.defaultCenterCount ?? space.defaultCenterCount",
    );
    expect(startRoute).toContain(
      "calculateSlotOccasionIndex(slotCursor + j, centerCount)",
    );
  });

  it("keeps the opening-letter KST 06:00 boundary explicit", () => {
    expect(startScreenSource).toContain(
      "const hasReservableOpeningDate = minSendDate <= maxScheduledAt",
    );
    expect(startScreenSource).toContain("const finalScheduledAt = kstDateAt6(chosenDate)");
    expect(startScreenSource).toContain(
      "여는 편지를 예약할 수 있는 날짜가 없어요. 시작 예정일을 늦춰주세요.",
    );
    expect(routesSource).toContain(
      "dateKey >= minOpeningSendKey && dateKey <= openingDeadlineKey",
    );
    const startRoute = routesSource.slice(
      routesSource.indexOf('router.post("/spaces/:id/start"'),
      routesSource.indexOf('router.get("/spaces/:id/rounds"'),
    );
    expect(startRoute.indexOf("await db.transaction")).toBeLessThan(
      startRoute.indexOf("const pendingOpeningSends = await tx"),
    );
    expect(startRoute).toContain('.for("update")');
    expect(startRoute).toContain("throw new InvalidOpeningScheduleError()");
  });
});