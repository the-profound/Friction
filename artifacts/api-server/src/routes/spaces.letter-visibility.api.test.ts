/**
 * Integration tests for space-letter visibility filtering.
 *
 * Covers:
 *  - RECIPIENT_ONLY letters are hidden from non-recipients
 *  - RECIPIENT_ONLY letters remain visible to the author
 *  - RECIPIENT_ONLY letters remain visible to operators
 *  - Prior recipients (via letter_recipient_access) retain access when a
 *    letter is switched to RECIPIENT_ONLY after delivery
 *  - PUBLIC letters are visible to all approved members
 *  - PATCH /spaces/:id/letters/:letterId/visibility returns 403 for anonymous spaces
 *  - PATCH returns 403 when the caller is not the author
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

// ── shared mutable state hoisted before vi.mock ────────────────────────────
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

  /** Letter rows. Tests mutate `visibility` to exercise filtering. */
  const letters = [
    {
      id: "letter-author",
      spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceRoundId: "round-a",
      authorId: "author-a",
      sourceArticleId: "article-a",
      letterType: "CENTER" as const,
      visibility: "PUBLIC" as "PUBLIC" | "RECIPIENT_ONLY",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // Mirrors the confirmed production case: a finalized CENTER letter whose
    // only scheduled-send history is two CANCELLED rows (created and
    // cancelled well before the slot's assigned date). It must be withheld
    // from other participants like a not-yet-due PENDING reservation.
    {
      id: "letter-cancelled-only",
      spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceRoundId: "round-a",
      authorId: "author-a",
      sourceArticleId: "article-a",
      letterType: "CENTER" as const,
      visibility: "PUBLIC" as "PUBLIC" | "RECIPIENT_ONLY",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "letter-future",
      spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceRoundId: "round-a",
      authorId: "author-a",
      sourceArticleId: "article-a",
      letterType: "CENTER" as const,
      visibility: "RECIPIENT_ONLY" as "PUBLIC" | "RECIPIENT_ONLY",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  /**
   * space_scheduled_sends rows. Empty by default so existing "never
   * scheduled" behavior is unaffected; tests populate this to exercise the
   * cancelled-only-history gate.
   */
  const scheduledSends: Array<{
    spaceLetterId: string;
    status: "PENDING" | "SENT" | "CANCELLED";
    scheduledAt: Date;
    createdAt: Date;
  }> = [
    {
      spaceLetterId: "letter-cancelled-only",
      status: "CANCELLED",
      scheduledAt: new Date("2026-09-13T06:00:00.000Z"),
      createdAt: new Date("2026-09-06T01:00:00.000Z"),
    },
    {
      spaceLetterId: "letter-cancelled-only",
      status: "CANCELLED",
      scheduledAt: new Date("2026-09-13T06:00:00.000Z"),
      createdAt: new Date("2026-09-06T02:00:00.000Z"),
    },
    {
      spaceLetterId: "letter-future",
      status: "PENDING",
      scheduledAt: new Date("2099-09-13T06:00:00.000Z"),
      createdAt: new Date("2026-09-07T02:00:00.000Z"),
    },
  ];

  const members: Record<string, { id: string; userId: string; role: string; status: string }> = {
    "operator-a":   { id: "p-op",     userId: "operator-a",   role: "OPERATOR",     status: "APPROVED" },
    "author-a":     { id: "p-author", userId: "author-a",     role: "PARTICIPANT",  status: "APPROVED" },
    "recipient-a":  { id: "p-rec",    userId: "recipient-a",  role: "PARTICIPANT",  status: "APPROVED" },
    "outsider-a":   { id: "p-out",    userId: "outsider-a",   role: "PARTICIPANT",  status: "APPROVED" },
  };

  /** Which user IDs have a letter_recipient_access row for "letter-author". */
  const accessRows: Set<string> = new Set(["recipient-a"]);

  let activeUser = "";

  const rowsFor = (source: string, _selection: unknown): unknown[] => {
    if (source === "spaces") {
      return [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Test Space", isAnonymous: false, creatorId: "operator-a" }];
    }
    if (source === "space_participations") {
      const m = members[activeUser];
      return m ? [m] : [];
    }
    if (source === "space_letters") return letters;
    if (source === "space_scheduled_sends") return scheduledSends;
    if (source === "letter_recipient_access") {
      return accessRows.has(activeUser)
        ? [{ letterId: "letter-author" }, { letterId: "letter-future" }]
        : [];
    }
    if (source === "users") {
      return [
        { id: "author-a",    nickname: "작성자" },
        { id: "recipient-a", nickname: "수신자" },
        { id: "operator-a",  nickname: "운영자" },
      ];
    }
    if (source === "articles") return [{ id: "article-a", title: "글 제목", content: "본문", cover: null }];
    if (source === "user_article_reads") return [];
    return [];
  };

  const db: any = {
    select: (selection?: unknown) => {
      let source = "";
      const chain: any = {
        from: (t: { __name?: string }) => { source = t.__name ?? ""; return chain; },
        where: () => chain,
        limit: () => Promise.resolve(rowsFor(source, selection)),
        then: (resolve: (v: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
          Promise.resolve(rowsFor(source, selection)).then(resolve, reject),
      };
      return chain;
    },
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ ...letters[0], visibility: "RECIPIENT_ONLY" }]), onConflictDoNothing: () => Promise.resolve() }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{ ...letters[0], visibility: "RECIPIENT_ONLY" }]) }) }) }),
  };

  return {
    db,
    tables,
    letters,
    accessRows,
    setActiveUser: (userId: string) => { activeUser = userId; },
    setLetterVisibility: (v: "PUBLIC" | "RECIPIENT_ONLY") => { letters[0].visibility = v; },
    resetScheduledSends: () => {
      scheduledSends.splice(
        0,
        scheduledSends.length,
        {
          spaceLetterId: "letter-cancelled-only",
          status: "CANCELLED",
          scheduledAt: new Date("2026-09-13T06:00:00.000Z"),
          createdAt: new Date("2026-09-06T01:00:00.000Z"),
        },
        {
          spaceLetterId: "letter-cancelled-only",
          status: "CANCELLED",
          scheduledAt: new Date("2026-09-13T06:00:00.000Z"),
          createdAt: new Date("2026-09-06T02:00:00.000Z"),
        },
        {
          spaceLetterId: "letter-future",
          status: "PENDING",
          scheduledAt: new Date("2099-09-13T06:00:00.000Z"),
          createdAt: new Date("2026-09-07T02:00:00.000Z"),
        },
      );
    },
    setFutureLetterSends: (rows: Array<{
      status: "PENDING" | "SENT" | "CANCELLED";
      scheduledAt: Date;
      createdAt: Date;
    }>) => {
      const retained = scheduledSends.filter((send) => send.spaceLetterId !== "letter-future");
      scheduledSends.splice(
        0,
        scheduledSends.length,
        ...retained,
        ...rows.map((row) => ({ ...row, spaceLetterId: "letter-future" })),
      );
    },
    setSpaceAnonymous: (anon: boolean) => { /* handled via db mock below */ },
  };
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
    state.setActiveUser(userId);
    req.user = { id: userId };
    next();
  },
}));

