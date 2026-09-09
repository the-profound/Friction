import { createHash } from "node:crypto";

export const NOTION_RICH_TEXT_LIMIT = 2_000;
export const NOTION_BLOCK_BATCH_LIMIT = 100;
export const DOCUMENT_MARKER_PREFIX = "replit-spec:";

export type PropertyKind = "title" | "status" | "rich_text";

export interface NotionBlock {
  object: "block";
  type: "heading_1" | "heading_2" | "heading_3" | "paragraph" | "bulleted_list_item" | "numbered_list_item" | "code";
  [key: string]: unknown;
}

export interface PropertyMapping {
  title: string;
  status?: string;
  body?: string;
  documentKey?: string;
  contentHash?: string;
}

export interface DatabaseSchema {
  dataSourceId: string;
  properties: Record<string, PropertyKind>;
}

export interface ExistingDocument {
  pageId: string;
  url: string;
  title: string;
  status?: string;
  contentHash?: string;
}

export interface CreatedDocument {
  pageId: string;
  url: string;
}

export interface NotionTransport {
  getRequestCount?(): number;
  fetchDatabase(cleanDatabaseUrl: string): Promise<DatabaseSchema>;
  findByDocumentKey(input: {
    dataSourceId: string;
    documentKey: string;
    mapping: PropertyMapping;
  }): Promise<ExistingDocument | null>;
  createPage(input: {
    dataSourceId: string;
    properties: Record<string, unknown>;
    children: NotionBlock[];
  }): Promise<CreatedDocument>;
  updatePage(input: {
    pageId: string;
    properties: Record<string, unknown>;
    children: NotionBlock[];
  }): Promise<void>;
  appendBlocks(pageId: string, children: NotionBlock[]): Promise<void>;
  finalizePage(input: { pageId: string; properties: Record<string, unknown> }): Promise<void>;
  verifyPage(input: {
    pageId: string;
    expectedTitle: string;
    expectedStatus?: string;
    expectedDocumentKey: string;
    expectedContentHash: string;
  }): Promise<{ title: string; status?: string; markerFound: boolean }>;
}

export const QUEUE_PROPERTY_MAPPING: PropertyMapping = {
  title: "요청 제목",
  status: "개발 상태",
  body: "개발 기록",
};

export function cleanNotionUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("대상 DB URL 형식이 올바르지 않습니다. Notion DB 공유 URL을 확인하세요.");
  }
  if (parsed.protocol !== "https:" || !/(^|\.)notion\.(so|site)$/.test(parsed.hostname)) {
    throw new Error("대상 DB URL은 HTTPS Notion URL이어야 합니다.");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function extractTitle(markdown: string, override?: string): string {
  const explicit = override?.trim();
  if (explicit) {
    validateTitleLength(explicit);
    return explicit;
  }
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match?.[1]) {
      const title = match[1].trim();
      validateTitleLength(title);
      return title;
    }
  }
  throw new Error("첫 번째 Markdown 제목을 찾지 못했습니다. --title을 지정하세요.");
}

function validateTitleLength(title: string): void {
  if (title.length > NOTION_RICH_TEXT_LIMIT) {
    throw new Error(`페이지 제목이 Notion 제한(${NOTION_RICH_TEXT_LIMIT}자)을 초과합니다. 더 짧은 --title을 지정하세요.`);
  }
}

export function contentHash(markdown: string): string {
  return createHash("sha256").update(markdown, "utf8").digest("hex");
}

