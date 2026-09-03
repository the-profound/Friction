import { describe, expect, it } from "vitest";
import type { InboxItem, SpaceListItem } from "@workspace/api-client-react";

import {
  buildReplySendTarget,
  filterActiveParticipatingSpaces,
  filterReadReplyLetters,
  resolveInitialSendDefaults,
} from "./sendPickerPresentation";

const article = (id: string, status: "LETTER" | "CLOSING" = "LETTER") => ({
  id,
  status,
  title: id,
  authorId: "author",
  content: "content",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const inboxItem = (
  id: string,
  articleId: string,
  visibleAt: string,
  isRead: boolean,
): InboxItem => ({
  id,
  articleId,
  article: article(articleId),
  recipientId: "recipient",
  senderId: "sender",
  senderDisplayName: "보낸 사람",
  visibleAt,
  isRead,
  createdAt: visibleAt,
  isReplyToMe: false,
  hasReadBefore: isRead,
  isEnvelope: false,
});

describe("send picker presentation", () => {
  it("defaults to person without a linked original, and reply with the exact linked inbox when available", () => {
    const linkedInbox = inboxItem(
      "linked-inbox",
      "original-article",
      "2026-09-02T00:00:00.000Z",
      true,
    );
    const unrelatedInbox = inboxItem(
      "unrelated-inbox",
      "other-article",
      "2026-09-01T00:00:00.000Z",
      true,
    );

    expect(resolveInitialSendDefaults(null, [linkedInbox])).toEqual({
      mode: "person",
      replyInbox: null,
    });
    expect(
      resolveInitialSendDefaults(
        { sourceArticleId: "original-article" },
        [unrelatedInbox, linkedInbox],
      ),
    ).toEqual({
      mode: "reply",
      replyInbox: linkedInbox,
    });
  });

  it("keeps the exact selected inbox when one article was received more than once", () => {
    const older = inboxItem(
      "selected-older-inbox",
      "shared-article",
      "2026-09-01T00:00:00.000Z",
      true,
    );
    older.senderId = "selected-sender";
    const newer = inboxItem(
      "newer-inbox",
      "shared-article",
      "2026-09-02T00:00:00.000Z",
      true,
    );
    newer.senderId = "newer-sender";

    expect(buildReplySendTarget(older)).toEqual({
      replyToInboxId: "selected-older-inbox",
    });
  });

  it("keeps every visible read delivery newest first, including repeated articles", () => {
    const items = [
      inboxItem("old", "article-1", "2026-09-01T00:00:00.000Z", true),
      inboxItem("new", "article-2", "2026-09-02T00:00:00.000Z", true),
      inboxItem("duplicate", "article-2", "2026-09-01T12:00:00.000Z", true),
      inboxItem("unread", "article-3", "2026-09-02T01:00:00.000Z", false),
      inboxItem("future", "article-4", "2026-09-04T00:00:00.000Z", true),
    ];

    expect(
      filterReadReplyLetters(items, Date.parse("2026-09-03T00:00:00.000Z")).map(
        (item) => item.id,
      ),
    ).toEqual(["new", "duplicate", "old"]);
  });

  it("does not treat an incomplete article as a reply source", () => {
    const item = inboxItem(
      "closing",
      "closing-article",
      "2026-09-02T00:00:00.000Z",
      true,
    );
    item.article = article("closing-article", "CLOSING");

    expect(
      filterReadReplyLetters([item], Date.parse("2026-09-03T00:00:00.000Z")),
    ).toEqual([]);
  });

  it("keeps only active spaces with an approved participating role", () => {
    const makeSpace = (
      id: string,
      status: "ACTIVE" | "RECRUITING",
      myRole: "OPERATOR" | "PARTICIPANT",
    ) =>
      ({
        id,
        name: id,
        status,
        myRole,
      }) as SpaceListItem;

    expect(
      filterActiveParticipatingSpaces([
        makeSpace("active-operator", "ACTIVE", "OPERATOR"),
        makeSpace("active-member", "ACTIVE", "PARTICIPANT"),
        makeSpace("recruiting", "RECRUITING", "PARTICIPANT"),
      ]).map((space) => space.id),
    ).toEqual(["active-operator", "active-member"]);
  });
});