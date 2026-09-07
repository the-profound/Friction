import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Simulates real Postgres unique-constraint semantics for
 * `letter_arrival_notifications (recipient_id, delivery_slot)` via an
 * in-memory Set, rather than a scripted response queue — this lets a test
 * call `claimNewLetterRecipientsForSlot` more than once for the same slot
 * and observe the same at-most-once-per-recipient-per-slot behavior the
 * real DB constraint gives us.
 */
const state = vi.hoisted(() => {
  const column = (name: string) => ({ name });
  const tables = {
    inbox: {
      id: column("inbox.id"),
      recipientId: column("inbox.recipient_id"),
      visibleAt: column("inbox.visible_at"),
    },
    users: {
      id: column("users.id"),
      nickname: column("users.nickname"),
    },
    pushTokens: {
      userId: column("push_tokens.user_id"),
      token: column("push_tokens.token"),
      platform: column("push_tokens.platform"),
    },
    letterArrivalNotifications: {
      recipientId: column("letter_arrival_notifications.recipient_id"),
      deliverySlot: column("letter_arrival_notifications.delivery_slot"),
    },
  };

  let aggregateRows: { userId: string; nickname: string; newLetterCount: number }[] = [];
  let tokenRows: { userId: string; token: string; platform: string }[] = [];
  const claimed = new Set<string>();

  const db: any = {
    select: () => {
      const chain: any = {
        _table: undefined as unknown,
        from(table: unknown) {
          chain._table = table;
          return chain;
        },
        innerJoin() {
          return chain;
        },
        where() {
          return chain;
        },
        groupBy() {
          return chain;
        },
        then(
          resolve: (value: unknown[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          const rows =
            chain._table === tables.inbox
              ? aggregateRows
              : chain._table === tables.pushTokens
                ? tokenRows
                : [];
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return chain;
    },
    insert: () => ({
      values: (values: { recipientId: string; deliverySlot: Date; letterCount: number }[]) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            const newlyClaimed: { recipientId: string }[] = [];
            for (const v of values) {
              const key = `${v.recipientId}|${v.deliverySlot.getTime()}`;
              if (!claimed.has(key)) {
                claimed.add(key);
                newlyClaimed.push({ recipientId: v.recipientId });
              }
            }
            return newlyClaimed;
          },
        }),
      }),
    }),
  };

  return {
    db,
    tables,
    setAggregateRows(rows: typeof aggregateRows) {
      aggregateRows = rows;
    },
    setTokenRows(rows: typeof tokenRows) {
      tokenRows = rows;
    },
    resetClaims() {
      claimed.clear();
    },
  };
});

vi.mock("@workspace/db", () => ({
  db: state.db,
  inboxTable: state.tables.inbox,
  usersTable: state.tables.users,
  pushTokensTable: state.tables.pushTokens,
  letterArrivalNotificationsTable: state.tables.letterArrivalNotifications,
}));

const { claimNewLetterRecipientsForSlot } = await import("./letterNotificationQuery");

const SLOT = new Date("2026-09-08T06:00:00.000+09:00");

describe("claimNewLetterRecipientsForSlot", () => {
  beforeEach(() => {
    state.setAggregateRows([]);
    state.setTokenRows([]);
    state.resetClaims();
  });

  it("returns and claims recipients with new letters for the slot, including their push tokens", async () => {
    state.setAggregateRows([
      { userId: "user-1", nickname: "민지", newLetterCount: 2 },
      { userId: "user-2", nickname: "철수", newLetterCount: 1 },
    ]);
    state.setTokenRows([
      { userId: "user-1", token: "token-1a", platform: "ios" },
      { userId: "user-1", token: "token-1b", platform: "android" },
      { userId: "user-2", token: "token-2a", platform: "ios" },
    ]);

    const recipients = await claimNewLetterRecipientsForSlot(SLOT);

    expect(recipients).toHaveLength(2);
    const byId = new Map(recipients.map((r) => [r.userId, r]));
    expect(byId.get("user-1")).toMatchObject({
      nickname: "민지",
      newLetterCount: 2,
      pushTokens: [
        { token: "token-1a", platform: "ios" },
        { token: "token-1b", platform: "android" },
      ],
    });
    expect(byId.get("user-2")).toMatchObject({
      nickname: "철수",
      newLetterCount: 1,
      pushTokens: [{ token: "token-2a", platform: "ios" }],
    });
  });

  it("never returns a recipient already claimed for the same slot — the exact scenario of a delayed sweep plus a 06:00 timer racing it", async () => {
    state.setAggregateRows([
      { userId: "user-1", nickname: "민지", newLetterCount: 1 },
    ]);
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

    // First caller — e.g. the sweep, recheck-triggered a few minutes after
    // the slot's nominal time — claims and notifies.
    const first = await claimNewLetterRecipientsForSlot(SLOT);
    expect(first.map((r) => r.userId)).toEqual(["user-1"]);

    // Second caller — e.g. the independent 06:00 timer that already ran and
    // found nothing, or a later re-run for the same slot — must not
    // double-claim/double-notify, even though the underlying aggregate
    // query still finds the same inbox rows.
    const second = await claimNewLetterRecipientsForSlot(SLOT);
    expect(second).toEqual([]);
  });

  it("never claims a recipient with zero inbox rows for the slot", async () => {
    state.setAggregateRows([]);
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

    const recipients = await claimNewLetterRecipientsForSlot(SLOT);

    expect(recipients).toEqual([]);
  });

  it("claiming for a different slot is independent — the same recipient can be notified once per slot", async () => {
    state.setAggregateRows([
      { userId: "user-1", nickname: "민지", newLetterCount: 1 },
    ]);
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

    const day1 = await claimNewLetterRecipientsForSlot(SLOT);
    expect(day1.map((r) => r.userId)).toEqual(["user-1"]);

    const nextDaySlot = new Date(SLOT.getTime() + 24 * 60 * 60 * 1000);
    const day2 = await claimNewLetterRecipientsForSlot(nextDaySlot);
    expect(day2.map((r) => r.userId)).toEqual(["user-1"]);
  });
});
