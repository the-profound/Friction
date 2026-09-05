import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

const state = vi.hoisted(() => {
  const table = (name: string) =>
    new Proxy({ __name: name }, {
      get(target, property) {
        if (property === "__name") return target.__name;
        return { name: `${name}.${String(property)}` };
      },
    });

  const tables = {
    spaces: table("spaces"),
    rounds: table("space_rounds"),
    slots: table("space_round_slots"),
    participations: table("space_participations"),
    codeRequests: table("space_code_requests"),
    letters: table("space_letters"),
    scheduled: table("space_scheduled_sends"),
    users: table("users"),
    articles: table("articles"),
    reads: table("user_article_reads"),
    invitations: table("space_invitations"),
  };

  const space = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "예약 공간",
    isAnonymous: false,
    roundCount: 1,
  };
  const letters = [
    {
      id: "letter-operator",
      spaceId: space.id,
      spaceRoundId: "round-a",
      authorId: "operator-a",
      sourceArticleId: "article-operator",
      letterType: "OPENING",
    },
    {
      id: "letter-participant",
      spaceId: space.id,
      spaceRoundId: "round-a",
      authorId: "participant-a",
      sourceArticleId: "article-participant",
      letterType: "CENTER",
    },
  ];
  const scheduled = [
    {
      id: "send-operator",
      spaceId: space.id,
      spaceLetterId: "letter-operator",
      slotId: null,
      scheduledAt: new Date("2026-08-30T06:00:00.000Z"),
      status: "PENDING",
      sentAt: null,
      failureReason: null,
      createdAt: new Date("2026-08-29T00:00:00.000Z"),
      updatedAt: new Date("2026-08-29T00:00:00.000Z"),
    },
    {
      id: "send-participant",
      spaceId: space.id,
      spaceLetterId: "letter-participant",
      slotId: "slot-a",
      scheduledAt: new Date("2026-09-06T06:00:00.000Z"),
      status: "FAILED",
      sentAt: null,
      failureReason: "failed",
      createdAt: new Date("2026-08-29T00:00:00.000Z"),
      updatedAt: new Date("2026-08-29T00:00:00.000Z"),
    },
  ];

  const members = {
    "operator-a": { id: "participation-operator", userId: "operator-a", role: "OPERATOR", status: "APPROVED" },
    "participant-a": { id: "participation-participant", userId: "participant-a", role: "PARTICIPANT", status: "APPROVED" },
  };
  let activeUser = "";

  const rowsFor = (source: string, selection: unknown): unknown[] => {
    if (source === "space_participations") {
      return activeUser in members ? [members[activeUser as keyof typeof members]] : [];
    }
    if (source === "space_scheduled_sends") {
      const hasSendSelection =
        !!selection &&
        typeof selection === "object" &&
        Object.prototype.hasOwnProperty.call(selection, "send");
      if (!hasSendSelection) return scheduled;
      const ownLetterIds = new Set(
        letters.filter((letter) => letter.authorId === activeUser).map((letter) => letter.id),
      );
      return scheduled
        .filter((send) => ownLetterIds.has(send.spaceLetterId))
        .map((send) => ({ send }));
    }
    if (source === "space_letters") return letters;
    if (source === "spaces") return [space];
    if (source === "space_rounds") {
      return [{
        id: "round-a",
        spaceId: space.id,
        roundNumber: 1,
        status: "ACTIVE",
      }];
    }
    if (source === "space_round_slots") {
      return [{
        id: "slot-a",
        spaceRoundId: "round-a",
        assignedUserId: "participant-a",
        scheduledDate: "2026-09-06",
      }];
    }
    if (source === "users") {
      return [
        { id: "operator-a", nickname: "운영자" },
        { id: "participant-a", nickname: "참여자" },
      ];
    }
    if (source === "articles") {
      return [
        { id: "article-operator", title: "운영자 글" },
        { id: "article-participant", title: "참여자 글" },
      ];
    }
    return [];
  };

  const db: any = {
    select: (selection?: unknown) => {
      let source = "";
      const chain: any = {
        from: (tableValue: { __name?: string }) => {
          source = tableValue.__name ?? "";
          return chain;
        },
        innerJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        groupBy: () => chain,
        limit: () => Promise.resolve(rowsFor(source, selection)),
        then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(rowsFor(source, selection)).then(resolve, reject),
      };
      return chain;
    },
  };

  return {
    db,
    tables,
    setActiveUser: (userId: string) => {
      activeUser = userId;
    },
  };
});

vi.mock("@workspace/db", () => ({
  db: state.db,
  spacesTable: state.tables.spaces,
  spaceRoundsTable: state.tables.rounds,
  spaceRoundSlotsTable: state.tables.slots,
  spaceParticipationsTable: state.tables.participations,
  spaceCodeRequestsTable: state.tables.codeRequests,
  spaceLettersTable: state.tables.letters,
  spaceScheduledSendsTable: state.tables.scheduled,
  usersTable: state.tables.users,
  articlesTable: state.tables.articles,
  userArticleReadsTable: state.tables.reads,
  spaceInvitationsTable: state.tables.invitations,
}));

vi.mock("../lib/scheduledSendProcessor", () => ({
  processDueScheduledSends: vi.fn(async () => undefined),
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (
    req: { header: (name: string) => string | undefined; user?: { id: string } },
    res: { status: (status: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    const userId = req.header("x-test-user-id");
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    state.setActiveUser(userId);
    req.user = { id: userId };
    next();
  },
}));

const { default: router } = await import("./spaces");

let server: Server;

async function request(userId?: string) {
  const headers = userId ? { "x-test-user-id": userId } : undefined;
  return fetch("http://127.0.0.1:" + (server.address() as AddressInfo).port + "/spaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/scheduled-sends", {
    headers,
  });
}

describe("scheduled-send list ownership", () => {
  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use(router);
    server = await new Promise<Server>((resolve) => {
      const nextServer = app.listen(0, () => resolve(nextServer));
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it.each([
    ["operator-a", "send-operator"],
    ["participant-a", "send-participant"],
  ])("returns only %s's reservation regardless of role", async (userId, expectedSendId) => {
    const response = await request(userId);
    expect(response.status).toBe(200);
    const body = await response.json() as Array<{ id: string }>;
    expect(body.map((send) => send.id)).toEqual([expectedSendId]);
  });

  it("keeps non-members and unauthenticated users out", async () => {
    const nonMemberResponse = await request("outsider-a");
    expect(nonMemberResponse.status).toBe(403);

    const unauthenticatedResponse = await request();
    expect(unauthenticatedResponse.status).toBe(401);
  });
});