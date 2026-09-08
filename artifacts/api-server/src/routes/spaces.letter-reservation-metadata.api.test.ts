/**
 * Integration tests for GET /spaces/:id/letters reservation metadata.
 *
 * Covers (Task #2014 — space-card recent letters must reflect actual send state):
 *  - A letter with no reservation history at all → reservation: null, everScheduled: false
 *  - A letter whose only reservation was CANCELLED → reservation: null, everScheduled: true
 *    (distinct from the true-legacy case above, even though `reservation` is null in both)
 *  - A SENT letter → reservation.status === "SENT" and reservation.sentAt reflects the
 *    actual dispatch timestamp, separate from the originally planned scheduledAt
 *  - A PENDING letter → reservation.status === "PENDING"
 *
 * Task #2051 — a letter reported to still show its cover on the space list
 * after "schedule → cancel" must stay reservation:null/everScheduled:true even
 * when its reservation history has multiple rows (repeated
 * schedule→cancel→reschedule→cancel cycles on the same letter), not just a
 * single cancelled row.
 *
 * Task #2111 — a cancelled-only CENTER letter must not resurface as an
 * untouched, "due now" slot in the space-round carousel. The `reservation`
 * field stays null on cancel (unchanged, covered above), but `lastReservation`
 * preserves the exact round/slot/date a now-cancelled reservation named, so
 * client presentation code can tell "wrote it, then withheld it" apart from
 * "never touched this slot" — repro'd with the real production timeline
 * (finalized CENTER letter, two cancellations for the exact same slot, real
 * slot deadline still days away).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

const state = vi.hoisted(() => {
  const table = (name: string) =>
    new Proxy({ __name: name }, {
      get(target: { __name: string }, property: string | symbol) {
        if (property === "__name") return target.__name;
        return { name: `${name}.${String(property)}` };
      },
    });

  const tables = {
    spaces:              table("spaces"),
    participations:      table("space_participations"),
    letters:             table("space_letters"),
    scheduledSends:      table("space_scheduled_sends"),
    recipientAccess:     table("letter_recipient_access"),
    users:               table("users"),
    articles:            table("articles"),
    reads:               table("user_article_reads"),
    rounds:              table("space_rounds"),
    slots:               table("space_round_slots"),
    invitations:         table("space_invitations"),
    codeRequests:        table("space_code_requests"),
  };

  const spaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  const letters = [
    { id: "letter-no-history", spaceId, spaceRoundId: null, authorId: "author-a", sourceArticleId: "article-no-history", letterType: "CENTER" as const, visibility: "PUBLIC" as const, createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z") },
    { id: "letter-cancelled-only", spaceId, spaceRoundId: null, authorId: "author-a", sourceArticleId: "article-cancelled-only", letterType: "CENTER" as const, visibility: "PUBLIC" as const, createdAt: new Date("2026-01-02T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z") },
    { id: "letter-sent", spaceId, spaceRoundId: null, authorId: "author-a", sourceArticleId: "article-sent", letterType: "CENTER" as const, visibility: "PUBLIC" as const, createdAt: new Date("2026-01-03T00:00:00.000Z"), updatedAt: new Date("2026-01-03T00:00:00.000Z") },
    { id: "letter-pending", spaceId, spaceRoundId: null, authorId: "author-a", sourceArticleId: "article-pending", letterType: "CENTER" as const, visibility: "PUBLIC" as const, createdAt: new Date("2026-01-04T00:00:00.000Z"), updatedAt: new Date("2026-01-04T00:00:00.000Z") },
    { id: "letter-cancelled-multi", spaceId, spaceRoundId: null, authorId: "author-a", sourceArticleId: "article-cancelled-multi", letterType: "CENTER" as const, visibility: "PUBLIC" as const, createdAt: new Date("2026-01-05T00:00:00.000Z"), updatedAt: new Date("2026-01-05T00:00:00.000Z") },
    // Real-world repro (space 6a8ec70d-edf1-4cb8-837f-dd930cf8a080, round
    // abf851d4-9e16-4a11-b253-182a6612258e, letter 0f7c10bd-fb1b-42b9-aaf5-246311a970b8):
    // a fully written CENTER letter with two CANCELLED sends both naming the
    // exact same slot/round/date, and that slot's deadline is still days away.
    { id: "letter-withdrawn-same-slot", spaceId, spaceRoundId: null, authorId: "author-a", sourceArticleId: "article-withdrawn-same-slot", letterType: "CENTER" as const, visibility: "PUBLIC" as const, createdAt: new Date("2026-09-06T00:00:00.000Z"), updatedAt: new Date("2026-09-06T00:00:00.000Z") },
  ];

  const scheduledSends = [
    {
      spaceLetterId: "letter-cancelled-only",
      status: "CANCELLED" as const,
      createdAt: new Date("2026-01-02T01:00:00.000Z"),
      scheduledAt: new Date("2026-01-09T06:00:00.000Z"),
      sentAt: null,
      reservedRoundId: "round-a",
      reservedDate: "2026-01-09",
      slotId: "slot-a",
      reservationAuthorId: "author-a",
    },
    {
      spaceLetterId: "letter-sent",
      status: "SENT" as const,
      createdAt: new Date("2026-01-03T01:00:00.000Z"),
      scheduledAt: new Date("2026-01-10T06:00:00.000Z"),
      sentAt: new Date("2026-01-10T06:03:12.000Z"), // actual dispatch lagged the plan
      reservedRoundId: "round-a",
      reservedDate: "2026-01-10",
      slotId: "slot-b",
      reservationAuthorId: "author-a",
    },
    {
      spaceLetterId: "letter-pending",
      status: "PENDING" as const,
      createdAt: new Date("2026-01-04T01:00:00.000Z"),
      scheduledAt: new Date("2026-02-01T06:00:00.000Z"),
      sentAt: null,
      reservedRoundId: "round-a",
      reservedDate: "2026-02-01",
      slotId: "slot-c",
      reservationAuthorId: "author-a",
    },
    // Repro for Task #2051: the same letter scheduled and cancelled twice
    // (schedule → cancel → reschedule → cancel again). Both rows are
    // CANCELLED; the second (later createdAt) must not resurrect the letter
    // as if it had an active reservation.
    {
      spaceLetterId: "letter-cancelled-multi",
      status: "CANCELLED" as const,
      createdAt: new Date("2026-01-05T01:00:00.000Z"),
      scheduledAt: new Date("2026-01-09T06:00:00.000Z"),
      sentAt: null,
      reservedRoundId: "round-a",
      reservedDate: "2026-01-09",
      slotId: "slot-d",
      reservationAuthorId: "author-a",
    },
    {
      spaceLetterId: "letter-cancelled-multi",
      status: "CANCELLED" as const,
      createdAt: new Date("2026-01-05T02:00:00.000Z"),
      scheduledAt: new Date("2026-01-12T06:00:00.000Z"),
      sentAt: null,
      reservedRoundId: "round-a",
      reservedDate: "2026-01-12",
      slotId: "slot-e",
      reservationAuthorId: "author-a",
    },
    // Real-world repro: created and cancelled once, then reserved and
    // cancelled again for the *exact same* slot/round/date (slot deadline
    // 2026-09-13, "today" 2026-09-08 — five days out).
    {
      spaceLetterId: "letter-withdrawn-same-slot",
      status: "CANCELLED" as const,
      createdAt: new Date("2026-09-06T10:00:00.000Z"),
      scheduledAt: new Date("2026-09-12T21:00:00.000Z"),
      sentAt: null,
      reservedRoundId: "round-real-repro",
      reservedDate: "2026-09-13",
      slotId: "slot-real-repro",
      reservationAuthorId: "author-a",
    },
    {
      spaceLetterId: "letter-withdrawn-same-slot",
      status: "CANCELLED" as const,
      createdAt: new Date("2026-09-06T11:00:00.000Z"),
      scheduledAt: new Date("2026-09-12T21:00:00.000Z"),
      sentAt: null,
      reservedRoundId: "round-real-repro",
      reservedDate: "2026-09-13",
      slotId: "slot-real-repro",
      reservationAuthorId: "author-a",
    },
  ];

  const rowsFor = (source: string): unknown[] => {
    if (source === "spaces") return [{ id: spaceId, name: "Test Space", isAnonymous: false, creatorId: "author-a" }];
    if (source === "space_participations") return [{ id: "p-author", userId: "author-a", role: "PARTICIPANT", status: "APPROVED" }];
    if (source === "space_letters") return letters;
    if (source === "space_scheduled_sends") return scheduledSends;
    if (source === "letter_recipient_access") return [];
    if (source === "users") return [{ id: "author-a", nickname: "작성자" }];
    if (source === "articles") {
      return letters.map((l) => ({ id: l.sourceArticleId, title: `${l.id}-title`, content: "본문", cover: null }));
    }
    if (source === "user_article_reads") return [];
    return [];
  };

  const db: any = {
    select: () => {
      let source = "";
      const chain: any = {
        from: (t: { __name?: string }) => { source = t.__name ?? ""; return chain; },
        where: () => chain,
        limit: () => Promise.resolve(rowsFor(source)),
        then: (resolve: (v: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
          Promise.resolve(rowsFor(source)).then(resolve, reject),
      };
      return chain;
    },
  };

  return { db, tables, spaceId };
});

vi.mock("@workspace/db", () => ({
  db:                               state.db,
  spacesTable:                      state.tables.spaces,
  spaceParticipationsTable:         state.tables.participations,
  spaceLettersTable:                state.tables.letters,
  spaceScheduledSendsTable:         state.tables.scheduledSends,
  letterRecipientAccessTable:       state.tables.recipientAccess,
  usersTable:                       state.tables.users,
  articlesTable:                    state.tables.articles,
  userArticleReadsTable:            state.tables.reads,
  spaceRoundsTable:                 state.tables.rounds,
  spaceRoundSlotsTable:             state.tables.slots,
  spaceInvitationsTable:            state.tables.invitations,
  spaceCodeRequestsTable:           state.tables.codeRequests,
}));

vi.mock("../lib/scheduledSendProcessor", () => ({
  processDueScheduledSends: vi.fn(async () => ({ sentCount: 0, failedCount: 0 })),
}));

vi.mock("../lib/anonymousSpaceIdentity", () => ({
  ANONYMOUS_PARTICIPANT_NAME: "참여자",
  getAnonymousDisplayName: vi.fn(() => "참여자"),
  parseAnonymousSpaceNickname: vi.fn(),
}));

vi.mock("../lib/spaceCreationResponse", () => ({
  redactSpaceCreationKeys: (body: unknown) => body,
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (
    req: { header: (n: string) => string | undefined; user?: { id: string } },
    res: { status: (s: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    const userId = req.header("x-test-user-id");
    if (!userId) { res.status(401).json({ error: "Unauthenticated" }); return; }
    req.user = { id: userId };
    next();
  },
}));

const { default: router } = await import("./spaces");

let server: Server;

async function getLetters() {
  const res = await fetch(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/spaces/${state.spaceId}/letters`,
    { headers: { "x-test-user-id": "author-a" } },
  );
  return res.json() as Promise<
    Array<{
      id: string;
      everScheduled?: boolean;
      reservation: { status: string; scheduledAt: string; sentAt: string | null } | null;
      lastReservation: {
        status: string;
        scheduledAt: string;
        sentAt: string | null;
        roundId: string | null;
        slotId: string | null;
        date: string | null;
        authorId: string | null;
        resolved: boolean;
      } | null;
    }>
  >;
}

describe("GET /spaces/:id/letters reservation metadata", () => {
  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use(router);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("a letter with no reservation history at all reports reservation:null and everScheduled:false", async () => {
    const body = await getLetters();
    const letter = body.find((l) => l.id === "letter-no-history")!;
    expect(letter.reservation).toBeNull();
    expect(letter.everScheduled).toBe(false);
    expect(letter.lastReservation).toBeNull();
  });

  it("a letter whose only reservation was CANCELLED reports reservation:null but everScheduled:true (distinct from true legacy)", async () => {
    const body = await getLetters();
    const letter = body.find((l) => l.id === "letter-cancelled-only")!;
    expect(letter.reservation).toBeNull();
    expect(letter.everScheduled).toBe(true);
    // lastReservation still names the exact slot/round/date it was withdrawn from.
    expect(letter.lastReservation?.status).toBe("CANCELLED");
    expect(letter.lastReservation?.roundId).toBe("round-a");
    expect(letter.lastReservation?.slotId).toBe("slot-a");
    expect(letter.lastReservation?.date).toBe("2026-01-09");
    expect(letter.lastReservation?.resolved).toBe(true);
  });

  it("a SENT letter reports status SENT with the actual dispatch sentAt, separate from the originally planned scheduledAt", async () => {
    const body = await getLetters();
    const letter = body.find((l) => l.id === "letter-sent")!;
    expect(letter.everScheduled).toBe(true);
    expect(letter.reservation?.status).toBe("SENT");
    expect(letter.reservation?.scheduledAt).toBe("2026-01-10T06:00:00.000Z");
    expect(letter.reservation?.sentAt).toBe("2026-01-10T06:03:12.000Z");
  });

  it("a PENDING letter reports status PENDING", async () => {
    const body = await getLetters();
    const letter = body.find((l) => l.id === "letter-pending")!;
    expect(letter.everScheduled).toBe(true);
    expect(letter.reservation?.status).toBe("PENDING");
  });

  it("a letter scheduled and cancelled twice (schedule→cancel→reschedule→cancel) stays reservation:null/everScheduled:true", async () => {
    const body = await getLetters();
    const letter = body.find((l) => l.id === "letter-cancelled-multi")!;
    expect(letter.reservation).toBeNull();
    expect(letter.everScheduled).toBe(true);
    // lastReservation reflects the most recently created cancellation (slot-e / 2026-01-12),
    // not the first one (slot-d / 2026-01-09).
    expect(letter.lastReservation?.slotId).toBe("slot-e");
    expect(letter.lastReservation?.date).toBe("2026-01-12");
  });

  it("real-world repro: a finalized letter with two cancellations for the exact same slot, deadline still days away, reports reservation:null/everScheduled:true and a lastReservation naming that exact slot", async () => {
    const body = await getLetters();
    const letter = body.find((l) => l.id === "letter-withdrawn-same-slot")!;
    expect(letter.reservation).toBeNull();
    expect(letter.everScheduled).toBe(true);
    expect(letter.lastReservation?.status).toBe("CANCELLED");
    expect(letter.lastReservation?.roundId).toBe("round-real-repro");
    expect(letter.lastReservation?.slotId).toBe("slot-real-repro");
    expect(letter.lastReservation?.date).toBe("2026-09-13");
    expect(letter.lastReservation?.authorId).toBe("author-a");
    expect(letter.lastReservation?.resolved).toBe(true);
  });
});
