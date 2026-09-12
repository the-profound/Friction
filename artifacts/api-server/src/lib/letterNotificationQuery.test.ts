import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Simulates real Postgres semantics for the
 * `letter_arrival_notifications (recipient_id, delivery_slot,
 * claimed_through_sequence, notified_through_sequence, lease_id, locked_at)`
 * ledger via an in-memory Map, rather than a scripted response queue — this
 * lets a test call `claimNewLetterRecipientsForSlot`,
 * `confirmLetterNotificationSent`, `releaseLetterNotificationClaim`, and
 * `findDeliverySlotsNeedingLetterPushRetry` any number of times for the same
 * slot and observe the same claim/confirm/release/retry-discovery semantics
 * the real DB constraint + conditional `ON CONFLICT ... DO UPDATE` give us —
 * including a fresh lock blocking a competing claim, a stale lock (simulated
 * via fake timers) becoming re-claimable, and a stale attempt's late
 * confirm/release being fenced out by lease mismatch once a newer attempt
 * has reclaimed the row.
 *
 * The claim/confirm/release/retry-discovery helpers issue raw parameterized
 * SQL via `db.execute`, so the mock decodes each query by walking the
 * drizzle-orm `SQL` object's `queryChunks` (flattening any nested `SQL`
 * produced by `sql.join`) to recover the literal text and the ordered bind
 * parameters, then branches on the text to know which operation is running.
 * This avoids needing a real database or a real SQL parser — it only relies
 * on the stable shape of drizzle's own `sql` tagged-template output.
 */
function decodeSqlQuery(query: { queryChunks: unknown[] }): {
  text: string;
  params: unknown[];
} {
  const textParts: string[] = [];
  const params: unknown[] = [];
  const walk = (node: { queryChunks: unknown[] }) => {
    for (const chunk of node.queryChunks) {
      const ctorName =
        chunk && typeof chunk === "object"
          ? (chunk as { constructor?: { name?: string } }).constructor?.name
          : undefined;
      if (ctorName === "SQL") {
        walk(chunk as { queryChunks: unknown[] });
      } else if (ctorName === "StringChunk") {
        textParts.push((chunk as { value: string[] }).value.join(""));
      } else {
        params.push(chunk);
      }
    }
  };
  walk(query);
  return { text: textParts.join(" "), params };
}

function rowsFor(recipientId: string, nickname: string, sequences: number[]) {
  return sequences.map((sequence) => ({ recipientId, nickname, sequence }));
}

