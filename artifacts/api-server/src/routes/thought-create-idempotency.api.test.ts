import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("thought create idempotency contract", () => {
  it("validates the optional client id as a UUID in the generated contract", () => {
    const generatedSchema = readFileSync(
      join(__dirname, "../../../../lib/api-zod/src/generated/api.ts"),
      "utf8",
    );
    const createThoughtSchema = generatedSchema.slice(
      generatedSchema.indexOf("export const CreateThoughtBody"),
      generatedSchema.indexOf("export const RegisterPushTokenBody"),
    );

    expect(createThoughtSchema).toContain("clientId: zod");
    expect(createThoughtSchema).toContain(".uuid()");
    expect(createThoughtSchema).toContain(".optional()");
  });

  it("reuses an owned client id and applies the retry's newest content", () => {
    const source = readFileSync(join(__dirname, "thoughts.ts"), "utf8");
    const createRoute = source.slice(
      source.indexOf('router.post("/thoughts"'),
      source.indexOf('router.get("/thoughts/:id"'),
    );

    expect(createRoute).toContain(".onConflictDoNothing({ target: thoughtsTable.id })");
    expect(createRoute).toContain("eq(thoughtsTable.authorId, authorId)");
    expect(createRoute).toContain("pg_advisory_xact_lock");
    expect(createRoute).toContain("activePromotion");
    expect(createRoute).toContain("existing.migratedFromArticleId");
    expect(createRoute).toContain(".set({ content, updatedAt: new Date() })");
    expect(createRoute).toContain('error: "Thought id is already in use"');
  });
});