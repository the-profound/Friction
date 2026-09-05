import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(join(__dirname, "stored-sentences.ts"), "utf8");
const spec = readFileSync(join(__dirname, "../../../../lib/api-spec/openapi.yaml"), "utf8");

describe("stored sentence source contract", () => {
  it("joins the article author for every shared sentence response path", () => {
    expect(route).toContain("articleAuthorName: usersTable.nickname");
    expect(route).toContain(".leftJoin(usersTable, eq(articlesTable.authorId, usersTable.id))");
    expect(route.match(/selectSentences\(\)/g)?.length).toBe(5);
  });

  it("publishes the nullable author display name in OpenAPI", () => {
    const schema = spec.slice(spec.indexOf("    StoredSentence:"), spec.indexOf("    CreateStoredSentenceBody:"));
    expect(schema).toContain("articleAuthorName:");
    expect(schema).toContain("articleAuthorName,");
  });

  it("accepts manual sentences without an article and returns their custom source", () => {
    const responseSchema = spec.slice(spec.indexOf("    StoredSentence:"), spec.indexOf("    CreateStoredSentenceBody:"));
    const createSchema = spec.slice(spec.indexOf("    CreateStoredSentenceBody:"), spec.indexOf("    # ─── Reading"));
    expect(route).toContain("sourceText: storedSentencesTable.sourceText");
    expect(route).toContain("articleId: articleId ?? null");
    expect(route).toContain("sourceText: sourceText?.trim() || null");
    expect(responseSchema).toContain("sourceText:");
    expect(responseSchema).toContain("sourceText,");
    expect(createSchema).toContain("required: [userId, text]");
  });
});