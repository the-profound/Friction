/**
 * Integration tests for POST /send-records — anonymous-space-origin reply
 * marking (Task 2286).
 *
 * A person-to-person "reply" send must durably record whether the inbox
 * letter it replies to arrived via an anonymous Space, so profile visibility
 * can permanently treat that reply as recipient-only. Ordinary replies
 * (non-anonymous space origin, or no space origin at all) must never be
 * marked, and other target types (person, space) must be unaffected.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

const state = vi.hoisted(() => {
  const table = (name: string) =>
    new Proxy(
      { __name: name },
      {
        get(target: { __name: string }, property: string | symbol) {
          if (property === "__name") return target.__name;
          return { name: `${name}.${String(property)}` };
        },
      },
    );

  const tables = {
    sendRecords: table("send_records"),
    articles: table("articles"),
    inbox: table("inbox"),
    users: table("users"),
    spaces: table("spaces"),
    spaceLetters: table("space_letters"),
    spaceParticipations: table("space_participations"),
    spaceScheduledSends: table("space_scheduled_sends"),
    teamCollections: table("team_collections"),
  };

  const SENDER_ID = "11111111-1111-4111-8111-111111111111";
  const ARTICLE_ID = "22222222-2222-4222-8222-222222222222";
  const INBOX_ANON_ID = "33333333-3333-4333-8333-333333333333";
  const INBOX_PUBLIC_ID = "44444444-4444-4444-8444-444444444444";
  const INBOX_PERSONAL_ID = "55555555-5555-4555-8555-555555555555";
  const SPACE_ANON_ID = "66666666-6666-4666-8666-666666666666";
  const SPACE_PUBLIC_ID = "77777777-7777-4777-8777-777777777777";

  const articles = [
    {
      id: ARTICLE_ID,
      authorId: SENDER_ID,
      status: "LETTER",
      title: "제목",
      content: "본문",
    },
  ];

  // Inbox rows the sender has already read, each sourced from a different
  // kind of origin.
  const inboxRows = [
    {
      id: INBOX_ANON_ID,
      recipientId: SENDER_ID,
      senderId: "99999999-9999-4999-8999-999999999991",
      articleId: "88888888-8888-4888-8888-888888888881",
      isRead: true,
      sourceSpaceId: SPACE_ANON_ID,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    },
    {
      id: INBOX_PUBLIC_ID,
      recipientId: SENDER_ID,
      senderId: "99999999-9999-4999-8999-999999999992",
      articleId: "88888888-8888-4888-8888-888888888882",
      isRead: true,
      sourceSpaceId: SPACE_PUBLIC_ID,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    },
    {
      id: INBOX_PERSONAL_ID,
      recipientId: SENDER_ID,
      senderId: "99999999-9999-4999-8999-999999999993",
      articleId: "88888888-8888-4888-8888-888888888883",
      isRead: true,
      sourceSpaceId: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  ];

  const spaces = [
    { id: SPACE_ANON_ID, isAnonymous: true },
    { id: SPACE_PUBLIC_ID, isAnonymous: false },
  ];

  let insertedSendRecord: Record<string, unknown> | null = null;

  const SEND_RECORD_ANON_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const SEND_RECORD_NORMAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const existingSendRecords = [
    {
      id: SEND_RECORD_ANON_ID,
      senderId: SENDER_ID,
      recipientId: "99999999-9999-4999-8999-999999999991",
      articleId: ARTICLE_ID,
      inboxId: null,
      replyToInboxId: INBOX_ANON_ID,
      targetType: "reply",
      spaceId: null,
      spaceScheduledSendId: null,
      collectionId: null,
      isAnonymousSpaceReply: true,
      deliverySlot: new Date("2020-01-01T00:00:00.000Z"),
      sentAt: new Date("2020-01-01T00:00:00.000Z"),
      article: null,
      recipient: null,
      collectionName: null,
      spaceName: null,
    },
    {
      id: SEND_RECORD_NORMAL_ID,
      senderId: SENDER_ID,
      recipientId: "99999999-9999-4999-8999-999999999993",
      articleId: ARTICLE_ID,
      inboxId: null,
      replyToInboxId: INBOX_PERSONAL_ID,
      targetType: "reply",
      spaceId: null,
      spaceScheduledSendId: null,
      collectionId: null,
      isAnonymousSpaceReply: false,
      deliverySlot: new Date("2020-01-01T00:00:00.000Z"),
      sentAt: new Date("2020-01-01T00:00:00.000Z"),
      article: null,
      recipient: null,
      collectionName: null,
      spaceName: null,
    },
  ];

  // Same rationale as inboxWhereFilter below: the mock ignores the real
  // drizzle `where()` predicate, so tests set the intended filter directly.
  let sendRecordsFilter: { senderId?: string; id?: string } = {};

  const rowsFor = (source: string): unknown[] => {
    if (source === "articles") return articles;
    if (source === "send_records") {
      return existingSendRecords.filter(
        (r) =>
          (!sendRecordsFilter.senderId ||
            r.senderId === sendRecordsFilter.senderId) &&
          (!sendRecordsFilter.id || r.id === sendRecordsFilter.id),
      );
    }
    if (source === "inbox_join_spaces") {
      // Emulates: select(id, senderId, sourceSpaceIsAnonymous) from inbox
      // left join spaces on inbox.sourceSpaceId = spaces.id
      return inboxRows.map((row) => {
        const space = spaces.find((s) => s.id === row.sourceSpaceId);
        return {
          id: row.id,
          senderId: row.senderId,
          sourceSpaceIsAnonymous: space ? space.isAnonymous : null,
          // retained for the where-clause filter helper below
          recipientId: row.recipientId,
          isRead: row.isRead,
          articleId: row.articleId,
        };
      });
    }
    return [];
  };

  // The route filters the inbox/spaces join in SQL; this mock instead
  // filters in JS once the query's `where` predicate values are captured.
  let inboxWhereFilter: { id?: string; articleId?: string } = {};

  const db: any = {
    select: (_selection?: unknown) => {
      let source = "";
      const chain: any = {
        from: (t: { __name?: string }) => {
          source = t.__name ?? "";
          return chain;
        },
        leftJoin: () => {
          if (source === "inbox") source = "inbox_join_spaces";
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: () =>
          Promise.resolve(
            source === "inbox_join_spaces"
              ? rowsFor(source).filter(
                  (r: any) =>
                    (!inboxWhereFilter.id || r.id === inboxWhereFilter.id) &&
                    (!inboxWhereFilter.articleId ||
                      r.articleId === inboxWhereFilter.articleId),
                )
              : rowsFor(source),
          ),
        then: (
          resolve: (v: unknown[]) => unknown,
          reject?: (r: unknown) => unknown,
        ) => Promise.resolve(rowsFor(source)).then(resolve, reject),
      };
      return chain;
    },
    insert: (t: { __name?: string }) => ({
      values: (v: Record<string, unknown>) => ({
        returning: (sel?: unknown) => {
          if (t.__name === "inbox") {
            return Promise.resolve([{ id: "new-inbox-id" }]);
          }
          if (t.__name === "send_records") {
            insertedSendRecord = { id: "new-send-record-id", ...v };
            return Promise.resolve([insertedSendRecord]);
          }
          return Promise.resolve([{}]);
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };

  return {
    db,
    tables,
    SENDER_ID,
    ARTICLE_ID,
    INBOX_ANON_ID,
    INBOX_PUBLIC_ID,
    INBOX_PERSONAL_ID,
    SEND_RECORD_ANON_ID,
    SEND_RECORD_NORMAL_ID,
    setInboxWhereFilter: (filter: { id?: string; articleId?: string }) => {
      inboxWhereFilter = filter;
    },
    setSendRecordsFilter: (filter: { senderId?: string; id?: string }) => {
      sendRecordsFilter = filter;
    },
    getInsertedSendRecord: () => insertedSendRecord,
    resetInsertedSendRecord: () => {
      insertedSendRecord = null;
    },
  };
});

// The route's `where(and(eq(recipientId), eq(isRead), eq(id|articleId)))`
// call always includes the replyToInboxId/replyToArticleId as the last
// predicate; since our mock `where()` ignores its argument, capture the
// intended target directly from the request body in each test instead.

vi.mock("@workspace/db", () => ({
  db: state.db,
  sendRecordsTable: state.tables.sendRecords,
  articlesTable: state.tables.articles,
  inboxTable: state.tables.inbox,
  usersTable: state.tables.users,
  spacesTable: state.tables.spaces,
  spaceLettersTable: state.tables.spaceLetters,
  spaceParticipationsTable: state.tables.spaceParticipations,
  spaceScheduledSendsTable: state.tables.spaceScheduledSends,
  teamCollectionsTable: state.tables.teamCollections,
}));

vi.mock("../middlewares/requireAuth", () => ({
  resolveCallerId: async (req: { header: (n: string) => string | undefined }) =>
    req.header("x-test-user-id") ?? null,
}));

const { default: router } = await import("./send-records");

let server: Server;

async function postSendRecord(body: Record<string, unknown>, callerId: string) {
  const port = (server.address() as AddressInfo).port;
  return fetch(`http://127.0.0.1:${port}/send-records`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-user-id": callerId,
    },
    body: JSON.stringify(body),
  });
}

async function getSendRecords(senderId: string, callerId?: string) {
  const port = (server.address() as AddressInfo).port;
  const headers: Record<string, string> = {};
  if (callerId) headers["x-test-user-id"] = callerId;
  return fetch(
    `http://127.0.0.1:${port}/send-records?senderId=${senderId}`,
    { headers },
  );
}

async function getSendRecordById(id: string, callerId?: string) {
  const port = (server.address() as AddressInfo).port;
  const headers: Record<string, string> = {};
  if (callerId) headers["x-test-user-id"] = callerId;
  return fetch(`http://127.0.0.1:${port}/send-records/${id}`, { headers });
}

describe("POST /send-records — anonymous-space-origin reply marking", () => {
  beforeEach(async () => {
    state.resetInsertedSendRecord();
    const app = express();
    app.use(express.json());
    app.use("/", router);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("marks a reply whose source letter came from an anonymous space", async () => {
    state.setInboxWhereFilter({ id: state.INBOX_ANON_ID });
    const res = await postSendRecord(
      {
        senderId: state.SENDER_ID,
        articleId: state.ARTICLE_ID,
        targetType: "reply",
        replyToInboxId: state.INBOX_ANON_ID,
      },
      state.SENDER_ID,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    expect(state.getInsertedSendRecord()).toMatchObject({
      isAnonymousSpaceReply: true,
      targetType: "reply",
    });
  });

  it("does not mark a reply whose source letter came from a non-anonymous space", async () => {
    state.setInboxWhereFilter({ id: state.INBOX_PUBLIC_ID });
    const res = await postSendRecord(
      {
        senderId: state.SENDER_ID,
        articleId: state.ARTICLE_ID,
        targetType: "reply",
        replyToInboxId: state.INBOX_PUBLIC_ID,
      },
      state.SENDER_ID,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    expect(state.getInsertedSendRecord()).toMatchObject({
      isAnonymousSpaceReply: false,
      targetType: "reply",
    });
  });

  it("does not mark an ordinary person-to-person reply with no space origin", async () => {
    state.setInboxWhereFilter({ id: state.INBOX_PERSONAL_ID });
    const res = await postSendRecord(
      {
        senderId: state.SENDER_ID,
        articleId: state.ARTICLE_ID,
        targetType: "reply",
        replyToInboxId: state.INBOX_PERSONAL_ID,
      },
      state.SENDER_ID,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    expect(state.getInsertedSendRecord()).toMatchObject({
      isAnonymousSpaceReply: false,
      targetType: "reply",
    });
  });
});

describe("GET /send-records — anonymous-space-origin reply access control", () => {
  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use("/", router);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("the sender themself sees their own anonymous-space-origin reply in the list", async () => {
    state.setSendRecordsFilter({ senderId: state.SENDER_ID });
    const res = await getSendRecords(state.SENDER_ID, state.SENDER_ID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((r) => r.id)).toContain(state.SEND_RECORD_ANON_ID);
  });

  it("an unauthenticated caller cannot see the anonymous-space-origin reply in the list, but still sees the normal one", async () => {
    state.setSendRecordsFilter({ senderId: state.SENDER_ID });
    const res = await getSendRecords(state.SENDER_ID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((r) => r.id)).not.toContain(state.SEND_RECORD_ANON_ID);
    expect(body.map((r) => r.id)).toContain(state.SEND_RECORD_NORMAL_ID);
  });

  it("a different authenticated user (e.g. viewing a public profile) cannot see the anonymous-space-origin reply", async () => {
    state.setSendRecordsFilter({ senderId: state.SENDER_ID });
    const res = await getSendRecords(
      state.SENDER_ID,
      "99999999-9999-4999-8999-999999999999",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((r) => r.id)).not.toContain(state.SEND_RECORD_ANON_ID);
  });

  it("GET /send-records/:id returns the anonymous-space-origin reply to its sender", async () => {
    state.setSendRecordsFilter({ id: state.SEND_RECORD_ANON_ID });
    const res = await getSendRecordById(
      state.SEND_RECORD_ANON_ID,
      state.SENDER_ID,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(state.SEND_RECORD_ANON_ID);
  });

  it("GET /send-records/:id hides the anonymous-space-origin reply from anyone else as if it did not exist", async () => {
    state.setSendRecordsFilter({ id: state.SEND_RECORD_ANON_ID });
    const res = await getSendRecordById(state.SEND_RECORD_ANON_ID);
    expect(res.status).toBe(404);
  });
});
