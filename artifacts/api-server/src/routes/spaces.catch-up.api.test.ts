import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  const ids = {
    space: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    round: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    slot: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    otherSlot: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    letter: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    user: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  };
  let spaceStatus = "ACTIVE";
  let slotDate = "2020-01-01";
  let pendingUse: { slotId: string; date: string } | null = null;
  let sentUse: { slotId: string; date: string } | null = null;
  let inserted: Record<string, unknown> | null = null;

  const sqlValues = (value: unknown, seen = new Set<unknown>()): unknown[] => {
    if (typeof value === "string" || value instanceof Date) return [value];
    if (value == null || typeof value !== "object" || seen.has(value)) return [];
    seen.add(value);
    const record = value as Record<string, unknown>;
    const rawValue = Object.prototype.hasOwnProperty.call(record, "value")
      ? record.value
      : undefined;
    const ownValue =
      typeof rawValue === "string" || rawValue instanceof Date
        ? [rawValue]
        : Array.isArray(rawValue)
          ? rawValue.filter(
              (item): item is string | Date =>
                typeof item === "string" || item instanceof Date,
            )
          : [];
    const chunks = Array.isArray(record.queryChunks) ? record.queryChunks : [];
    return [...ownValue, ...chunks.flatMap((chunk) => sqlValues(chunk, seen))];
  };

  const rowsFor = (source: string, selection: unknown, whereClause?: unknown): unknown[] => {
    if (source === "space_participations") {
      return [{ userId: ids.user, role: "PARTICIPANT", status: "APPROVED" }];
    }
    if (source === "space_letters") {
      return [{
        id: ids.letter,
        spaceId: ids.space,
        spaceRoundId: ids.round,
        authorId: ids.user,
        sourceArticleId: "article",
        letterType: "CENTER",
      }];
    }
    if (source === "space_round_slots") {
      return [{
        id: ids.slot,
        spaceRoundId: ids.round,
        assignedUserId: ids.user,
        scheduledDate: slotDate,
      }];
    }
    if (source === "spaces") return [{ id: ids.space, status: spaceStatus }];
    if (source === "space_rounds") {
      return [{ id: ids.round, spaceId: ids.space, status: "COMPLETED" }];
    }
    if (
      source === "space_scheduled_sends" &&
      selection &&
      typeof selection === "object" &&
      Object.prototype.hasOwnProperty.call(selection, "id")
    ) {
      const values = sqlValues(whereClause).map((value) =>
        value instanceof Date ? value.toISOString().slice(0, 10) : value,
      );
      const use = values.includes("PENDING")
        ? pendingUse
        : values.includes("SENT")
          ? sentUse
          : null;
      const exists =
        !!use &&
        values.includes(ids.round) &&
        values.includes(ids.user) &&
        values.includes(use.slotId) &&
        values.includes(use.date);
      return exists ? [{ id: "existing" }] : [];
    }
    return [];
  };

  const db: any = {
    select: (selection?: unknown) => {
      let source = "";
      let whereClause: unknown;
      const chain: any = {
        from: (value: { __name?: string }) => {
          source = value.__name ?? "";
          return chain;
        },
        innerJoin: () => chain,
        where: (value: unknown) => {
          whereClause = value;
          return chain;
        },
        orderBy: () => chain,
        limit: () => Promise.resolve(rowsFor(source, selection, whereClause)),
        then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(rowsFor(source, selection, whereClause)).then(resolve, reject),
      };
      return chain;
    },
    execute: async () => [],
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserted = value;
        return {
          returning: async () => [{
            id: "new-send",
            ...value,
            status: "PENDING",
          }],
        };
      },
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
  };

  return {
    db,
    tables,
    ids,
    reset() {
      spaceStatus = "ACTIVE";
      slotDate = "2020-01-01";
      pendingUse = null;
      sentUse = null;
      inserted = null;
    },
    setSpaceStatus(value: string) {
      spaceStatus = value;
    },
    setSlotDate(value: string) {
      slotDate = value;
    },
    setPendingUse(slotId: string, date = "2020-01-01") {
      pendingUse = { slotId, date };
    },
    setSentUse(slotId: string, date = "2020-01-01") {
      sentUse = { slotId, date };
    },
    getInserted: () => inserted,
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
  computeDeliverySlot: vi.fn(() => new Date("2026-09-16T21:00:00.000Z")),
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (
    req: { user?: { id: string } },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = { id: state.ids.user };
    next();
  },
}));

const { default: router } = await import("./spaces");
let server: Server;

async function post(body: Record<string, unknown>) {
  return fetch(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/spaces/${state.ids.space}/letters/${state.ids.letter}/scheduled-sends`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("completed-round catch-up scheduling API", () => {
  beforeEach(async () => {
    state.reset();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).log = { info: () => undefined };
      next();
    });
    app.use(router);
    server = await new Promise<Server>((resolve) => {
      const nextServer = app.listen(0, () => resolve(nextServer));
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("accepts the owner's exact past slot in a completed round and chooses the send time", async () => {
    const response = await post({ slotId: state.ids.slot, catchUp: true });
    expect(response.status).toBe(201);
    const inserted = state.getInserted()!;
    expect(inserted).toMatchObject({
      slotId: state.ids.slot,
      reservedRoundId: state.ids.round,
      reservedDate: "2020-01-01",
      reservationAuthorId: state.ids.user,
    });
    expect(inserted.scheduledAt).toBeInstanceOf(Date);
    expect((inserted.scheduledAt as Date).getUTCHours()).toBe(21);
  });

  it("allows a same-round pending record that belongs to a different immutable slot", async () => {
    state.setPendingUse(state.ids.otherSlot);
    const response = await post({ slotId: state.ids.slot, catchUp: true });
    expect(response.status).toBe(201);
  });

  it.each([
    ["another slot", () => undefined, { slotId: state.ids.otherSlot, catchUp: true }, 400],
    ["a future slot", () => state.setSlotDate("2099-01-01"), { slotId: state.ids.slot, catchUp: true }, 400],
    ["an archived space", () => state.setSpaceStatus("ARCHIVED"), { slotId: state.ids.slot, catchUp: true }, 409],
    ["a pending use", () => state.setPendingUse(state.ids.slot), { slotId: state.ids.slot, catchUp: true }, 409],
    ["a sent use", () => state.setSentUse(state.ids.slot), { slotId: state.ids.slot, catchUp: true }, 409],
  ])("rejects %s", async (_name, arrange, body, status) => {
    arrange();
    const response = await post(body);
    expect(response.status).toBe(status);
  });
});