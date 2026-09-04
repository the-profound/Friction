import { describe, expect, it } from "vitest";
import {
  getInboxReaderEntry,
  getInboxReadingMode,
  shouldCommitCompletionForEntry,
} from "./policies";

describe("reading completion entry policy", () => {
  it("opens an unread reply directly even when its source has not been read", () => {
    expect(getInboxReaderEntry({
      id: "reply-inbox",
      articleId: "reply-article",
      isRead: false,
      hasReadBefore: false,
      replyToArticleId: "source-article",
      hasReadSourceArticle: false,
    })).toEqual({
      articleId: "reply-article",
      inboxId: "reply-inbox",
      mode: "basic",
    });
  });

  it("opens a regular unread delivery through the same direct-entry rule", () => {
    expect(getInboxReaderEntry({
      id: "regular-inbox",
      articleId: "regular-article",
      isRead: false,
      hasReadBefore: false,
    })).toEqual({
      articleId: "regular-article",
      inboxId: "regular-inbox",
      mode: "basic",
    });
  });

  it("preserves reread mode and inbox completion ownership", () => {
    const entry = getInboxReaderEntry({
      id: "reread-inbox",
      articleId: "reread-article",
      isRead: false,
      hasReadBefore: true,
    });

    expect(entry).toEqual({
      articleId: "reread-article",
      inboxId: "reread-inbox",
      mode: "re_read",
    });
    expect(shouldCommitCompletionForEntry(entry.mode, entry.inboxId)).toBe(true);
  });

  it("opens a previously completed article delivered as unread in reread mode", () => {
    expect(getInboxReadingMode(false, true)).toBe("re_read");
  });

  it("keeps unread first reads in the normal completion mode", () => {
    expect(getInboxReadingMode(false, false)).toBe("basic");
  });

  it("keeps already-read deliveries in reread mode", () => {
    expect(getInboxReadingMode(true, false)).toBe("re_read");
  });

  it("commits a reread opened from an inbox delivery", () => {
    expect(shouldCommitCompletionForEntry("re_read", "inbox-delivery")).toBe(true);
  });

  it("does not add inbox work to a reread opened outside the inbox", () => {
    expect(shouldCommitCompletionForEntry("re_read")).toBe(false);
  });

  it("keeps the normal completion commit for a first-read inbox or list entry", () => {
    expect(shouldCommitCompletionForEntry("basic")).toBe(true);
    expect(shouldCommitCompletionForEntry("basic", "inbox-delivery")).toBe(true);
  });
});