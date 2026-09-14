import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./inbox.ts", import.meta.url)),
  "utf8",
);

describe("article-scoped inbox read synchronization", () => {
  it("updates every unread row for only the requested recipient and article", () => {
    const start = source.indexOf('router.post("/inbox/article/:articleId/read-others"');
    const end = source.indexOf("\n});", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const handler = source.slice(start, end);

    expect(handler).toContain("eq(inboxTable.recipientId, recipientId)");
    expect(handler).toContain("eq(inboxTable.articleId, articleId)");
    expect(handler).toContain("eq(inboxTable.isRead, false)");
    expect(handler).toContain(".set({ isRead: true })");
    expect(handler).not.toContain("sourceSpaceScheduledSendId");
    expect(handler).not.toContain("sourceTeamCollectionId");
  });
});