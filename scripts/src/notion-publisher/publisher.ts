import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  QUEUE_PROPERTY_MAPPING,
  batchBlocks,
  buildProperties,
  cleanNotionUrl,
  contentHash,
  documentKey,
  extractTitle,
  markdownToBlocks,
  validateMapping,
  validatePropertyMapping,
  type DatabaseSchema,
  type ExistingDocument,
  type NotionTransport,
  type PropertyMapping,
} from "./core.js";

export interface PublishOptions {
  filePath: string;
  databaseUrl?: string;
  databaseUrlEnv?: string;
  title?: string;
  status?: string;
  mapping?: PropertyMapping;
  sourceQueuePageUrl?: string;
}

export interface PublishResult {
  action: "created" | "updated" | "unchanged";
  pageId: string;
  pageUrl: string;
  title: string;
  status?: string;
  documentKey: string;
  contentHash: string;
  blockCount: number;
  apiCalls: number;
  schemaCacheHit: boolean;
}

let schemaCaches = new WeakMap<NotionTransport, Map<string, DatabaseSchema>>();
let documentCaches = new WeakMap<NotionTransport, Map<string, ExistingDocument>>();

export function clearPublisherCaches(): void {
  schemaCaches = new WeakMap();
  documentCaches = new WeakMap();
}

function transportCache<T>(
  caches: WeakMap<NotionTransport, Map<string, T>>,
  transport: NotionTransport,
): Map<string, T> {
  let cache = caches.get(transport);
  if (!cache) {
    cache = new Map();
    caches.set(transport, cache);
  }
  return cache;
}

async function safeTransportCall<T>(operation: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch {
    throw new Error(`Notion ${operation} 호출에 실패했습니다. 연결 권한, 대상 페이지 공유 범위, API 상태를 확인하세요.`);
  }
}

function databaseUrlFrom(options: PublishOptions): string {
  const envName = options.databaseUrlEnv ?? "NOTION_QUEUE_DB_URL";
  const value = options.databaseUrl ?? process.env[envName];
  if (!value) {
    throw new Error(`대상 DB가 없습니다. --database-url-env ${envName} 또는 안전한 환경변수를 설정하세요.`);
  }
  return cleanNotionUrl(value);
}