export function documentKey(cleanDatabaseUrl: string, fileIdentity: string): string {
  return createHash("sha256")
    .update(`${cleanDatabaseUrl}\0${fileIdentity}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

export function splitRichText(text: string, limit = NOTION_RICH_TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < Math.floor(limit / 2)) cut = rest.lastIndexOf(" ", limit);
    if (cut < Math.floor(limit / 2)) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

function richText(content: string): Array<Record<string, unknown>> {
  return [{ type: "text", text: { content } }];
}

const NOTION_CODE_LANGUAGES = new Set([
  "abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++",
  "c#", "css", "dart", "diff", "docker", "elixir", "elm", "erlang", "flow",
  "fortran", "f#", "gherkin", "glsl", "go", "graphql", "groovy", "haskell",
  "html", "java", "javascript", "json", "julia", "kotlin", "latex", "less",
  "lisp", "livescript", "lua", "makefile", "markdown", "markup", "matlab",
  "mermaid", "nix", "objective-c", "ocaml", "pascal", "perl", "php",
  "plain text", "powershell", "prolog", "protobuf", "python", "r", "reason",
  "ruby", "rust", "sass", "scala", "scheme", "scss", "shell", "sql", "swift",
  "typescript", "vb.net", "verilog", "vhdl", "visual basic", "webassembly",
  "xml", "yaml", "java/c/c++/c#",
]);

const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  csharp: "c#",
  cs: "c#",
  cpp: "c++",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  py: "python",
  rb: "ruby",
  sh: "shell",
  text: "plain text",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
};

export function normalizeCodeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  const aliased = CODE_LANGUAGE_ALIASES[normalized] ?? normalized;
  return NOTION_CODE_LANGUAGES.has(aliased) ? aliased : "plain text";
}

function block(type: NotionBlock["type"], text: string, language?: string): NotionBlock {
  const payload: Record<string, unknown> = { rich_text: richText(text) };
  if (type === "code") payload.language = normalizeCodeLanguage(language ?? "plain text");
  return { object: "block", type, [type]: payload };
}

export function markdownToBlocks(markdown: string): NotionBlock[] {
  const result: NotionBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let codeLines: string[] | null = null;
  let codeLanguage = "plain text";

  const emit = (type: NotionBlock["type"], text: string, language?: string) => {
    for (const chunk of splitRichText(text)) result.push(block(type, chunk, language));
  };
  const flushParagraph = () => {
    if (paragraph.length) emit("paragraph", paragraph.join("\n"));
    paragraph = [];
  };

  for (const line of lines) {
    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      if (codeLines) {
        emit("code", codeLines.join("\n"), codeLanguage);
        codeLines = null;
      } else {
        flushParagraph();
        codeLines = [];
        codeLanguage = fence[1] || "plain text";
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(heading[1]!.length, 3);
      emit(`heading_${level}` as NotionBlock["type"], heading[2]!);
    } else if (bullet) {
      flushParagraph();
      emit("bulleted_list_item", bullet[1]!);
    } else if (numbered) {
      flushParagraph();
      emit("numbered_list_item", numbered[1]!);
    } else if (line.trim() === "") {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  if (codeLines) emit("code", codeLines.join("\n"), codeLanguage);
  flushParagraph();
  return result;
}

export function batchBlocks(blocks: NotionBlock[]): NotionBlock[][] {
  const batches: NotionBlock[][] = [];
  for (let index = 0; index < blocks.length; index += NOTION_BLOCK_BATCH_LIMIT) {
    batches.push(blocks.slice(index, index + NOTION_BLOCK_BATCH_LIMIT));
  }
  return batches;
}

export function validateMapping(schema: DatabaseSchema, mapping: PropertyMapping): void {
  const expected: Array<[string | undefined, PropertyKind, string]> = [
    [mapping.title, "title", "제목"],
    [mapping.status, "status", "상태"],
    [mapping.body, "rich_text", "본문"],
    [mapping.documentKey, "rich_text", "문서 키"],
    [mapping.contentHash, "rich_text", "내용 해시"],
  ];
  for (const [name, kind, label] of expected) {
    if (name && schema.properties[name] !== kind) {
      throw new Error(`${label} 속성 매핑이 DB 스키마와 일치하지 않습니다: ${name} (${kind} 필요)`);
    }
  }
}

export function marker(documentKeyValue: string, hash: string): string {
  return `${DOCUMENT_MARKER_PREFIX}${documentKeyValue}:${hash}`;
}

export function buildProperties(input: {
  mapping: PropertyMapping;
  title: string;
  status?: string;
  documentKey: string;
  hash: string;
}): Record<string, unknown> {
  const { mapping } = input;
  const properties: Record<string, unknown> = {
    [mapping.title]: { type: "title", title: richText(input.title) },
  };
  if (mapping.status && input.status) {
    properties[mapping.status] = { type: "status", status: { name: input.status } };
  }
  if (mapping.body) {
    properties[mapping.body] = {
      type: "rich_text",
      rich_text: richText(marker(input.documentKey, input.hash)),
    };
  }
  if (mapping.documentKey) {
    properties[mapping.documentKey] = { type: "rich_text", rich_text: richText(input.documentKey) };
  }
  if (mapping.contentHash) {
    properties[mapping.contentHash] = { type: "rich_text", rich_text: richText(input.hash) };
  }
  return properties;
}

export function validatePropertyMapping(mapping: PropertyMapping): void {
  if (!mapping.title?.trim()) throw new Error("속성 매핑에 title이 필요합니다.");
  if (!mapping.body && !(mapping.documentKey && mapping.contentHash)) {
    throw new Error("멱등 조회를 위해 body 또는 documentKey+contentHash 속성 매핑이 필요합니다.");
  }
}