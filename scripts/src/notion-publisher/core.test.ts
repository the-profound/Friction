import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  QUEUE_PROPERTY_MAPPING,
  batchBlocks,
  cleanNotionUrl,
  contentHash,
  extractTitle,
  markdownToBlocks,
  normalizeCodeLanguage,
  splitRichText,
  validatePropertyMapping,
  type ExistingDocument,
  type NotionBlock,
  type NotionTransport,
} from "./core.js";
import { clearPublisherCaches, publishMarkdownFile } from "./publisher.js";

test("extracts first heading and computes deterministic hashes", () => {
  const markdown = "intro\n## First title\nbody";
  assert.equal(extractTitle(markdown), "First title");
  assert.equal(contentHash(markdown), contentHash(markdown));
  assert.notEqual(contentHash(markdown), contentHash(`${markdown}!`));
});

test("cleans database URLs without exposing query values", () => {
  assert.equal(cleanNotionUrl("https://www.notion.so/example?v=secret#x"), "https://www.notion.so/example");
  assert.throws(() => cleanNotionUrl("https://example.com/db"), /Notion URL/);
});

test("converts markdown and respects rich-text and batch limits", () => {
  const markdown = `# Title\n\n- bullet\n1. number\n\n\`\`\`ts\n${"x".repeat(4_100)}\n\`\`\``;
  const blocks = markdownToBlocks(markdown);
  assert.deepEqual(blocks.slice(0, 3).map((item) => item.type), [
    "heading_1",
    "bulleted_list_item",
    "numbered_list_item",
  ]);
  assert.equal(splitRichText("x".repeat(4_100)).length, 3);
  assert.equal(batchBlocks(Array.from({ length: 205 }, () => blocks[0]!)).length, 3);
  const code = blocks.find((item) => item.type === "code") as unknown as {
    code: { language: string };
  };
  assert.equal(code.code.language, "typescript");
  assert.equal(normalizeCodeLanguage("tsx"), "typescript");
  assert.equal(normalizeCodeLanguage("unknown-language"), "plain text");
});

class FakeTransport implements NotionTransport {
  calls: string[] = [];
  existing: ExistingDocument | null = null;
  marker = "";

  async fetchDatabase() {
    this.calls.push("schema");
    return {
      dataSourceId: "data-source",
      properties: {
        "요청 제목": "title" as const,
        "개발 상태": "status" as const,
        "개발 기록": "rich_text" as const,
      },
    };
  }
  async findByDocumentKey() {
    this.calls.push("find");
    return this.existing;
  }
  async createPage(input: { children: NotionBlock[] }) {
    this.calls.push("create");
    const body = input.children[0] as Record<string, Record<string, Array<{ text: { content: string } }>>>;
    this.marker = body.paragraph?.rich_text?.[0]?.text.content ?? "";
    return { pageId: "page", url: "https://notion.so/page" };
  }
  async updatePage() {
    this.calls.push("update");
  }
  async appendBlocks() {
    this.calls.push("append");
  }
  async finalizePage() {
    this.calls.push("finalize");
  }
  async verifyPage(input: { expectedTitle: string; expectedStatus?: string }) {
    this.calls.push("verify");
    return { title: input.expectedTitle, status: input.expectedStatus, markerFound: true };
  }
}

