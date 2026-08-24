import { describe, expect, it } from "vitest";
import {
  getSpaceLetterAuthorName,
  getSpaceRoundPresentationStatus,
  isKstSlotReservable,
  isOpeningSlotReservable,
  roundStatusLabel,
  sortSpaceRoundSlotsForPresentation,
  shouldDimSpaceRoundLetter,
  sortSpaceRoundsNewestFirst,
} from "../spaceRoundPresentation";
import {
  countRecruitmentParticipants,
  isRecruitmentFull,
} from "../spaceRecruitment";

describe("space round presentation", () => {
  it("keeps the operator out of recruitment capacity regardless of round participation", () => {
    const approvedMembers = [
      { role: "OPERATOR" },
      { role: "PARTICIPANT" },
      { role: "PARTICIPANT" },
    ];

    expect(countRecruitmentParticipants(approvedMembers)).toBe(2);
    expect(isRecruitmentFull(2, countRecruitmentParticipants(approvedMembers))).toBe(true);
    expect(isRecruitmentFull(3, countRecruitmentParticipants(approvedMembers))).toBe(false);
  });

  it("labels completed rounds as ended", () => {
    expect(roundStatusLabel("COMPLETED")).toBe("종료");
    expect(roundStatusLabel("ACTIVE")).toBe("진행 중");
    expect(roundStatusLabel("UPCOMING")).toBe("예정");
  });

  it("orders rounds from newest to oldest without mutating API data", () => {
    const rounds = [
      { id: "round-2", roundNumber: 2 },
      { id: "round-4", roundNumber: 4 },
      { id: "round-1", roundNumber: 1 },
      { id: "round-3", roundNumber: 3 },
    ];

    expect(sortSpaceRoundsNewestFirst(rounds).map((round) => round.roundNumber)).toEqual([
      4,
      3,
      2,
      1,
    ]);
    expect(rounds.map((round) => round.roundNumber)).toEqual([2, 4, 1, 3]);
  });

  it("keeps read covers vivid only in completed-round carousels", () => {
    expect(shouldDimSpaceRoundLetter("COMPLETED", true)).toBe(false);
    expect(shouldDimSpaceRoundLetter("ACTIVE", true)).toBe(true);
    expect(shouldDimSpaceRoundLetter("UPCOMING", true)).toBe(true);
    expect(shouldDimSpaceRoundLetter("ACTIVE", false)).toBe(false);
  });

  it("derives upcoming, active, and completed states by inclusive KST date range", () => {
    const round = {
      roundNumber: 1,
      status: "UPCOMING",
      startsAt: "2026-08-20T00:00:00.000Z",
      endsAt: "2026-08-22T14:59:59.000Z",
    };

    expect(getSpaceRoundPresentationStatus(round, new Date("2026-08-19T14:59:59.000Z"))).toBe("UPCOMING");
    expect(getSpaceRoundPresentationStatus(round, new Date("2026-08-19T15:00:00.000Z"))).toBe("ACTIVE");
    expect(getSpaceRoundPresentationStatus(round, new Date("2026-08-22T14:59:59.000Z"))).toBe("ACTIVE");
    expect(getSpaceRoundPresentationStatus(round, new Date("2026-08-22T15:00:00.000Z"))).toBe("COMPLETED");
  });

  it("closes slots exactly at KST 06:00 and sorts expired empty slots last", () => {
    const beforeDeadline = new Date("2026-08-19T20:59:59.000Z"); // 05:59:59 KST Aug 20
    const atDeadline = new Date("2026-08-19T21:00:00.000Z"); // 06:00 KST Aug 20
    expect(isKstSlotReservable("2026-08-20", beforeDeadline)).toBe(true);
    expect(isKstSlotReservable("2026-08-20", atDeadline)).toBe(false);
    expect(isOpeningSlotReservable("2026-08-20T00:00:00.000Z", beforeDeadline)).toBe(true);
    expect(isOpeningSlotReservable("2026-08-20T00:00:00.000Z", atDeadline)).toBe(false);
    expect(
      getSpaceRoundPresentationStatus(
        {
          roundNumber: 1,
          status: "UPCOMING",
          startsAt: "2026-08-20T00:00:00.000Z",
          endsAt: "2026-08-21T14:59:59.000Z",
        },
        beforeDeadline,
      ),
    ).toBe("ACTIVE");

    expect(
      sortSpaceRoundSlotsForPresentation(
        [
          { id: "past", scheduledDate: "2026-08-20", slotOrder: 0 },
          { id: "future", scheduledDate: "2026-08-21", slotOrder: 1 },
        ],
        atDeadline,
      ).map((slot) => slot.id),
    ).toEqual(["future", "past"]);
  });

  it("uses the safe anonymous display name for every letter type", () => {
    expect(getSpaceLetterAuthorName("OPENING", true, "달빛", "실명")).toBe("달빛");
    expect(getSpaceLetterAuthorName("CENTER", true, "참여자", "실명")).toBe("참여자");
    expect(getSpaceLetterAuthorName("OPENING", true, null, "실명")).toBe("참여자");
    expect(getSpaceLetterAuthorName("OPENING", false, "참여자 1", "실명")).toBe("실명");
  });
});