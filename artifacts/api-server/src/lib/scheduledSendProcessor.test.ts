import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const column = (name: string) => ({ name });
  const tables = {
    scheduled: {
      id: column("space_scheduled_sends.id"),
      spaceId: column("space_scheduled_sends.space_id"),
      spaceLetterId: column("space_scheduled_sends.space_letter_id"),
      slotId: column("space_scheduled_sends.slot_id"),
      reservedRoundId: column("space_scheduled_sends.reserved_round_id"),
      reservationAuthorId: column("space_scheduled_sends.reservation_author_id"),
      scheduledAt: column("space_scheduled_sends.scheduled_at"),
      sentAt: column("space_scheduled_sends.sent_at"),
      status: column("space_scheduled_sends.status"),
      failureReason: column("space_scheduled_sends.failure_reason"),
      reservedDate: column("space_scheduled_sends.reserved_date"),
      createdAt: column("space_scheduled_sends.created_at"),
      recipientsSnapshottedAt: column("space_scheduled_sends.recipients_snapshotted_at"),
    },
    letters: {
      id: column("space_letters.id"),
      spaceId: column("space_letters.space_id"),
    },
    slots: {
      id: column("space_round_slots.id"),
      spaceRoundId: column("space_round_slots.space_round_id"),
      assignedUserId: column("space_round_slots.assigned_user_id"),
      scheduledDate: column("space_round_slots.scheduled_date"),
    },
    spaces: {
      id: column("spaces.id"),
      creatorId: column("spaces.creator_id"),
      status: column("spaces.status"),
    },
    rounds: {
      id: column("space_rounds.id"),
      status: column("space_rounds.status"),
      startsAt: column("space_rounds.starts_at"),
      endsAt: column("space_rounds.ends_at"),
    },
    articles: {
      id: column("articles.id"),
      status: column("articles.status"),
      deletedAt: column("articles.deleted_at"),
    },
    participations: {
      spaceId: column("space_participations.space_id"),
      userId: column("space_participations.user_id"),
      status: column("space_participations.status"),
      createdAt: column("space_participations.created_at"),
      updatedAt: column("space_participations.updated_at"),
    },
    inbox: {
      recipientId: column("inbox.recipient_id"),
      sourceSpaceScheduledSendId: column("inbox.source_space_scheduled_send_id"),
    },
    recipients: {
      scheduledSendId: column("space_scheduled_send_recipients.scheduled_send_id"),
      recipientId: column("space_scheduled_send_recipients.recipient_id"),
    },
    recipientAccess: {
      letterId: column("letter_recipient_access.letter_id"),
      userId: column("letter_recipient_access.user_id"),
    },
  };
  const responses: unknown[][] = [];
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: unknown[] = [];
  let insertError: Error | null = null;

  const db: any = {
    execute: vi.fn(async () => []),
    transaction: async (callback: (tx: any) => unknown) => callback(db),
    select: () => {
      const rows = responses.shift() ?? [];
      const chain: any = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(rows),
        then: (
          resolve: (value: unknown[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoNothing: async () => {
          if (insertError) throw insertError;
          inserts.push({ table, values });
        },
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          updates.push(values);
          return [];
        },
      }),
    }),
  };

  return {
    db,
    tables,
    responses,
    inserts,
    updates,
    setInsertError(error: Error | null) {
      insertError = error;
    },
  };
});

