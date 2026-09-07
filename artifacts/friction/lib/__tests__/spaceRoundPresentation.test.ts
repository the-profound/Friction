import { describe, expect, it } from "vitest";
import {
  getSpaceLetterAuthorName,
  getSpaceLetterPresentationRoundId,
  type SpaceReservationMetadataPresentation,
  getSpaceRoundPresentationStatus,
  isKstSlotReservable,
  isOpeningSlotReservable,
  resolveUpcomingRoundCenterCards,
  roundStatusLabel,
  sortSpaceRoundSlotsForPresentation,
  sortSpaceRoundsForDetail,
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

  it("orders detail rounds by presentation status and date without mutating API data", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    const rounds = [
      {
        id: "completed-old",
        roundNumber: 1,
        status: "COMPLETED",
        startsAt: "2026-08-10T00:00:00.000Z",
        endsAt: "2026-08-12T14:59:59.000Z",
      },
      {
        id: "upcoming-far",
        roundNumber: 5,
        status: "UPCOMING",
        startsAt: "2026-08-30T00:00:00.000Z",
        endsAt: "2026-09-01T14:59:59.000Z",
      },
      {
        id: "active-lower-number",
        roundNumber: 2,
        status: "UPCOMING",
        startsAt: "2026-08-18T00:00:00.000Z",
        endsAt: "2026-08-25T14:59:59.000Z",
      },
      {
        id: "completed-recent",
        roundNumber: 3,
        status: "COMPLETED",
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2026-08-19T14:59:59.000Z",
      },
      {
        id: "active-higher-number",
        roundNumber: 4,
        status: "UPCOMING",
        startsAt: "2026-08-15T00:00:00.000Z",
        endsAt: "2026-08-22T14:59:59.000Z",
      },
    ];

    expect(
      sortSpaceRoundsForDetail(rounds, now).map((round) => round.id),
    ).toEqual([
      "active-higher-number",
      "active-lower-number",
      "upcoming-far",
      "completed-recent",
      "completed-old",
    ]);
    expect(rounds.map((round) => round.id)).toEqual([
      "completed-old",
      "upcoming-far",
      "active-lower-number",
      "completed-recent",
      "active-higher-number",
    ]);
  });

  it("uses round number for tied or missing dates in detail ordering", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    const rounds = [
      {
        id: "upcoming-tie-later-number",
        roundNumber: 7,
        status: "UPCOMING",
        startsAt: "2026-08-25T00:00:00.000Z",
      },
      {
        id: "upcoming-tie-earlier-number",
        roundNumber: 2,
        status: "UPCOMING",
        startsAt: "2026-08-25T00:00:00.000Z",
      },
      {
        id: "upcoming-missing-later-number",
        roundNumber: 9,
        status: "UPCOMING",
        startsAt: null,
      },
      {
        id: "upcoming-missing-earlier-number",
        roundNumber: 1,
        status: "UPCOMING",
        startsAt: null,
      },
    ];

    expect(
      sortSpaceRoundsForDetail(rounds, now).map((round) => round.id),
    ).toEqual([
      "upcoming-missing-later-number",
      "upcoming-tie-later-number",
      "upcoming-tie-earlier-number",
      "upcoming-missing-earlier-number",
    ]);
  });

  it("uses the KST presentation status instead of the stored status at date boundaries", () => {
    const rounds = [
      {
        id: "stored-completed-but-active",
        roundNumber: 1,
        status: "COMPLETED",
        startsAt: "2026-08-20T00:00:00.000Z",
        endsAt: "2026-08-22T14:59:59.000Z",
      },
      {
        id: "stored-upcoming-but-completed",
        roundNumber: 2,
        status: "UPCOMING",
        startsAt: "2026-08-10T00:00:00.000Z",
        endsAt: "2026-08-19T14:59:59.000Z",
      },
    ];

    expect(
      sortSpaceRoundsForDetail(rounds, new Date("2026-08-19T15:00:00.000Z")).map(
        (round) => round.id,
      ),
    ).toEqual(["stored-completed-but-active", "stored-upcoming-but-completed"]);
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

  it("shows pending center letters only in their own upcoming round slots", () => {
    const slots = [
      { id: "round-one-other", spaceRoundId: "round-one", assignedUserId: "other", scheduledDate: "2026-08-20" },
      { id: "round-one-mine", spaceRoundId: "round-one", assignedUserId: "me", scheduledDate: "2026-08-20" },
      { id: "round-two-mine", spaceRoundId: "round-two", assignedUserId: "me", scheduledDate: "2026-08-21" },
    ];
    const letters = [
      { id: "letter-one", spaceRoundId: "round-one", authorId: "me", letterType: "CENTER" },
      { id: "letter-two", spaceRoundId: "round-two", authorId: "me", letterType: "CENTER" },
      { id: "other-letter", spaceRoundId: "round-one", authorId: "other", letterType: "CENTER" },
    ];

    const result = resolveUpcomingRoundCenterCards(
      letters,
      slots,
      "me",
      [
        { spaceLetterId: "letter-one", reservation: { status: "PENDING", resolved: true, slotId: "round-one-mine", roundId: "round-one", authorId: "me", date: "2026-08-20", scheduledAt: "2026-08-19T21:00:00.000Z" } },
        { spaceLetterId: "letter-two", reservation: { status: "PENDING", resolved: true, slotId: "round-two-mine", roundId: "round-two", authorId: "me", date: "2026-08-21", scheduledAt: "2026-08-20T21:00:00.000Z" } },
        { spaceLetterId: "other-letter", reservation: { status: "PENDING", resolved: true, slotId: "round-one-other", roundId: "round-one", authorId: "other", date: "2026-08-20", scheduledAt: "2026-08-19T21:00:00.000Z" } },
      ],
    );

    expect(result.map((item) => item.kind === "letter" ? item.slotId : item.slot.id)).toEqual([
      "round-one-other",
      "round-one-mine",
      "round-two-mine",
    ]);
    expect(result.map((item) => item.kind)).toEqual(["slot", "letter", "letter"]);
  });

  it("leaves a slot reservable again when its center reservation was cancelled", () => {
    const slots = [
      { id: "mine", spaceRoundId: "upcoming", assignedUserId: "me" },
      { id: "other", spaceRoundId: "upcoming", assignedUserId: "other" },
    ];
    const letters = [
      { id: "cancelled-letter", spaceRoundId: "upcoming", authorId: "me", letterType: "CENTER" },
      { id: "other-letter", spaceRoundId: "upcoming", authorId: "other", letterType: "CENTER" },
    ];

    const result = resolveUpcomingRoundCenterCards(
      letters,
      slots,
      "me",
      [],
    );

    expect(result.map((item) => item.kind)).toEqual(["slot", "slot"]);
  });

  it("does not fill a slot from a stale reservation slot ID", () => {
    const slots = [
      { id: "round-one-mine", spaceRoundId: "round-one", assignedUserId: "me" },
      { id: "round-two-mine", spaceRoundId: "round-two", assignedUserId: "me" },
    ];
    const letters = [
      { id: "letter-one", spaceRoundId: "round-one", authorId: "me", letterType: "CENTER" },
    ];

    const result = resolveUpcomingRoundCenterCards(
      letters,
      slots,
      "me",
      [{
        spaceLetterId: "letter-one",
        reservation: {
          status: "PENDING", resolved: true, slotId: "round-two-mine",
          roundId: "round-one", authorId: "me", date: "2026-08-20",
          scheduledAt: "2026-08-19T21:00:00.000Z",
        },
      }],
    );

    expect(result.map((item) => item.kind)).toEqual(["slot", "slot"]);
  });

  it("does not guess unresolved legacy reservation metadata into a slot", () => {
    const slots = [
      { id: "round-one-mine", spaceRoundId: "round-one", assignedUserId: "me" },
      { id: "round-two-mine", spaceRoundId: "round-two", assignedUserId: "me" },
    ];
    const letters = [
      { id: "legacy-letter", spaceRoundId: "round-one", authorId: "me", letterType: "CENTER" },
    ];

    const result = resolveUpcomingRoundCenterCards(
      letters,
      slots,
      "me",
      [{ spaceLetterId: "legacy-letter" }],
    );

    expect(result.map((item) => item.kind === "letter" ? item.slotId : item.slot.id)).toEqual([
      "round-one-mine",
      "round-two-mine",
    ]);
    expect(result.map((item) => item.kind)).toEqual(["slot", "slot"]);
  });

  it("keeps a delayed CENTER letter in its resolved reservation round", () => {
    expect(getSpaceLetterPresentationRoundId({
      id: "letter", authorId: "me", letterType: "CENTER", spaceRoundId: "current",
      reservation: {
        status: "SENT", resolved: true, roundId: "original", slotId: "slot",
        authorId: "me", date: "2026-08-20", scheduledAt: "2026-08-19T21:00:00.000Z",
      },
    }, "round-one")).toBe("original");
    expect(getSpaceLetterPresentationRoundId({
      id: "unresolved", authorId: "me", letterType: "CENTER", spaceRoundId: "current",
      reservation: {
        status: "FAILED", resolved: false, roundId: null, slotId: null,
        authorId: null, date: null, scheduledAt: "2026-08-19T21:00:00.000Z",
      },
    }, "round-one")).toBeNull();
    expect(getSpaceLetterPresentationRoundId({
      id: "legacy-opening", authorId: "operator", letterType: "OPENING",
    }, "round-one")).toBe("round-one");
  });

  it("requires a pending, resolved exact KST 06:00 reservation preview", () => {
    const slot = { id: "slot", spaceRoundId: "round", assignedUserId: "me", scheduledDate: "2026-08-20" };
    const letter = { id: "letter", spaceRoundId: "round", authorId: "me", letterType: "CENTER" };
    const metadata = (changes: Partial<SpaceReservationMetadataPresentation> = {}): SpaceReservationMetadataPresentation => ({
      status: "PENDING", resolved: true, slotId: "slot", roundId: "round", authorId: "me",
      date: "2026-08-20", scheduledAt: "2026-08-19T21:00:00.000Z", ...changes,
    });
    expect(resolveUpcomingRoundCenterCards([letter], [slot], "me", [
      { spaceLetterId: "letter", reservation: metadata() },
    ])[0].kind).toBe("letter");
    for (const badMetadata of [
      metadata({ date: "2026-08-21" }),
      metadata({ scheduledAt: "2026-08-19T21:01:00.000Z" }),
      metadata({ status: "CANCELLED" }),
      metadata({ status: "FAILED" }),
      metadata({ resolved: false, roundId: null }),
    ]) {
      expect(resolveUpcomingRoundCenterCards([letter], [slot], "me", [
        { spaceLetterId: "letter", reservation: badMetadata },
      ])[0].kind).toBe("slot");
    }
  });

  it("uses exact slot identity when two rounds have slots on the same date", () => {
    const slots = [
      { id: "round-one-slot", spaceRoundId: "round-one", assignedUserId: "me", scheduledDate: "2026-08-20" },
      { id: "round-two-slot", spaceRoundId: "round-two", assignedUserId: "me", scheduledDate: "2026-08-20" },
    ];
    const letters = [{ id: "round-two-letter", spaceRoundId: "round-two", authorId: "me", letterType: "CENTER" }];
    const result = resolveUpcomingRoundCenterCards(letters, slots, "me", [{
      spaceLetterId: "round-two-letter",
      reservation: {
        status: "PENDING", resolved: true, slotId: "round-two-slot", roundId: "round-two",
        authorId: "me", date: "2026-08-20", scheduledAt: "2026-08-19T21:00:00.000Z",
      },
    }]);
    expect(result.map((item) => item.kind)).toEqual(["slot", "letter"]);
  });

  it("uses the safe anonymous display name for every letter type", () => {
    expect(getSpaceLetterAuthorName("OPENING", true, "달빛", "실명")).toBe("달빛");
    expect(getSpaceLetterAuthorName("CENTER", true, "참여자", "실명")).toBe("참여자");
    expect(getSpaceLetterAuthorName("OPENING", true, null, "실명")).toBe("참여자");
    expect(getSpaceLetterAuthorName("OPENING", false, "참여자 1", "실명")).toBe("실명");
  });
});