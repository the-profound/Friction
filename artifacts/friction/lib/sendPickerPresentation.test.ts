import { describe, expect, it } from "vitest";
import type { InboxItem, SpaceListItem } from "@workspace/api-client-react";

import {
  buildReplySendTarget,
  defaultSendSpaceLetterVisibility,
  filterActiveParticipatingSpaces,
  filterReadReplyLetters,
  getSendArticleAuthorName,
  resolveInitialSendDefaults,
  resolvePrefillArticleState,
  resolveSendSpaceLetterVisibilitySelection,
  sortAndFilterLetterPickerItems,
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
  it("uses a stable author label when the article list has no nickname", () => {
    expect(getSendArticleAuthorName({ authorNickname: "  민지  " })).toBe(
      "민지",
    );
    expect(getSendArticleAuthorName({ authorNickname: null })).toBe(
      "알 수 없음",
    );
    expect(getSendArticleAuthorName({ authorNickname: "   " })).toBe(
      "알 수 없음",
    );
  });

  it("resolves a cached prefill immediately and terminates cold-load failures", () => {
    const cached = article("cached") as never;
    expect(
      resolvePrefillArticleState({
        prefillArticleId: "cached",
        articles: [cached],
        isLoading: true,
        isError: false,
      }),
    ).toEqual({ kind: "ready", article: cached });
    expect(
      resolvePrefillArticleState({
        prefillArticleId: "missing",
        articles: [],
        isLoading: true,
        isError: false,
      }),
    ).toEqual({ kind: "loading" });
    expect(
      resolvePrefillArticleState({
        prefillArticleId: "missing",
        articles: [],
        isLoading: false,
        isError: true,
      }),
    ).toEqual({ kind: "error" });
    expect(
      resolvePrefillArticleState({
        prefillArticleId: "missing",
        articles: [],
        isLoading: false,
        isError: false,
      }),
    ).toEqual({ kind: "missing" });
  });

  it("replaces an entry snapshot with the latest server letter of the same id", () => {
    const snapshot = {
      ...article("same"),
      title: "이전 제목",
    } as never;
    const current = {
      ...article("same"),
      title: "최신 제목",
    } as never;

    expect(
      resolvePrefillArticleState({
        prefillArticleId: "same",
        articles: [snapshot],
        isLoading: true,
        isError: false,
      }),
    ).toEqual({ kind: "ready", article: snapshot });
    expect(
      resolvePrefillArticleState({
        prefillArticleId: "same",
        articles: [current],
        isLoading: false,
        isError: false,
      }),
    ).toEqual({ kind: "ready", article: current });
  });

  it("sorts picker letters newest first and searches titles case-insensitively", () => {
    const items = [
      { id: "old", title: "오래된 안부", sortAt: "2026-09-01T00:00:00.000Z" },
      { id: "new", title: "NEW 안부", sortAt: "2026-09-03T00:00:00.000Z" },
      { id: "middle", title: "다른 편지", sortAt: "2026-09-02T00:00:00.000Z" },
    ];

    expect(
      sortAndFilterLetterPickerItems(items, "").map((item) => item.id),
    ).toEqual(["new", "middle", "old"]);
    expect(
      sortAndFilterLetterPickerItems(items, "new").map((item) => item.id),
    ).toEqual(["new"]);
  });

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
      resolveInitialSendDefaults({ sourceArticleId: "original-article" }, [
        unrelatedInbox,
        linkedInbox,
      ]),
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

  it("shows a synchronized delivery as soon as its isRead cache value changes", () => {
    const item = inboxItem(
      "space-delivery",
      "space-article",
      "2026-09-02T00:00:00.000Z",
      false,
    );
    const now = Date.parse("2026-09-03T00:00:00.000Z");

    expect(filterReadReplyLetters([item], now)).toEqual([]);
    expect(filterReadReplyLetters([{ ...item, isRead: true }], now)).toHaveLength(1);
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

  it("defaults regular space sends to public and anonymous space sends to recipient-only", () => {
    expect(defaultSendSpaceLetterVisibility({ isAnonymous: false })).toBe(
      "PUBLIC",
    );
    expect(defaultSendSpaceLetterVisibility({ isAnonymous: true })).toBe(
      "RECIPIENT_ONLY",
    );
  });

  it("keeps a regular-space choice for retry/reselection and resets when the target policy changes", () => {
    const regular = { id: "regular", isAnonymous: false };
    expect(resolveSendSpaceLetterVisibilitySelection({
      previousSpace: regular,
      previousVisibility: "RECIPIENT_ONLY",
      nextSpace: regular,
    })).toBe("RECIPIENT_ONLY");
    expect(resolveSendSpaceLetterVisibilitySelection({
      previousSpace: regular,
      previousVisibility: "RECIPIENT_ONLY",
      nextSpace: { id: "other", isAnonymous: false },
    })).toBe("PUBLIC");
    expect(resolveSendSpaceLetterVisibilitySelection({
      previousSpace: regular,
      previousVisibility: "PUBLIC",
      nextSpace: { id: "anonymous", isAnonymous: true },
    })).toBe("RECIPIENT_ONLY");
  });
});