vi.mock("@workspace/db", () => ({
  db: state.db,
  inboxTable: state.tables.inbox,
  spacesTable: state.tables.spaces,
  spaceLettersTable: state.tables.letters,
  spaceRoundsTable: state.tables.rounds,
  spaceRoundSlotsTable: state.tables.slots,
  spaceParticipationsTable: state.tables.participations,
  spaceScheduledSendRecipientsTable: state.tables.recipients,
  letterRecipientAccessTable: state.tables.recipientAccess,
  spaceScheduledSendsTable: state.tables.scheduled,
  articlesTable: state.tables.articles,
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  processDueScheduledSends,
  resolveSpaceDeliveryRecipientIds,
} = await import("./scheduledSendProcessor");

const dueSend = (overrides: Record<string, unknown> = {}) => ({
  id: "send-1",
  spaceId: "space-1",
  spaceLetterId: "letter-1",
  scheduledAt: new Date("2020-01-01T00:00:00.000Z"),
  sentAt: null,
  status: "PENDING",
  recipientsSnapshottedAt: null,
  createdAt: new Date("2019-12-01T00:00:00.000Z"),
  ...overrides,
});

const letter = {
  id: "letter-1",
  spaceId: "space-1",
  authorId: "author-1",
  sourceArticleId: "article-1",
};

const space = {
  id: "space-1",
  creatorId: "operator-1",
  status: "ACTIVE",
};

const readableArticle = {
  id: "article-1",
  status: "LETTER",
  deletedAt: null,
};

const activeRound = {
  status: "ACTIVE",
  startsAt: new Date("2019-12-01T00:00:00.000Z"),
  endsAt: new Date("2099-12-31T00:00:00.000Z"),
};

function queueSuccessfulDelivery(send = dueSend()) {
  state.responses.push(
    [{ id: "send-1" }],
    [send],
    [letter],
    [space],
    [readableArticle],
    [],
    [{ userId: "participant-1" }, { userId: "author-1" }],
  );
}

describe("space scheduled-send delivery", () => {
  beforeEach(() => {
    state.responses.length = 0;
    state.inserts.length = 0;
    state.updates.length = 0;
    state.setInsertError(null);
    vi.clearAllMocks();
  });

  it("always includes the operator and excludes the author", () => {
    expect(
      resolveSpaceDeliveryRecipientIds({
        authorId: "author",
        creatorId: "operator",
        approvedParticipantIds: ["author", "participant", "participant"],
      }).sort(),
    ).toEqual(["operator", "participant"]);

    expect(
      resolveSpaceDeliveryRecipientIds({
        authorId: "operator",
        creatorId: "operator",
        approvedParticipantIds: ["participant"],
      }),
    ).toEqual(["participant"]);
  });

  it("creates reservation-keyed rows before marking the send SENT", async () => {
    queueSuccessfulDelivery();

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 1,
      failedCount: 0,
      affectedSlots: [new Date("2020-01-01T00:00:00.000Z")],
    });

    expect(state.inserts).toHaveLength(3);
    const inboxInsert = state.inserts.find(
      (entry) => entry.table === state.tables.inbox,
    );
    expect(inboxInsert?.values).toEqual([
      expect.objectContaining({
        recipientId: "participant-1",
        articleId: "article-1",
        senderId: "author-1",
        sourceSpaceId: "space-1",
        sourceSpaceScheduledSendId: "send-1",
      }),
      expect.objectContaining({
        recipientId: "operator-1",
        sourceSpaceId: "space-1",
        sourceSpaceScheduledSendId: "send-1",
      }),
    ]);
    expect(state.updates).toContainEqual(
      expect.objectContaining({ status: "SENT", failureReason: null }),
    );
  });

  it("repairs a historical SENT reservation without rewriting its status", async () => {
    queueSuccessfulDelivery(
      dueSend({
        status: "SENT",
        sentAt: new Date("2020-01-01T00:05:00.000Z"),
        recipientsSnapshottedAt: new Date("2020-01-01T00:05:00.000Z"),
      }),
    );
    state.responses.splice(
      5,
      1,
      [{ recipientId: "participant-1" }, { recipientId: "operator-1" }],
    );

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 0,
      failedCount: 0,
      affectedSlots: [new Date("2020-01-01T00:00:00.000Z")],
    });

    expect(state.inserts).toHaveLength(2);
    expect(state.updates).toHaveLength(0);
  });

  it("repairs a historical SENT reservation after the space is archived", async () => {
    const archivedSpace = { ...space, status: "ARCHIVED" };
    state.responses.push(
      [{ id: "send-1" }],
      [
        dueSend({
          status: "SENT",
          sentAt: new Date("2020-01-01T00:05:00.000Z"),
          recipientsSnapshottedAt: new Date("2020-01-01T00:05:00.000Z"),
        }),
      ],
      [letter],
      [archivedSpace],
      [readableArticle],
      [{ recipientId: "participant-1" }, { recipientId: "operator-1" }],
    );

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 0,
      failedCount: 0,
      affectedSlots: [new Date("2020-01-01T00:00:00.000Z")],
    });

    expect(state.inserts).toHaveLength(2);
    expect(state.updates).toHaveLength(0);
  });

  it("marks a missing or unreadable source article as FAILED without delivery", async () => {
    state.responses.push(
      [{ id: "send-1" }],
      [dueSend()],
      [letter],
      [space],
      [{ ...readableArticle, status: "DRAFT" }],
    );

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 0,
      failedCount: 1,
      affectedSlots: [],
    });

    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toEqual([
      expect.objectContaining({
        status: "FAILED",
        sentAt: null,
      }),
    ]);
  });

  it("leaves a PENDING reservation retryable when inbox insertion fails", async () => {
    queueSuccessfulDelivery();
    state.setInsertError(new Error("temporary inbox failure"));

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 0,
      failedCount: 1,
      affectedSlots: [],
    });

    expect(state.updates).toHaveLength(0);
  });

  it("delivers a delayed CENTER send only from its immutable reserved slot identity", async () => {
    const centerSend = dueSend({
      slotId: "slot-1",
      reservedRoundId: "round-1",
      reservedDate: "2020-01-02",
      reservationAuthorId: "author-1",
      scheduledAt: new Date("2020-01-01T21:00:00.000Z"), // 06:00 KST
    });
    state.responses.push(
      [{ id: "send-1" }], [centerSend],
      [{ ...letter, letterType: "CENTER", spaceRoundId: "round-1" }],
      [space],
      [{ id: "slot-1", spaceRoundId: "round-1", assignedUserId: "author-1", scheduledDate: "2020-01-02" }],
      [readableArticle], [], [{ userId: "participant-1" }],
    );
    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 1,
      failedCount: 0,
      affectedSlots: [new Date("2020-01-01T21:00:00.000Z")],
    });
    expect(state.inserts.some((entry) => entry.table === state.tables.inbox)).toBe(true);
  });

  it("delivers a catch-up CENTER send at a later server-selected KST 06:00", async () => {
    const centerSend = dueSend({
      slotId: "slot-1",
      reservedRoundId: "round-1",
      reservedDate: "2019-12-30",
      reservationAuthorId: "author-1",
      scheduledAt: new Date("2020-01-01T21:00:00.000Z"), // 2020-01-02 06:00 KST
    });
    state.responses.push(
      [{ id: "send-1" }], [centerSend],
      [{ ...letter, letterType: "CENTER", spaceRoundId: "round-1" }],
      [space],
      [{ id: "slot-1", spaceRoundId: "round-1", assignedUserId: "author-1", scheduledDate: "2019-12-30" }],
      [readableArticle], [], [{ userId: "participant-1" }],
    );

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 1,
      failedCount: 0,
      affectedSlots: [new Date("2020-01-01T21:00:00.000Z")],
    });
  });

  it.each([
    ["non-06:00 delivery", { scheduledAt: new Date("2020-01-01T21:01:00.000Z") }],
    ["delivery before its reserved date", { scheduledAt: new Date("2019-12-28T21:00:00.000Z") }],
    ["missing round identity", { reservedRoundId: null }],
    ["wrong author identity", { reservationAuthorId: "author-2" }],
  ])("rejects a damaged catch-up CENTER identity: %s", async (_label, overrides) => {
    const centerSend = dueSend({
      slotId: "slot-1",
      reservedRoundId: "round-1",
      reservedDate: "2019-12-30",
      reservationAuthorId: "author-1",
      scheduledAt: new Date("2020-01-01T21:00:00.000Z"),
      ...overrides,
    });
    state.responses.push(
      [{ id: "send-1" }], [centerSend],
      [{ ...letter, letterType: "CENTER", spaceRoundId: "round-1" }],
      [space],
    );

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 0,
      failedCount: 1,
      affectedSlots: [],
    });
    expect(state.inserts).toHaveLength(0);
  });

  it("recovers only the exact legacy catch-up failure and remains idempotent", async () => {
    const failedCatchUp = dueSend({
      status: "FAILED",
      failureReason: "예약 당시의 회차·슬롯·날짜 정보가 완전하지 않거나 일치하지 않습니다.",
      slotId: "slot-1",
      reservedRoundId: "round-1",
      reservedDate: "2019-12-30",
      reservationAuthorId: "author-1",
      scheduledAt: new Date("2020-01-01T21:00:00.000Z"),
    });
    state.responses.push(
      [{ id: "send-1" }], [failedCatchUp],
      [{ ...letter, letterType: "CENTER", spaceRoundId: "round-1" }],
      [space],
      [space], [activeRound],
      [{ id: "slot-1", spaceRoundId: "round-1", assignedUserId: "author-1", scheduledDate: "2019-12-30" }],
      [failedCatchUp],
      [readableArticle], [], [{ userId: "participant-1" }],
    );

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 1,
      failedCount: 0,
      affectedSlots: [new Date("2020-01-01T21:00:00.000Z")],
    });
    expect(state.updates).toContainEqual(
      expect.objectContaining({ status: "SENT", failureReason: null }),
    );

    state.responses.push(
      [{ id: "send-1" }],
      [{ ...failedCatchUp, status: "SENT", failureReason: null, recipientsSnapshottedAt: new Date() }],
      [{ ...letter, letterType: "CENTER", spaceRoundId: "round-1" }],
      [space],
      [{ id: "slot-1", spaceRoundId: "round-1", assignedUserId: "author-1", scheduledDate: "2019-12-30" }],
      [readableArticle],
      [{ recipientId: "participant-1" }, { recipientId: "operator-1" }],
    );
    state.updates.length = 0;
    state.inserts.length = 0;

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 0,
      failedCount: 0,
      affectedSlots: [new Date("2020-01-01T21:00:00.000Z")],
    });
    expect(state.updates).toHaveLength(0);
  });

  it("does not recover a FAILED catch-up with any other failure reason", async () => {
    state.responses.push(
      [{ id: "send-1" }],
      [dueSend({
        status: "FAILED",
        failureReason: "원본 글을 읽을 수 없어 발신할 수 없습니다.",
        slotId: "slot-1",
        reservedRoundId: "round-1",
        reservedDate: "2019-12-30",
        reservationAuthorId: "author-1",
        scheduledAt: new Date("2020-01-01T21:00:00.000Z"),
      })],
    );

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 0,
      failedCount: 0,
      affectedSlots: [],
    });
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects legacy catch-up recovery after archival and retires the legacy reason", async () => {
    const failedCatchUp = dueSend({
      status: "FAILED",
      failureReason: "예약 당시의 회차·슬롯·날짜 정보가 완전하지 않거나 일치하지 않습니다.",
      slotId: "slot-1",
      reservedRoundId: "round-1",
      reservedDate: "2019-12-30",
      reservationAuthorId: "author-1",
      scheduledAt: new Date("2020-01-01T21:00:00.000Z"),
    });
    state.responses.push(
      [{ id: "send-1" }], [failedCatchUp],
      [{ ...letter, letterType: "CENTER", spaceRoundId: "round-1" }],
      [{ ...space, status: "ARCHIVED" }],
      [{ ...space, status: "ARCHIVED" }], [activeRound],
    );

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 0,
      failedCount: 1,
      affectedSlots: [],
    });
    expect(state.updates).toEqual([
      expect.objectContaining({
        status: "FAILED",
        failureReason: "존재하지 않거나 종료된 공간의 슬롯은 보충 발신할 수 없습니다.",
      }),
    ]);
    expect(state.inserts).toHaveLength(0);
  });

  it("recovers and delivers a legacy catch-up after its reserved round completes", async () => {
    const failedCatchUp = dueSend({
      status: "FAILED",
      failureReason: "예약 당시의 회차·슬롯·날짜 정보가 완전하지 않거나 일치하지 않습니다.",
      slotId: "slot-1",
      reservedRoundId: "round-1",
      reservedDate: "2019-12-30",
      reservationAuthorId: "author-1",
      scheduledAt: new Date("2020-01-01T21:00:00.000Z"),
    });
    state.responses.push(
      [{ id: "send-1" }], [failedCatchUp],
      [{ ...letter, letterType: "CENTER", spaceRoundId: "round-1" }],
      [space],
      [space],
      [{
        status: "ACTIVE",
        startsAt: new Date("2019-12-01T00:00:00.000Z"),
        endsAt: new Date("2020-01-31T00:00:00.000Z"),
      }],
      [{ id: "slot-1", spaceRoundId: "round-1", assignedUserId: "author-1", scheduledDate: "2019-12-30" }],
      [failedCatchUp],
      [readableArticle], [], [{ userId: "participant-1" }],
    );

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 1,
      failedCount: 0,
      affectedSlots: [new Date("2020-01-01T21:00:00.000Z")],
    });
    expect(state.updates).toContainEqual(
      expect.objectContaining({
        status: "SENT",
        failureReason: null,
      }),
    );
    expect(state.inserts.some((entry) => entry.table === state.tables.inbox)).toBe(true);
  });

  it("retires the legacy reason when recovery finds a newly unreadable article", async () => {
    const failedCatchUp = dueSend({
      status: "FAILED",
      failureReason: "예약 당시의 회차·슬롯·날짜 정보가 완전하지 않거나 일치하지 않습니다.",
      slotId: "slot-1",
      reservedRoundId: "round-1",
      reservedDate: "2019-12-30",
      reservationAuthorId: "author-1",
      scheduledAt: new Date("2020-01-01T21:00:00.000Z"),
    });
    state.responses.push(
      [{ id: "send-1" }], [failedCatchUp],
      [{ ...letter, letterType: "CENTER", spaceRoundId: "round-1" }],
      [space],
      [space], [activeRound],
      [{ id: "slot-1", spaceRoundId: "round-1", assignedUserId: "author-1", scheduledDate: "2019-12-30" }],
      [failedCatchUp],
      [{ ...readableArticle, status: "DRAFT" }],
    );

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 0,
      failedCount: 1,
      affectedSlots: [],
    });
    expect(state.updates).toEqual([
      expect.objectContaining({
        status: "FAILED",
        failureReason: "원본 글을 읽을 수 없어 발신할 수 없습니다.",
      }),
    ]);
    expect(state.inserts).toHaveLength(0);
  });

  it.each(["PENDING", "SENT"] as const)(
    "does not recover a legacy failure when the same slot has a %s attempt",
    async (competingStatus) => {
      const failedCatchUp = dueSend({
        status: "FAILED",
        failureReason: "예약 당시의 회차·슬롯·날짜 정보가 완전하지 않거나 일치하지 않습니다.",
        slotId: "slot-1",
        reservedRoundId: "round-1",
        reservedDate: "2019-12-30",
        reservationAuthorId: "author-1",
        scheduledAt: new Date("2020-01-01T21:00:00.000Z"),
      });
      state.responses.push(
        [{ id: "send-1" }], [failedCatchUp],
        [{ ...letter, letterType: "CENTER", spaceRoundId: "round-1" }],
        [space],
        [space], [activeRound],
        [{ id: "slot-1", spaceRoundId: "round-1", assignedUserId: "author-1", scheduledDate: "2019-12-30" }],
        [
          failedCatchUp,
          {
            ...failedCatchUp,
            id: "send-2",
            status: competingStatus,
            failureReason: null,
            createdAt: new Date("2019-12-02T00:00:00.000Z"),
          },
        ],
      );

      await expect(processDueScheduledSends()).resolves.toEqual({
        sentCount: 0,
        failedCount: 0,
        affectedSlots: [],
      });
      expect(state.inserts).toHaveLength(0);
      expect(state.updates).toEqual([
        expect.objectContaining({
          failureReason: "동일 슬롯의 다른 예약이 이미 대기 중이거나 발신되었습니다.",
        }),
      ]);
    },
  );

  it("recovers only the newest of multiple legacy failures for the same slot", async () => {
    const olderFailure = dueSend({
      status: "FAILED",
      failureReason: "예약 당시의 회차·슬롯·날짜 정보가 완전하지 않거나 일치하지 않습니다.",
      slotId: "slot-1",
      reservedRoundId: "round-1",
      reservedDate: "2019-12-30",
      reservationAuthorId: "author-1",
      scheduledAt: new Date("2020-01-01T21:00:00.000Z"),
    });
    const newerFailure = {
      ...olderFailure,
      id: "send-2",
      createdAt: new Date("2019-12-02T00:00:00.000Z"),
    };
    state.responses.push(
      [{ id: "send-1" }], [olderFailure],
      [{ ...letter, letterType: "CENTER", spaceRoundId: "round-1" }],
      [space],
      [space], [activeRound],
      [{ id: "slot-1", spaceRoundId: "round-1", assignedUserId: "author-1", scheduledDate: "2019-12-30" }],
      [olderFailure, newerFailure],
    );

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 0,
      failedCount: 0,
      affectedSlots: [],
    });
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toEqual([
      expect.objectContaining({
        failureReason: "동일 슬롯의 더 최신 실패 예약이 복구 대상으로 선택되었습니다.",
      }),
    ]);
  });

  it("processing the same due reservation twice in quick succession is a safe no-op the second time — e.g. the exact-06:00 trigger and the periodic sweep racing", async () => {
    // First run: PENDING -> SENT, inbox rows committed. Simulates the
    // exact-06:00 trigger (or whichever of the two triggers wins the race)
    // delivering the reservation.
    queueSuccessfulDelivery();

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 1,
      failedCount: 0,
      affectedSlots: [new Date("2020-01-01T00:00:00.000Z")],
    });
    // One update snapshots recipients (recipientsSnapshottedAt), the other
    // transitions PENDING -> SENT.
    expect(state.updates).toHaveLength(2);
    expect(state.updates).toContainEqual(
      expect.objectContaining({ status: "SENT", failureReason: null }),
    );
    state.updates.length = 0;
    state.inserts.length = 0;

    // Second run moments later (e.g. the periodic 5-minute poll firing right
    // after the exact-06:00 trigger already delivered it): the row is now
    // SENT with a recorded recipient snapshot, so this must only repair
    // (idempotent onConflictDoNothing inserts) and never re-transition the
    // status or double up the delivery.
    state.responses.push(
      [{ id: "send-1" }],
      [
        dueSend({
          status: "SENT",
          sentAt: new Date("2020-01-01T00:00:05.000Z"),
          recipientsSnapshottedAt: new Date("2020-01-01T00:00:05.000Z"),
        }),
      ],
      [letter],
      [space],
      [readableArticle],
      [{ recipientId: "participant-1" }, { recipientId: "operator-1" }],
    );

    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 0,
      failedCount: 0,
      affectedSlots: [new Date("2020-01-01T00:00:00.000Z")],
    });
    expect(state.updates).toHaveLength(0);
  });

  it("fails a CENTER send whose slot was deleted or reassigned without inbox delivery", async () => {
    const centerSend = dueSend({
      slotId: "slot-1", reservedRoundId: "round-1", reservedDate: "2020-01-02",
      reservationAuthorId: "author-1", scheduledAt: new Date("2020-01-01T21:00:00.000Z"),
    });
    state.responses.push(
      [{ id: "send-1" }], [centerSend],
      [{ ...letter, letterType: "CENTER", spaceRoundId: "round-1" }],
      [space], [], // deleted slot
    );
    await expect(processDueScheduledSends()).resolves.toEqual({
      sentCount: 0,
      failedCount: 1,
      affectedSlots: [],
    });
    expect(state.inserts.some((entry) => entry.table === state.tables.inbox)).toBe(false);
  });
});