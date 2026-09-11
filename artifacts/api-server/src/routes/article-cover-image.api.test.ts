import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VerifyArticleCoverUploadResponse } from "@workspace/api-zod";

const source = readFileSync(join(__dirname, "articles.ts"), "utf8");
const verifyHandler = source.slice(
  source.indexOf('router.post(\n  "/articles/:id/cover-image/verify"'),
  source.indexOf('router.delete("/articles/:id"'),
);
const storageSource = readFileSync(
  join(__dirname, "../lib/objectStorage.ts"),
  "utf8",
);

describe("article cover-image verification contract", () => {
  it("verifies and saves the server-owned image cover in one locked mutation", () => {
    expect(verifyHandler).toContain("db.transaction(async (tx)");
    expect(verifyHandler).toContain('.for("update")');
    expect(verifyHandler).toContain("verifyAndPublishCoverImage(");
    expect(verifyHandler).toContain("const imageUrl = `/api/storage${objectPath}`");
    expect(verifyHandler).toContain("...parsed.data.cover");
    expect(verifyHandler).toContain('type: "image" as const');
    expect(verifyHandler).toContain("imageUrl,");
    expect(verifyHandler).toContain(".set({ cover })");
    expect(verifyHandler).toContain(
      "VerifyArticleCoverUploadResponse.parse({ imageUrl, cover })",
    );
  });

  it("keeps verification and final article-save failures actionable and distinct", () => {
    expect(verifyHandler).toContain("COVER_IMAGE_STAGING_NOT_FOUND");
    expect(verifyHandler).toContain("COVER_IMAGE_INVALID");
    expect(verifyHandler).toContain("COVER_IMAGE_VERIFY_FAILED");
    expect(verifyHandler).toContain("COVER_IMAGE_SAVE_FAILED");
    expect(verifyHandler).toContain("COVER_IMAGE_SAVE_CONFLICT");
  });

  it("accepts the server-relative path that is persisted on the article", () => {
    expect(
      VerifyArticleCoverUploadResponse.parse({
        imageUrl: "/api/storage/objects/cover-images/article-id/upload-1.jpg",
        cover: {
          type: "image",
          imageUrl: "/api/storage/objects/cover-images/article-id/upload-1.jpg",
          textColor: "#18181B",
          fontFamily: "sans",
          align: "left",
        },
      }),
    ).toMatchObject({
      cover: {
        imageUrl: "/api/storage/objects/cover-images/article-id/upload-1.jpg",
      },
    });
  });

  it("publishes an idempotent immutable target for an interrupted retry", () => {
    expect(storageSource).toContain("stagingObjectId");
    expect(storageSource).toContain("${stagingObjectId}-${generation}.${detected.extension}");
    expect(storageSource).toContain("ifGenerationMatch: 0");
    expect(storageSource).toContain("statusCode !== 412");
    expect(storageSource).toContain("destination.download()");
    expect(storageSource).toContain("equals(Buffer.from(bytes))");
  });
});