const state = vi.hoisted(() => {
  const column = (name: string) => ({ name });
  const tables = {
    inbox: {
      id: column("inbox.id"),
      recipientId: column("inbox.recipient_id"),
      visibleAt: column("inbox.visible_at"),
      sequence: column("inbox.sequence"),
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
  };

  let inboxRows: { recipientId: string; nickname: string; sequence: number }[] = [];
  let tokenRows: { userId: string; token: string; platform: string }[] = [];
  const LOCK_STALE_MS = 2 * 60 * 1000; // must match LETTER_PUSH_LOCK_STALE_MS
  const ledger = new Map<
    string,
    {
      claimedThroughSequence: number;
      notifiedThroughSequence: number;
      leaseId: string | null;
      lockedAt: number | null;
    }
  >();
  let leaseCounter = 0;
  const nextLeaseId = () => `mock-lease-${++leaseCounter}`;

  function ledgerKey(recipientId: string, deliverySlot: Date): string {
    return `${recipientId}|${new Date(deliverySlot).getTime()}`;
  }

  function isReclaimable(row: {
    claimedThroughSequence: number;
    notifiedThroughSequence: number;
    lockedAt: number | null;
  }): boolean {
    if (row.claimedThroughSequence === row.notifiedThroughSequence) return true; // fully resolved
    if (row.lockedAt === null) return true; // released after a failed push
    return Date.now() - row.lockedAt >= LOCK_STALE_MS; // crashed/stale
  }

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
        then(
          resolve: (value: unknown[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          const rows =
            chain._table === tables.inbox
              ? inboxRows
              : chain._table === tables.pushTokens
                ? tokenRows
                : [];
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return chain;
    },
    execute: async (query: unknown) => {
      const { text, params } = decodeSqlQuery(query as { queryChunks: unknown[] });

      if (/^\s*INSERT INTO letter_arrival_notifications/i.test(text)) {
        // Claim: params are grouped in 3s per row — recipientId,
        // deliverySlot, maxSequence (notified_through_sequence 0, a fresh
        // lease_id, and now() are literal SQL text, not bound params, for a
        // brand-new row) — followed by exactly one trailing param for
        // LETTER_PUSH_LOCK_STALE_MS, bound in the ON CONFLICT DO UPDATE
        // guard's staleness check. Drop that trailing param before grouping
        // the per-row triples.
        const nowMs = Date.now();
        const rowParams = params.slice(0, params.length - 1);
        const returned: {
          recipient_id: string;
          lease_id: string;
          claimed_through_sequence: number;
          notified_through_sequence: number;
        }[] = [];
        for (let i = 0; i < rowParams.length; i += 3) {
          const recipientId = rowParams[i] as string;
          const deliverySlot = rowParams[i + 1] as Date;
          const maxSequence = rowParams[i + 2] as number;
          const key = ledgerKey(recipientId, deliverySlot);
          const existing = ledger.get(key);
          if (!existing) {
            const leaseId = nextLeaseId();
            const row = {
              claimedThroughSequence: maxSequence,
              notifiedThroughSequence: 0,
              leaseId,
              lockedAt: nowMs,
            };
            ledger.set(key, row);
            returned.push({
              recipient_id: recipientId,
              lease_id: leaseId,
              claimed_through_sequence: row.claimedThroughSequence,
              notified_through_sequence: row.notifiedThroughSequence,
            });
          } else if (
            existing.notifiedThroughSequence < maxSequence &&
            isReclaimable(existing)
          ) {
            const leaseId = nextLeaseId();
            existing.claimedThroughSequence = maxSequence;
            existing.leaseId = leaseId;
            existing.lockedAt = nowMs;
            returned.push({
              recipient_id: recipientId,
              lease_id: leaseId,
              claimed_through_sequence: existing.claimedThroughSequence,
              notified_through_sequence: existing.notifiedThroughSequence,
            });
          }
          // else: a fresh in-flight lock excludes it, or nothing new to
          // claim — excluded from the result, exactly like a real
          // conflicting UPDATE whose WHERE clause doesn't match.
        }
        return { rows: returned };
      }

      if (/SET notified_through_sequence = /i.test(text)) {
        // Confirm: params = [newNotifiedThroughSequence, recipientId, deliverySlot, guardLeaseId]
        const [newNotifiedThroughSequence, recipientId, deliverySlot, guardLeaseId] =
          params as [number, string, Date, string];
        const row = ledger.get(ledgerKey(recipientId, deliverySlot));
        if (row && row.leaseId === guardLeaseId) {
          row.notifiedThroughSequence = newNotifiedThroughSequence;
          row.lockedAt = null;
        }
        return { rows: [] };
      }

      if (/SET locked_at = NULL/i.test(text)) {
        // Release: params = [recipientId, deliverySlot, guardLeaseId]
        const [recipientId, deliverySlot, guardLeaseId] = params as [string, Date, string];
        const row = ledger.get(ledgerKey(recipientId, deliverySlot));
        if (row && row.leaseId === guardLeaseId) {
          row.lockedAt = null;
        }
        return { rows: [] };
      }

      if (/^\s*SELECT DISTINCT delivery_slot/i.test(text)) {
        // Retry-discovery: no meaningful params — scan the whole ledger for
        // any unresolved row that is releasable (locked_at IS NULL) or
        // whose lock has gone stale.
        const slots = new Map<number, Date>();
        for (const [key, row] of ledger) {
          if (row.claimedThroughSequence === row.notifiedThroughSequence) continue;
          const stale = row.lockedAt === null || Date.now() - row.lockedAt >= LOCK_STALE_MS;
          if (!stale) continue;
          const slotMs = Number(key.split("|")[1]);
          slots.set(slotMs, new Date(slotMs));
        }
        return { rows: Array.from(slots.values()).map((d) => ({ delivery_slot: d })) };
      }

      throw new Error(`Unhandled query in mock db.execute: ${text}`);
    },
  };

  return {
    db,
    tables,
    setInboxRows(rows: typeof inboxRows) {
      inboxRows = rows;
    },
    setTokenRows(rows: typeof tokenRows) {
      tokenRows = rows;
    },
    resetLedger() {
      ledger.clear();
      leaseCounter = 0;
    },
  };
});

vi.mock("@workspace/db", () => ({
  db: state.db,
  inboxTable: state.tables.inbox,
  usersTable: state.tables.users,
  pushTokensTable: state.tables.pushTokens,
}));

const {
  claimNewLetterRecipientsForSlot,
  confirmLetterNotificationSent,
  releaseLetterNotificationClaim,
  findDeliverySlotsNeedingLetterPushRetry,
  LETTER_PUSH_LOCK_STALE_MS,
} = await import("./letterNotificationQuery");

const SLOT = new Date("2026-09-08T06:00:00.000+09:00");

describe("claimNewLetterRecipientsForSlot", () => {
  beforeEach(() => {
    state.setInboxRows([]);
    state.setTokenRows([]);
    state.resetLedger();
  });

  it("returns and claims recipients with new letters for the slot, including their push tokens", async () => {
    state.setInboxRows([
      ...rowsFor("user-1", "민지", [10, 11]),
      ...rowsFor("user-2", "철수", [12]),
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
      claimedThroughSequence: 11,
      pushTokens: [
        { token: "token-1a", platform: "ios" },
        { token: "token-1b", platform: "android" },
      ],
    });
    expect(byId.get("user-2")).toMatchObject({
      nickname: "철수",
      newLetterCount: 1,
      claimedThroughSequence: 12,
      pushTokens: [{ token: "token-2a", platform: "ios" }],
    });
    // Each claim mints its own opaque lease identity.
    expect(byId.get("user-1")!.leaseId).toBeTruthy();
    expect(byId.get("user-2")!.leaseId).toBeTruthy();
    expect(byId.get("user-1")!.leaseId).not.toBe(byId.get("user-2")!.leaseId);
  });

  it("never returns a recipient whose claim for the same slot is still unresolved — the exact scenario of a delayed sweep plus a 06:00 timer racing it", async () => {
    state.setInboxRows(rowsFor("user-1", "민지", [1]));
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

    // First caller — e.g. the sweep, recheck-triggered a few minutes after
    // the slot's nominal time — claims but has not yet confirmed or
    // released (its push attempt is still in flight from the ledger's
    // point of view).
    const first = await claimNewLetterRecipientsForSlot(SLOT);
    expect(first.map((r) => r.userId)).toEqual(["user-1"]);

    // Second caller — e.g. the independent 06:00 timer racing the same
    // moment — must not double-claim/double-notify while the first
    // attempt is unresolved, even though the underlying select still finds
    // the same inbox rows.
    const second = await claimNewLetterRecipientsForSlot(SLOT);
    expect(second).toEqual([]);
  });

  it("never claims a recipient with zero inbox rows for the slot", async () => {
    state.setInboxRows([]);
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

    const recipients = await claimNewLetterRecipientsForSlot(SLOT);

    expect(recipients).toEqual([]);
  });

  it("claiming for a different slot is independent — the same recipient can be notified once per slot", async () => {
    state.setInboxRows(rowsFor("user-1", "민지", [1]));
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

    const day1 = await claimNewLetterRecipientsForSlot(SLOT);
    expect(day1.map((r) => r.userId)).toEqual(["user-1"]);

    const nextDaySlot = new Date(SLOT.getTime() + 24 * 60 * 60 * 1000);
    const day2 = await claimNewLetterRecipientsForSlot(nextDaySlot);
    expect(day2.map((r) => r.userId)).toEqual(["user-1"]);
  });

  it("re-claims the same unconfirmed letters after a previous attempt's push failed and was released — a later trigger retries instead of losing them, with a fresh lease", async () => {
    state.setInboxRows(rowsFor("user-1", "민지", [1, 2]));
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

    const first = await claimNewLetterRecipientsForSlot(SLOT);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ newLetterCount: 2, claimedThroughSequence: 2 });

    // The push attempt genuinely failed to send — the caller releases the
    // claim instead of confirming it.
    await releaseLetterNotificationClaim("user-1", SLOT, first[0]!.leaseId);

    // A later trigger for the same slot must pick the recipient back up
    // with the same still-unnotified letters, not skip them forever — and
    // gets a brand-new lease for this fresh attempt.
    const retry = await claimNewLetterRecipientsForSlot(SLOT);
    expect(retry).toHaveLength(1);
    expect(retry[0]).toMatchObject({ newLetterCount: 2, claimedThroughSequence: 2 });
    expect(retry[0]!.leaseId).not.toBe(first[0]!.leaseId);

    // The original (stale) attempt's late release must not be able to
    // touch the reclaimed row: its leaseId no longer matches.
    await releaseLetterNotificationClaim("user-1", SLOT, first[0]!.leaseId);
    expect(await claimNewLetterRecipientsForSlot(SLOT)).toEqual([]); // still locked by the retry

    // Once the retry is confirmed, a further call with no new letters
    // finds nothing — no double-notification of the eventually-successful
    // retry.
    await confirmLetterNotificationSent("user-1", SLOT, retry[0]!.leaseId, retry[0]!.claimedThroughSequence);
    const afterConfirm = await claimNewLetterRecipientsForSlot(SLOT);
    expect(afterConfirm).toEqual([]);
  });

  it("a stale attempt's late confirm, arriving after a newer attempt has already reclaimed the row, is fenced out by lease mismatch", async () => {
    state.setInboxRows(rowsFor("user-1", "민지", [1, 2]));
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-08T06:00:00.000+09:00"));
      const staleAttempt = await claimNewLetterRecipientsForSlot(SLOT);
      expect(staleAttempt).toHaveLength(1);

      // staleAttempt's process is presumed dead: its lock goes stale and a
      // later trigger reclaims the row with a fresh lease.
      vi.advanceTimersByTime(LETTER_PUSH_LOCK_STALE_MS);
      const newerAttempt = await claimNewLetterRecipientsForSlot(SLOT);
      expect(newerAttempt).toHaveLength(1);
      expect(newerAttempt[0]!.leaseId).not.toBe(staleAttempt[0]!.leaseId);

      // The newer attempt confirms first.
      await confirmLetterNotificationSent(
        "user-1",
        SLOT,
        newerAttempt[0]!.leaseId,
        newerAttempt[0]!.claimedThroughSequence,
      );

      // The presumed-dead process finally wakes up and confirms too, using
      // its now-stale leaseId. This must be a no-op — it must not be able
      // to corrupt the newer (already-confirmed) attempt's state.
      await confirmLetterNotificationSent(
        "user-1",
        SLOT,
        staleAttempt[0]!.leaseId,
        staleAttempt[0]!.claimedThroughSequence,
      );

      // Nothing left to claim — the row is correctly fully resolved by the
      // newer attempt's confirm, undisturbed by the late stale confirm.
      expect(await claimNewLetterRecipientsForSlot(SLOT)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("claims only the newly-arrived delta when a second same-slot batch lands for a recipient already notified in that slot", async () => {
    state.setInboxRows(rowsFor("user-1", "민지", [1, 2]));
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

    const firstWave = await claimNewLetterRecipientsForSlot(SLOT);
    expect(firstWave).toHaveLength(1);
    expect(firstWave[0]).toMatchObject({ newLetterCount: 2, claimedThroughSequence: 2 });
    await confirmLetterNotificationSent(
      "user-1",
      SLOT,
      firstWave[0]!.leaseId,
      firstWave[0]!.claimedThroughSequence,
    );

    // A second, independent batch of reservations commits 3 more inbox
    // rows for the exact same slot — new, higher sequence numbers.
    state.setInboxRows(rowsFor("user-1", "민지", [1, 2, 3, 4, 5]));
    const secondWave = await claimNewLetterRecipientsForSlot(SLOT);

    expect(secondWave).toHaveLength(1);
    // Only the 3 newly-arrived letters (sequence 3, 4, 5) are claimed/
    // reported — not all 5 (would double-count the first wave) and not
    // zero (would silently drop the second wave).
    expect(secondWave[0]).toMatchObject({ newLetterCount: 3, claimedThroughSequence: 5 });

    // And once that follow-up is confirmed too, nothing is left to claim.
    await confirmLetterNotificationSent(
      "user-1",
      SLOT,
      secondWave[0]!.leaseId,
      secondWave[0]!.claimedThroughSequence,
    );
    expect(await claimNewLetterRecipientsForSlot(SLOT)).toEqual([]);
  });

  it("a deleted already-notified inbox row does not mask a genuinely new arrival in the same slot", async () => {
    // Recipient starts with 2 letters, both get confirmed as notified.
    state.setInboxRows(rowsFor("user-1", "민지", [1, 2]));
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);
    const firstWave = await claimNewLetterRecipientsForSlot(SLOT);
    await confirmLetterNotificationSent(
      "user-1",
      SLOT,
      firstWave[0]!.leaseId,
      firstWave[0]!.claimedThroughSequence,
    );

    // The user deletes the already-notified inbox row with sequence 1, and
    // a genuinely new letter (sequence 3) arrives in the same slot. A live
    // COUNT of current rows would now read 2 (rows [2, 3]) — the same as
    // before the deletion — and could fail to exceed the previously
    // notified count, silently dropping this follow-up. The sequence
    // cursor is unaffected by the deletion and still correctly detects the
    // new arrival.
    state.setInboxRows(rowsFor("user-1", "민지", [2, 3]));
    const secondWave = await claimNewLetterRecipientsForSlot(SLOT);

    expect(secondWave).toHaveLength(1);
    expect(secondWave[0]).toMatchObject({ newLetterCount: 1, claimedThroughSequence: 3 });
  });

  it("a same-slot batch landing while a prior wave's push is still unresolved is not claimed until that attempt resolves", async () => {
    state.setInboxRows(rowsFor("user-1", "민지", [1, 2]));
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

    const firstWave = await claimNewLetterRecipientsForSlot(SLOT);
    expect(firstWave).toHaveLength(1);
    // Do not confirm/release yet — simulate the first wave's push still
    // being in flight when a second batch's rows land.

    state.setInboxRows(rowsFor("user-1", "민지", [1, 2, 3, 4, 5]));
    expect(await claimNewLetterRecipientsForSlot(SLOT)).toEqual([]);

    // Once the first wave resolves (confirmed), the now-stale total is
    // correctly picked up as a fresh delta.
    await confirmLetterNotificationSent(
      "user-1",
      SLOT,
      firstWave[0]!.leaseId,
      firstWave[0]!.claimedThroughSequence,
    );
    const afterResolve = await claimNewLetterRecipientsForSlot(SLOT);
    expect(afterResolve).toHaveLength(1);
    expect(afterResolve[0]).toMatchObject({ newLetterCount: 3, claimedThroughSequence: 5 });
  });

  it("a claim with a fresh lock is not reclaimed by a second trigger racing it before the first resolves — even seconds apart, not just instantaneously", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-08T06:00:00.000+09:00"));
      state.setInboxRows(rowsFor("user-1", "민지", [1]));
      state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

      // Trigger A claims and is mid-attempt (still unresolved).
      const first = await claimNewLetterRecipientsForSlot(SLOT);
      expect(first).toHaveLength(1);

      // A short time later — well under the stale threshold — trigger B
      // races in before A has confirmed or released. It must see the lock
      // as still fresh and get nothing.
      vi.advanceTimersByTime(30_000);
      const second = await claimNewLetterRecipientsForSlot(SLOT);
      expect(second).toEqual([]);

      // A confirms; now a further trigger legitimately finds nothing new.
      await confirmLetterNotificationSent(
        "user-1",
        SLOT,
        first[0]!.leaseId,
        first[0]!.claimedThroughSequence,
      );
      expect(await claimNewLetterRecipientsForSlot(SLOT)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reclaims a claim whose lock has gone stale — the crashed-process case — without waiting for an explicit release", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-08T06:00:00.000+09:00"));
      state.setInboxRows(rowsFor("user-1", "민지", [1, 2]));
      state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

      const first = await claimNewLetterRecipientsForSlot(SLOT);
      expect(first).toHaveLength(1);
      // The process handling this claim crashes here — never confirms or
      // releases. Shortly after, the lock is still fresh and blocks a
      // competing claim.
      vi.advanceTimersByTime(30_000);
      expect(await claimNewLetterRecipientsForSlot(SLOT)).toEqual([]);

      // Once the lock is older than LETTER_PUSH_LOCK_STALE_MS, a later
      // trigger (e.g. the periodic retry recheck) can pick it back up
      // without anyone ever having called releaseLetterNotificationClaim —
      // and gets a fresh lease.
      vi.advanceTimersByTime(LETTER_PUSH_LOCK_STALE_MS);
      const retry = await claimNewLetterRecipientsForSlot(SLOT);
      expect(retry).toHaveLength(1);
      expect(retry[0]).toMatchObject({ newLetterCount: 2, claimedThroughSequence: 2 });
      expect(retry[0]!.leaseId).not.toBe(first[0]!.leaseId);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("findDeliverySlotsNeedingLetterPushRetry", () => {
  beforeEach(() => {
    state.setInboxRows([]);
    state.setTokenRows([]);
    state.resetLedger();
  });

  it("returns nothing when there are no notification rows at all", async () => {
    expect(await findDeliverySlotsNeedingLetterPushRetry()).toEqual([]);
  });

  it("does not surface a slot whose only row is a fresh in-flight claim", async () => {
    state.setInboxRows(rowsFor("user-1", "민지", [1]));
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);
    await claimNewLetterRecipientsForSlot(SLOT);

    expect(await findDeliverySlotsNeedingLetterPushRetry()).toEqual([]);
  });

  it("does not surface a slot that is fully confirmed", async () => {
    state.setInboxRows(rowsFor("user-1", "민지", [1]));
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);
    const claimed = await claimNewLetterRecipientsForSlot(SLOT);
    await confirmLetterNotificationSent(
      "user-1",
      SLOT,
      claimed[0]!.leaseId,
      claimed[0]!.claimedThroughSequence,
    );

    expect(await findDeliverySlotsNeedingLetterPushRetry()).toEqual([]);
  });

  it("surfaces a slot with a released (failed-push) claim, and stops surfacing it once the retry is confirmed", async () => {
    state.setInboxRows(rowsFor("user-1", "민지", [1]));
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);
    const claimed = await claimNewLetterRecipientsForSlot(SLOT);
    await releaseLetterNotificationClaim("user-1", SLOT, claimed[0]!.leaseId);

    const retrySlots = await findDeliverySlotsNeedingLetterPushRetry();
    expect(retrySlots).toHaveLength(1);
    expect(retrySlots[0]!.getTime()).toBe(SLOT.getTime());

    const retryClaim = await claimNewLetterRecipientsForSlot(SLOT);
    await confirmLetterNotificationSent(
      "user-1",
      SLOT,
      retryClaim[0]!.leaseId,
      retryClaim[0]!.claimedThroughSequence,
    );
    expect(await findDeliverySlotsNeedingLetterPushRetry()).toEqual([]);
  });

  it("surfaces a slot only once its lock has gone stale, not while it is still fresh", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-08T06:00:00.000+09:00"));
      state.setInboxRows(rowsFor("user-1", "민지", [1]));
      state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);
      await claimNewLetterRecipientsForSlot(SLOT);

      expect(await findDeliverySlotsNeedingLetterPushRetry()).toEqual([]);

      vi.advanceTimersByTime(LETTER_PUSH_LOCK_STALE_MS);
      const retrySlots = await findDeliverySlotsNeedingLetterPushRetry();
      expect(retrySlots).toHaveLength(1);
      expect(retrySlots[0]!.getTime()).toBe(SLOT.getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it("distinguishes multiple slots — only the one with an unresolved row is surfaced", async () => {
    const otherSlot = new Date(SLOT.getTime() + 24 * 60 * 60 * 1000);
    state.setInboxRows(rowsFor("user-1", "민지", [1]));
    state.setTokenRows([{ userId: "user-1", token: "token-1", platform: "ios" }]);

    const claimedSlot1 = await claimNewLetterRecipientsForSlot(SLOT);
    await confirmLetterNotificationSent(
      "user-1",
      SLOT,
      claimedSlot1[0]!.leaseId,
      claimedSlot1[0]!.claimedThroughSequence,
    );

    const claimedSlot2 = await claimNewLetterRecipientsForSlot(otherSlot);
    await releaseLetterNotificationClaim("user-1", otherSlot, claimedSlot2[0]!.leaseId);

    const retrySlots = await findDeliverySlotsNeedingLetterPushRetry();
    expect(retrySlots.map((d) => d.getTime())).toEqual([otherSlot.getTime()]);
  });
});