export async function publishMarkdownFile(
  transport: NotionTransport,
  options: PublishOptions,
): Promise<PublishResult> {
  if (options.sourceQueuePageUrl && options.sourceQueuePageUrl !== "(none)") {
    throw new Error("원본 Queue 페이지가 지정된 작업은 파일 게시 대신 Quick Writeback 업데이트 경로를 사용하세요.");
  }

  const absolutePath = resolve(options.filePath);
  let canonicalPath: string;
  let markdown: string;
  try {
    canonicalPath = await realpath(absolutePath);
    markdown = await readFile(canonicalPath, "utf8");
  } catch {
    throw new Error("명세 파일을 읽을 수 없습니다. 경로와 UTF-8 텍스트 파일 여부를 확인하세요.");
  }
  if (!markdown.trim()) throw new Error("명세 파일이 비어 있습니다. 게시할 Markdown 내용을 추가하세요.");

  const cleanDatabaseUrl = databaseUrlFrom(options);
  const title = extractTitle(markdown, options.title);
  const hash = contentHash(markdown);
  const key = documentKey(cleanDatabaseUrl, canonicalPath);
  const cacheKey = `${cleanDatabaseUrl}\0${key}`;
  const mapping = options.mapping ?? QUEUE_PROPERTY_MAPPING;
  validatePropertyMapping(mapping);
  const desiredStateHash = contentHash(
    JSON.stringify({ hash, title, status: options.status ?? null, mapping }),
  );
  const blocks = markdownToBlocks(markdown);
  const batches = batchBlocks(blocks);
  let logicalCalls = 0;
  const startingRequestCount = transport.getRequestCount?.();

  const schemaCache = transportCache(schemaCaches, transport);
  const documentCache = transportCache(documentCaches, transport);
  let schema = schemaCache.get(cleanDatabaseUrl);
  const schemaCacheHit = Boolean(schema);
  if (!schema) {
    schema = await safeTransportCall("DB 스키마 조회", () => transport.fetchDatabase(cleanDatabaseUrl));
    logicalCalls += 1;
    schemaCache.set(cleanDatabaseUrl, schema);
  }
  validateMapping(schema, mapping);

  let existing = documentCache.get(cacheKey) ?? null;
  if (!existing) {
    existing = await safeTransportCall("문서 키 조회", () =>
      transport.findByDocumentKey({
        dataSourceId: schema.dataSourceId,
        documentKey: key,
        mapping,
      }),
    );
    logicalCalls += 1;
    if (existing) documentCache.set(cacheKey, existing);
  }
  if (existing?.contentHash === desiredStateHash) {
    return {
      action: "unchanged",
      pageId: existing.pageId,
      pageUrl: existing.url,
      title: existing.title,
      status: existing.status,
      documentKey: key,
      contentHash: hash,
      blockCount: blocks.length,
      apiCalls: startingRequestCount === undefined
        ? logicalCalls
        : (transport.getRequestCount?.() ?? startingRequestCount) - startingRequestCount,
      schemaCacheHit,
    };
  }

  const pendingHash = `pending-${desiredStateHash.slice(0, 16)}`;
  const pendingProperties = buildProperties({
    mapping,
    title,
    status: options.status,
    documentKey: key,
    hash: pendingHash,
  });
  const finalProperties = buildProperties({
    mapping,
    title,
    status: options.status,
    documentKey: key,
    hash: desiredStateHash,
  });
  let pageId: string;
  let pageUrl: string;
  let action: PublishResult["action"];
  if (existing) {
    await safeTransportCall("페이지 갱신", () =>
      transport.updatePage({
        pageId: existing.pageId,
        properties: pendingProperties,
        children: batches[0] ?? [],
      }),
    );
    logicalCalls += 1;
    pageId = existing.pageId;
    pageUrl = existing.url;
    action = "updated";
  } else {
    const created = await safeTransportCall("페이지 생성", () =>
      transport.createPage({
        dataSourceId: schema.dataSourceId,
        properties: pendingProperties,
        children: batches[0] ?? [],
      }),
    );
    logicalCalls += 1;
    pageId = created.pageId;
    pageUrl = created.url;
    action = "created";
  }
  for (const children of batches.slice(1)) {
    await safeTransportCall("본문 블록 추가", () => transport.appendBlocks(pageId, children));
    logicalCalls += 1;
  }
  await safeTransportCall("완료 마커 저장", () =>
    transport.finalizePage({ pageId, properties: finalProperties }),
  );
  logicalCalls += 1;

  const verification = await safeTransportCall("게시 결과 검증", () =>
    transport.verifyPage({
      pageId,
      expectedTitle: title,
      expectedStatus: options.status,
      expectedDocumentKey: key,
      expectedContentHash: desiredStateHash,
    }),
  );
  logicalCalls += 1;
  if (
    verification.title !== title ||
    (options.status !== undefined && verification.status !== options.status) ||
    !verification.markerFound
  ) {
    throw new Error("게시 후 검증에 실패했습니다. 제목·상태·문서 식별 마커를 확인하세요.");
  }
  documentCache.set(cacheKey, {
    pageId,
    url: pageUrl,
    title,
    status: verification.status,
    contentHash: desiredStateHash,
  });
  return {
    action,
    pageId,
    pageUrl,
    title,
    status: verification.status,
    documentKey: key,
    contentHash: hash,
    blockCount: blocks.length,
    apiCalls: startingRequestCount === undefined
      ? logicalCalls
      : (transport.getRequestCount?.() ?? startingRequestCount) - startingRequestCount,
    schemaCacheHit,
  };
}