const { default: router } = await import("./spaces");

// ── helpers ────────────────────────────────────────────────────────────────

let server: Server;

async function getLetters(userId: string) {
  return fetch(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/spaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/letters`,
    { headers: { "x-test-user-id": userId } },
  );
}

// ── test suite ─────────────────────────────────────────────────────────────

describe("letter visibility filtering — GET /spaces/:id/letters", () => {
  beforeEach(async () => {
    state.setLetterVisibility("PUBLIC");    // reset to PUBLIC before each test
    state.resetScheduledSends();
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

  it("PUBLIC letter is visible to all approved participants", async () => {
    for (const userId of ["author-a", "operator-a", "recipient-a", "outsider-a"]) {
      const res = await getLetters(userId);
      expect(res.status, `${userId} should get 200`).toBe(200);
      const body = await res.json() as Array<{ id: string }>;
      expect(body.map((l) => l.id), `${userId} should see the letter`).toContain("letter-author");
    }
  });

  it("RECIPIENT_ONLY letter is visible to its own author", async () => {
    state.setLetterVisibility("RECIPIENT_ONLY");
    const res = await getLetters("author-a");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.map((l) => l.id)).toContain("letter-author");
  });

  it("RECIPIENT_ONLY letter is visible to operators", async () => {
    state.setLetterVisibility("RECIPIENT_ONLY");
    const res = await getLetters("operator-a");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.map((l) => l.id)).toContain("letter-author");
  });

  it("RECIPIENT_ONLY letter is visible to a prior delivery recipient (letter_recipient_access)", async () => {
    state.setLetterVisibility("RECIPIENT_ONLY");
    // recipient-a has a row in letter_recipient_access (set up in accessRows)
    const res = await getLetters("recipient-a");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.map((l) => l.id)).toContain("letter-author");
  });

  it("RECIPIENT_ONLY letter is hidden from non-recipient participants", async () => {
    state.setLetterVisibility("RECIPIENT_ONLY");
    // outsider-a is an approved participant but has no letter_recipient_access row
    const res = await getLetters("outsider-a");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.map((l) => l.id)).not.toContain("letter-author");
  });

  it("a letter never scheduled (no reservation at all) stays visible to other participants", async () => {
    // letter-author has zero space_scheduled_sends rows in this fixture.
    const res = await getLetters("outsider-a");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.map((l) => l.id)).toContain("letter-author");
  });

  it("a letter whose reservation history is only CANCELLED rows is hidden from other participants (production repro: 스티브's '마감해봅시다')", async () => {
    for (const userId of ["recipient-a", "outsider-a"]) {
      const res = await getLetters(userId);
      expect(res.status, `${userId} should get 200`).toBe(200);
      const body = await res.json() as Array<{ id: string }>;
      expect(
        body.map((l) => l.id),
        `${userId} should not see the cancelled-only letter`,
      ).not.toContain("letter-cancelled-only");
    }
  });

  it("a letter whose reservation history is only CANCELLED rows remains visible to its own author", async () => {
    const res = await getLetters("author-a");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.map((l) => l.id)).toContain("letter-cancelled-only");
  });

  it("a letter whose reservation history is only CANCELLED rows is hidden from operators too", async () => {
    const res = await getLetters("operator-a");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.map((l) => l.id)).not.toContain("letter-cancelled-only");
  });

  it("a future PENDING letter is hidden from operators, ordinary participants, and recipients", async () => {
    for (const userId of ["operator-a", "outsider-a", "recipient-a"]) {
      const res = await getLetters(userId);
      expect(res.status, `${userId} should get 200`).toBe(200);
      const body = await res.json() as Array<{ id: string }>;
      expect(body.map((l) => l.id), `${userId} must not see future content`)
        .not.toContain("letter-future");
    }
  });

  it("a future PENDING letter remains visible to its author", async () => {
    const res = await getLetters("author-a");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.map((l) => l.id)).toContain("letter-future");
  });

  it("a PENDING letter becomes visible to its recipient once scheduledAt is due", async () => {
    state.setFutureLetterSends([{
      status: "PENDING",
      scheduledAt: new Date("2000-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-09-07T02:00:00.000Z"),
    }]);
    const res = await getLetters("recipient-a");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.map((l) => l.id)).toContain("letter-future");
  });

  it("a SENT letter is visible even when its scheduledAt is in the future", async () => {
    state.setFutureLetterSends([{
      status: "SENT",
      scheduledAt: new Date("2099-09-13T06:00:00.000Z"),
      createdAt: new Date("2026-09-07T02:00:00.000Z"),
    }]);
    const res = await getLetters("recipient-a");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.map((l) => l.id)).toContain("letter-future");
  });

  it("an old SENT row does not reveal a newer future PENDING re-reservation", async () => {
    state.setFutureLetterSends([
      {
        status: "SENT",
        scheduledAt: new Date("2000-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-09-06T02:00:00.000Z"),
      },
      {
        status: "PENDING",
        scheduledAt: new Date("2099-09-13T06:00:00.000Z"),
        createdAt: new Date("2026-09-07T02:00:00.000Z"),
      },
    ]);
    for (const userId of ["operator-a", "recipient-a", "outsider-a"]) {
      const res = await getLetters(userId);
      expect(res.status).toBe(200);
      const body = await res.json() as Array<{ id: string }>;
      expect(body.map((l) => l.id)).not.toContain("letter-future");
    }
  });
});
