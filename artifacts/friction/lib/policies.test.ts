import { describe, expect, it } from "vitest";
import { getInboxReadingMode, shouldCommitCompletionForEntry } from "./policies";

describe("reading completion entry policy", () => {
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