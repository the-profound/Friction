import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const column = (name: string) => ({ name });
  const tables = {
    scheduled: {
      id: column("space_scheduled_sends.id"),
      spaceId: column("space_scheduled_sends.space_id"),
      spaceLetterId: column("space_scheduled_sends.space_letter_id"),
      scheduledAt: column("space_scheduled_sends.scheduled_at"),
      sentAt: column("space_scheduled_sends.sent_at"),
      status: column("space_scheduled_sends.status"),
      recipientsSnapshottedAt: column("space_scheduled_sends.recipients_snapshotted_at"),
    },
    letters: {
      id: column("space_letters.id"),
      spaceId: column("space_letters.space_id"),
    },
    spaces: {
      id: column("spaces.id"),
      creatorId: column("spaces.creator_id"),
      status: column("spaces.status"),
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
  spaceParticipationsTable: state.tables.participations,
  spaceScheduledSendRecipientsTable: state.tables.recipients,
  spaceScheduledSendsTable: state.tables.scheduled,
  articlesTable: state.tables.articles,
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
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
    });

    expect(state.inserts).toHaveLength(2);
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
    });

    expect(state.inserts).toHaveLength(1);
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
    });

    expect(state.inserts).toHaveLength(1);
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
    });

    expect(state.updates).toHaveLength(0);
  });
});