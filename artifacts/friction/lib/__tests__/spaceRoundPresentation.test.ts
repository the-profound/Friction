import { describe, expect, it } from "vitest";
import {
  doesSpaceLetterOccupyRoundSlot,
  findWithdrawnCenterLetterForSlot,
  getSpaceRoundSlotAvailabilityLabel,
  getSpaceLetterAuthorName,
  getSpaceLetterPresentationRoundId,
  type SpaceReservationMetadataPresentation,
  getSpaceRoundPresentationStatus,
  isKstSlotReservable,
  isOpeningSlotReservable,
  isPendingSpaceDetailLetter,
  isReadableSpaceDetailLetter,
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

  it("classifies a slot as expired exactly at its KST deadline for catch-up entry", () => {
    const immediatelyBefore = new Date("2026-08-19T20:59:59.999Z");
    const atDeadline = new Date("2026-08-19T21:00:00.000Z");

    expect(isKstSlotReservable("2026-08-20", immediatelyBefore)).toBe(true);
    expect(isKstSlotReservable("2026-08-20", atDeadline)).toBe(false);
    expect(isKstSlotReservable(null, atDeadline)).toBe(false);
  });

  it("shows pending center letters only as non-readable scheduled states in their own upcoming slots", () => {
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
    expect(result.map((item) => item.kind)).toEqual(["slot", "scheduled", "scheduled"]);
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

  it("requires a pending, resolved exact slot identity reservation preview", () => {
    const slot = { id: "slot", spaceRoundId: "round", assignedUserId: "me", scheduledDate: "2026-08-20" };
    const letter = { id: "letter", spaceRoundId: "round", authorId: "me", letterType: "CENTER" };
    const metadata = (changes: Partial<SpaceReservationMetadataPresentation> = {}): SpaceReservationMetadataPresentation => ({
      status: "PENDING", resolved: true, slotId: "slot", roundId: "round", authorId: "me",
      date: "2026-08-20", scheduledAt: "2026-08-19T21:00:00.000Z", ...changes,
    });
    expect(resolveUpcomingRoundCenterCards([letter], [slot], "me", [
      { spaceLetterId: "letter", reservation: metadata() },
    ])[0].kind).toBe("scheduled");
    for (const badMetadata of [
      metadata({ date: "2026-08-21" }),
      metadata({ status: "CANCELLED" }),
      metadata({ status: "FAILED" }),
      metadata({ resolved: false, roundId: null }),
    ]) {
      expect(resolveUpcomingRoundCenterCards([letter], [slot], "me", [
        { spaceLetterId: "letter", reservation: badMetadata },
      ])[0].kind).toBe("slot");
    }
    expect(resolveUpcomingRoundCenterCards([letter], [slot], "me", [
      {
        spaceLetterId: "letter",
        reservation: metadata({ scheduledAt: "2026-08-20T21:00:00.000Z" }),
      },
    ])[0].kind).toBe("scheduled");
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
    expect(result.map((item) => item.kind)).toEqual(["slot", "scheduled"]);
  });

  it("makes only SENT reservations and true unscheduled legacy letters readable", () => {
    const base = {
      id: "letter",
      spaceRoundId: "round",
      authorId: "me",
      letterType: "OPENING",
    };
    expect(isReadableSpaceDetailLetter(base)).toBe(true);
    expect(isReadableSpaceDetailLetter({ ...base, everScheduled: false, reservation: null })).toBe(true);
    expect(isReadableSpaceDetailLetter({
      ...base,
      everScheduled: true,
      reservation: {
        status: "SENT", resolved: true, slotId: "slot", roundId: "round",
        authorId: "me", date: "2026-08-20", scheduledAt: "2026-08-19T21:00:00.000Z",
      },
    })).toBe(true);
    for (const status of ["PENDING", "CANCELLED", "FAILED"]) {
      expect(isReadableSpaceDetailLetter({
        ...base,
        everScheduled: true,
        reservation: {
          status, resolved: true, slotId: "slot", roundId: "round",
          authorId: "me", date: "2026-08-20", scheduledAt: "2000-01-01T00:00:00.000Z",
        },
      })).toBe(false);
    }
    expect(isReadableSpaceDetailLetter({ ...base, everScheduled: true, reservation: null })).toBe(false);
  });

  it("excludes every unsent own letter status from aggregate detail counts", () => {
    const reservation = {
      status: "PENDING",
      resolved: true,
      slotId: "slot",
      roundId: "round",
      authorId: "me",
      date: "2026-08-20",
      scheduledAt: "2000-01-01T00:00:00.000Z",
    };
    const letters = [
      { id: "legacy", spaceRoundId: "round", authorId: "me", letterType: "OPENING" },
      {
        id: "sent", spaceRoundId: "round", authorId: "me", letterType: "CENTER",
        everScheduled: true, reservation: { ...reservation, status: "SENT" },
      },
      ...(["PENDING", "FAILED"] as const).map((status) => ({
        id: status.toLowerCase(), spaceRoundId: "round", authorId: "me",
        letterType: "CENTER", everScheduled: true,
        reservation: { ...reservation, status },
      })),
      {
        id: "cancelled", spaceRoundId: "round", authorId: "me",
        letterType: "CENTER", everScheduled: true, reservation: null,
      },
    ];

    expect(letters.filter(isReadableSpaceDetailLetter).map((letter) => letter.id))
      .toEqual(["legacy", "sent"]);
  });

  it("uses the non-interactive scheduled presentation only for current PENDING letters", () => {
    const base = {
      id: "opening",
      spaceRoundId: "round",
      authorId: "operator",
      letterType: "OPENING",
      everScheduled: true,
    };
    const reservation = {
      status: "PENDING",
      resolved: true,
      slotId: null,
      roundId: "round",
      authorId: "operator",
      date: "2026-08-20",
      scheduledAt: "2026-08-19T21:00:00.000Z",
    };
    expect(isPendingSpaceDetailLetter({ ...base, reservation })).toBe(true);
    expect(isPendingSpaceDetailLetter({
      ...base,
      reservation: { ...reservation, status: "FAILED" },
    })).toBe(false);
    expect(isPendingSpaceDetailLetter({
      ...base,
      reservation: { ...reservation, status: "CANCELLED" },
    })).toBe(false);
    expect(isPendingSpaceDetailLetter({ ...base, reservation: null })).toBe(false);
  });

  it("does not claim another participant wrote nothing when a past slot has no public letter", () => {
    expect(getSpaceRoundSlotAvailabilityLabel({
      isMySlot: false,
      isPastEmptySlot: true,
      isWithdrawn: false,
      isScheduled: false,
    })).toBe("아직 공개된 글 없음");
    expect(getSpaceRoundSlotAvailabilityLabel({
      isMySlot: true,
      isPastEmptySlot: true,
      isWithdrawn: false,
      isScheduled: false,
    })).toBe("글 없음");
    expect(getSpaceRoundSlotAvailabilityLabel({
      isMySlot: true,
      isPastEmptySlot: true,
      isWithdrawn: false,
      isScheduled: true,
    })).toBe("발신 예정");
  });

  it("replaces an upcoming scheduled slot with a readable card only after SENT", () => {
    const slot = {
      id: "slot",
      spaceRoundId: "round",
      assignedUserId: "me",
      scheduledDate: "2026-08-20",
    };
    const reservation = {
      status: "SENT",
      resolved: true,
      slotId: "slot",
      roundId: "round",
      authorId: "me",
      date: "2026-08-20",
      scheduledAt: "2026-08-19T21:00:00.000Z",
    };
    const letter = {
      id: "letter",
      spaceRoundId: "round",
      authorId: "me",
      letterType: "CENTER",
      reservation,
      everScheduled: true,
    };
    const result = resolveUpcomingRoundCenterCards([letter], [slot], "me", []);
    expect(result).toEqual([{ kind: "letter", letter, slotId: "slot" }]);
  });

  describe("withdrawn (cancelled-with-a-draft) CENTER slots", () => {
    // Real production repro (space 6a8ec70d-edf1-4cb8-837f-dd930cf8a080, round
    // abf851d4-9e16-4a11-b253-182a6612258e): 스티브's CENTER letter for slot
    // 2930ddf7-8e00-4a73-8ff8-5ab0c73fca18 (scheduledDate 2026-09-13) was fully
    // written, then had its only reservation created and cancelled twice — the
    // slot's deadline is still days away. The API's `reservation` is (correctly,
    // by design) null, but `everScheduled`/`lastReservation` still name the
    // exact slot it was withdrawn from.
    const authorId = "8a425f58-f036-49f8-a911-322035730c05";
    const roundId = "abf851d4-9e16-4a11-b253-182a6612258e";
    const slotId = "2930ddf7-8e00-4a73-8ff8-5ab0c73fca18";
    const scheduledDate = "2026-09-13";
    const slot = {
      id: slotId,
      spaceRoundId: roundId,
      assignedUserId: authorId,
      scheduledDate,
    };
    const withdrawnLastReservation: SpaceReservationMetadataPresentation = {
      status: "CANCELLED",
      resolved: true,
      roundId,
      slotId,
      authorId,
      date: scheduledDate,
      scheduledAt: "2026-09-12T21:00:00.000Z", // KST 06:00 on 2026-09-13
    };
    const withdrawnLetter = {
      id: "0f7c10bd-fb1b-42b9-aaf5-246311a970b8",
      // Real CENTER letters are always created with the round they were
      // written for (required to be reservable at all), and cancellation
      // never clears it — so this must match `roundId`, not be null.
      spaceRoundId: roundId,
      authorId,
      letterType: "CENTER",
      reservation: null,
      everScheduled: true,
      lastReservation: withdrawnLastReservation,
    };
    const now = new Date("2026-09-08T00:00:00.000Z"); // "today" — five days before the deadline

    it("finds the withdrawn letter for its exact slot, days before the real deadline", () => {
      expect(findWithdrawnCenterLetterForSlot([withdrawnLetter], slot)).toBe(withdrawnLetter);
      // Confirms this is genuinely reachable well ahead of the slot's deadline, not just "not past".
      expect(isKstSlotReservable(scheduledDate, now)).toBe(true);
    });

    it("does not confuse a withdrawn letter with a true legacy (never-touched) letter", () => {
      const trueLegacyLetter = {
        ...withdrawnLetter,
        id: "legacy",
        everScheduled: false,
        lastReservation: null,
      };
      expect(findWithdrawnCenterLetterForSlot([trueLegacyLetter], slot)).toBeNull();
    });

    it("does not match a letter with a live (non-null) reservation as withdrawn", () => {
      const pendingLetter = {
        ...withdrawnLetter,
        id: "pending",
        reservation: { ...withdrawnLastReservation, status: "PENDING" },
      };
      expect(findWithdrawnCenterLetterForSlot([pendingLetter], slot)).toBeNull();
    });

    it("does not match a withdrawn letter to a different author's slot or a different slot", () => {
      const otherSlot = { ...slot, id: "other-slot", assignedUserId: "someone-else" };
      expect(findWithdrawnCenterLetterForSlot([withdrawnLetter], otherSlot)).toBeNull();

      const differentDateSlot = { ...slot, scheduledDate: "2026-09-20" };
      expect(findWithdrawnCenterLetterForSlot([withdrawnLetter], differentDateSlot)).toBeNull();
    });

    it("excludes the withdrawn letter from normal round grouping despite its real spaceRoundId", () => {
      // Even though this letter carries the same `spaceRoundId` any real CENTER
      // letter would, it must not fall back to that field the way a true-legacy
      // (never-scheduled) letter does — otherwise it renders as a normal,
      // already-sent round letter, which is the exact stale state being fixed.
      expect(getSpaceLetterPresentationRoundId(withdrawnLetter, "unrelated-first-round")).toBeNull();
    });

    it("end-to-end: the ACTIVE-round pipeline shows the slot as withdrawn, not as a normal letter or an empty 'write now' slot", () => {
      // Mirrors exactly what of-space-detail.tsx's RoundSection does: letters
      // are grouped into `lettersByRound` by `getSpaceLetterPresentationRoundId`,
      // then `emptyRoundSlots` is derived by filtering out slots any grouped
      // letter occupies, then any still-empty slot is decorated via
      // `findWithdrawnCenterLetterForSlot`.
      const otherAuthorId = "other-participant";
      const otherLetter = {
        id: "other-letter",
        spaceRoundId: roundId,
        authorId: otherAuthorId,
        letterType: "CENTER",
        reservation: {
          status: "SENT",
          resolved: true,
          roundId,
          slotId: "other-slot",
          authorId: otherAuthorId,
          date: scheduledDate,
          scheduledAt: withdrawnLastReservation.scheduledAt,
        },
        everScheduled: true,
        lastReservation: null,
      };
      const allLetters = [withdrawnLetter, otherLetter];
      const allSlots = [
        slot,
        { id: "other-slot", spaceRoundId: roundId, assignedUserId: otherAuthorId, scheduledDate },
      ];

      const lettersByRound: Record<string, typeof allLetters> = {};
      for (const letter of allLetters) {
        const key = getSpaceLetterPresentationRoundId(letter, null) ?? "__none__";
        (lettersByRound[key] ??= []).push(letter);
      }
      const roundLetters = lettersByRound[roundId] ?? [];

      // The withdrawn letter must never appear as a normal round letter/count —
      // only the other participant's genuinely sent letter does.
      expect(roundLetters).toEqual([otherLetter]);

      const emptyRoundSlots = allSlots.filter(
        (s) => !roundLetters.some((letter) => doesSpaceLetterOccupyRoundSlot(letter, s)),
      );
      // The withdrawn author's slot must remain empty (not hidden by the
      // legacy spaceRoundId fallback) so it can render the withdrawn card;
      // the other participant's slot is correctly occupied and excluded.
      expect(emptyRoundSlots.map((s) => s.id)).toEqual([slotId]);

      const withdrawnCenterLetters = allLetters.filter(
        (letter) =>
          letter.letterType === "CENTER" && letter.reservation == null && letter.everScheduled,
      );
      const decoratedSlot = findWithdrawnCenterLetterForSlot(withdrawnCenterLetters, emptyRoundSlots[0]);
      expect(decoratedSlot).toBe(withdrawnLetter);
    });
  });

  it("uses the safe anonymous display name for every letter type", () => {
    expect(getSpaceLetterAuthorName("OPENING", true, "달빛", "실명")).toBe("달빛");
    expect(getSpaceLetterAuthorName("CENTER", true, "참여자", "실명")).toBe("참여자");
    expect(getSpaceLetterAuthorName("OPENING", true, null, "실명")).toBe("참여자");
    expect(getSpaceLetterAuthorName("OPENING", false, "참여자 1", "실명")).toBe("실명");
  });
});