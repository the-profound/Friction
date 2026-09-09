import { pathToFileURL } from "node:url";
import { publishMarkdownFile, type PublishOptions } from "./publisher.js";
import type { NotionTransport, PropertyMapping } from "./core.js";
import { createNotionTransport as createConnectorTransport } from "./connector-adapter.js";

function parseArgs(argv: string[]): PublishOptions & { adapter?: string } {
  argv = argv.filter((value) => value !== "--");
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("모든 옵션은 --이름 값 형식이어야 합니다.");
    values.set(flag, value);
  }
  const filePath = values.get("--file");
  const adapter = values.get("--adapter");
  if (!filePath) throw new Error("--file이 필요합니다.");
  let mapping: PropertyMapping | undefined;
  const mappingJson = values.get("--mapping-json");
  if (mappingJson) {
    try {
      mapping = JSON.parse(mappingJson) as PropertyMapping;
    } catch {
      throw new Error("--mapping-json은 유효한 JSON이어야 합니다.");
    }
  }
  return {
    filePath,
    adapter,
    databaseUrlEnv: values.get("--database-url-env"),
    title: values.get("--title"),
    status: values.get("--status"),
    sourceQueuePageUrl: values.get("--source-queue-page-url"),
    mapping,
  };
}

async function main(): Promise<void> {
  try {
    const { adapter, ...options } = parseArgs(process.argv.slice(2));
    let transport: NotionTransport;
    if (adapter) {
      try {
        const moduleUrl = pathToFileURL(adapter).href;
        const loaded = (await import(moduleUrl)) as { createNotionTransport?: () => Promise<NotionTransport> | NotionTransport };
        if (!loaded.createNotionTransport) throw new Error("missing factory");
        transport = await loaded.createNotionTransport();
      } catch {
        throw new Error("인증된 Notion 어댑터를 초기화하지 못했습니다. 연결 상태와 모듈 경로를 확인하세요.");
      }
    } else {
      transport = createConnectorTransport();
    }
    const result = await publishMarkdownFile(transport, options);
    console.log(
      JSON.stringify({
        action: result.action,
        pageUrl: result.pageUrl,
        title: result.title,
        status: result.status,
        blockCount: result.blockCount,
        apiCalls: result.apiCalls,
        schemaCacheHit: result.schemaCacheHit,
        contentHashPrefix: result.contentHash.slice(0, 12),
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 게시 오류";
    console.error(JSON.stringify({ ok: false, error: message }));
    process.exitCode = 1;
  }
}

void main();