test("creates, verifies, then skips all writes for an unchanged hash", async () => {
  clearPublisherCaches();
  const dir = await mkdtemp(join(tmpdir(), "notion-publisher-"));
  const filePath = join(dir, "spec.md");
  await writeFile(filePath, "# Safe title\n\nPrivate body", "utf8");
  const transport = new FakeTransport();
  const created = await publishMarkdownFile(transport, {
    filePath,
    databaseUrl: "https://www.notion.so/database?v=redacted",
    status: "개발 완료",
    mapping: QUEUE_PROPERTY_MAPPING,
  });
  assert.equal(created.action, "created");
  assert.deepEqual(transport.calls, ["schema", "find", "create", "finalize", "verify"]);

  transport.calls = [];
  const unchanged = await publishMarkdownFile(transport, {
    filePath,
    databaseUrl: "https://www.notion.so/database",
    status: "개발 완료",
  });
  assert.equal(unchanged.action, "unchanged");
  assert.deepEqual(transport.calls, []);
  assert.equal(unchanged.apiCalls, 0);
  assert.equal(unchanged.schemaCacheHit, true);

  await writeFile(filePath, "# Safe title\n\nChanged body", "utf8");
  transport.calls = [];
  const updated = await publishMarkdownFile(transport, {
    filePath,
    databaseUrl: "https://www.notion.so/database",
    status: "개발 완료",
  });
  assert.equal(updated.action, "updated");
  assert.deepEqual(transport.calls, ["update", "finalize", "verify"]);

  transport.calls = [];
  const metadataUpdated = await publishMarkdownFile(transport, {
    filePath,
    databaseUrl: "https://www.notion.so/database",
    status: "검토 필요",
  });
  assert.equal(metadataUpdated.action, "updated");
  assert.deepEqual(transport.calls, ["update", "finalize", "verify"]);
});

test("requires a durable key and hash storage mapping", () => {
  assert.throws(
    () => validatePropertyMapping({ title: "Name", documentKey: "Key" }),
    /documentKey\+contentHash/,
  );
  assert.doesNotThrow(() =>
    validatePropertyMapping({ title: "Name", documentKey: "Key", contentHash: "Hash" }),
  );
});

test("rejects overlong titles before contacting Notion", async () => {
  clearPublisherCaches();
  const dir = await mkdtemp(join(tmpdir(), "notion-publisher-"));
  const filePath = join(dir, "spec.md");
  await writeFile(filePath, `# ${"x".repeat(2_001)}`, "utf8");
  const transport = new FakeTransport();
  await assert.rejects(
    publishMarkdownFile(transport, { filePath, databaseUrl: "https://www.notion.so/database" }),
    /제목.*제한/,
  );
  assert.deepEqual(transport.calls, []);
});

test("fails safely without including file contents", async () => {
  const secretBody = "DO_NOT_LOG_THIS_BODY";
  const dir = await mkdtemp(join(tmpdir(), "notion-publisher-"));
  const filePath = join(dir, "spec.md");
  await writeFile(filePath, secretBody, "utf8");
  const transport = new FakeTransport();
  await assert.rejects(
    publishMarkdownFile(transport, { filePath, databaseUrl: "https://www.notion.so/database" }),
    (error: unknown) => error instanceof Error && !error.message.includes(secretBody),
  );
});

test("repairs a page whose final marker failed to commit", async () => {
  clearPublisherCaches();
  const dir = await mkdtemp(join(tmpdir(), "notion-publisher-"));
  const filePath = join(dir, "spec.md");
  await writeFile(filePath, "# Retry-safe\n\nBody", "utf8");

  class FinalizeFailsOnceTransport extends FakeTransport {
    failFinalize = true;

    override async createPage(input: {
      properties: Record<string, unknown>;
      children: NotionBlock[];
    }) {
      const created = await super.createPage(input);
      const record = input.properties["개발 기록"] as {
        rich_text: Array<{ text: { content: string } }>;
      };
      const pendingMarker = record.rich_text[0]?.text.content ?? "";
      this.existing = {
        pageId: created.pageId,
        url: created.url,
        title: "Retry-safe",
        contentHash: pendingMarker.split(":").at(-1),
      };
      return created;
    }

    override async finalizePage() {
      this.calls.push("finalize");
      if (this.failFinalize) {
        this.failFinalize = false;
        throw new Error("response containing PRIVATE_BODY");
      }
    }
  }

  const transport = new FinalizeFailsOnceTransport();
  await assert.rejects(
    publishMarkdownFile(transport, {
      filePath,
      databaseUrl: "https://www.notion.so/database",
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("완료 마커 저장") &&
      !error.message.includes("PRIVATE_BODY"),
  );
  transport.calls = [];
  const repaired = await publishMarkdownFile(transport, {
    filePath,
    databaseUrl: "https://www.notion.so/database",
  });
  assert.equal(repaired.action, "updated");
  assert.deepEqual(transport.calls, ["find", "update", "finalize", "verify"]);
});