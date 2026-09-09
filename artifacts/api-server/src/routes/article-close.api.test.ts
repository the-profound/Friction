import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "articles.ts"), "utf8");
const closeHandler = source.slice(
  source.indexOf('router.post("/articles/:id/close"'),
  source.indexOf('router.post("/articles/:id/finalize"'),
);

describe("article close endpoint contract", () => {
  it("persists the complete multi-page snapshot and status in one transaction", () => {
    expect(closeHandler).toContain("db.transaction(async (tx)");
    expect(closeHandler).toContain("pg_advisory_xact_lock");
    expect(closeHandler).toContain('.for("update")');
    expect(closeHandler).toContain('article.status !== "DIVIDING"');
    expect(closeHandler).toContain(
      '.set({ title, content, pages, status: "CLOSING" })',
    );
    expect(closeHandler).toContain('eq(articlesTable.status, "DIVIDING")');
    expect(closeHandler).toContain(
      "Article changed before the close completed",
    );
  });

  it("converges same-snapshot retries but rejects a conflicting close", () => {
    expect(closeHandler).toContain("const isSameSnapshot");
    expect(closeHandler).toContain('article.status === "CLOSING"');
    expect(closeHandler).toContain("if (isSameSnapshot) return { status: 200");
    expect(closeHandler).toContain(
      "Article is already CLOSING with a different snapshot",
    );
    expect(closeHandler).toContain("JSON.stringify(article.pages)");
  });
});
