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
    Array<{ id: string; everScheduled?: boolean; reservation: { status: string; scheduledAt: string; sentAt: string | null } | null }>
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
  });

  it("a letter whose only reservation was CANCELLED reports reservation:null but everScheduled:true (distinct from true legacy)", async () => {
    const body = await getLetters();
    const letter = body.find((l) => l.id === "letter-cancelled-only")!;
    expect(letter.reservation).toBeNull();
    expect(letter.everScheduled).toBe(true);
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
});
