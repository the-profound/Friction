import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
import {
  DOCUMENT_MARKER_PREFIX,
  type CreatedDocument,
  type DatabaseSchema,
  type ExistingDocument,
  type NotionBlock,
  type NotionTransport,
  type PropertyMapping,
} from "./core.js";

type JsonObject = Record<string, unknown>;

function databaseIdFromUrl(url: string): string {
  const matches = [...url.matchAll(/[0-9a-f]{32}/gi)];
  const compact = matches.at(-1)?.[0];
  if (!compact) throw new Error("Notion DB 식별자를 URL에서 찾을 수 없습니다.");
  return compact.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    "$1-$2-$3-$4-$5",
  );
}

function plainText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const value = item as JsonObject;
      return typeof value.plain_text === "string"
        ? value.plain_text
        : ((value.text as JsonObject | undefined)?.content as string | undefined) ?? "";
    })
    .join("");
}

function propertyText(property: unknown): string {
  if (!property || typeof property !== "object") return "";
  const value = property as JsonObject;
  if (Array.isArray(value.title)) return plainText(value.title);
  if (Array.isArray(value.rich_text)) return plainText(value.rich_text);
  return "";
}

function propertyStatus(property: unknown): string | undefined {
  if (!property || typeof property !== "object") return undefined;
  const value = property as JsonObject;
  const status = value.status as JsonObject | null | undefined;
  return typeof status?.name === "string" ? status.name : undefined;
}

function markerHash(value: string, key: string): string | undefined {
  const prefix = `${DOCUMENT_MARKER_PREFIX}${key}:`;
  const index = value.indexOf(prefix);
  if (index < 0) return undefined;
  return value.slice(index + prefix.length).split(/\s/, 1)[0] || undefined;
}

export class ConnectorNotionTransport implements NotionTransport {
  private readonly connectors = new ReplitConnectors();
  private requestCount = 0;

  getRequestCount(): number {
    return this.requestCount;
  }

  private async request(path: string, init?: ProxyOptions): Promise<JsonObject> {
    this.requestCount += 1;
    const response = await this.connectors.proxy("notion", path, init);
    if (!response.ok) {
      throw new Error(`Notion API status ${response.status}`);
    }
    const json: unknown = await response.json();
    if (!json || typeof json !== "object") throw new Error("Notion API 응답 형식 오류");
    return json as JsonObject;
  }

  async fetchDatabase(cleanDatabaseUrl: string): Promise<DatabaseSchema> {
    const databaseId = databaseIdFromUrl(cleanDatabaseUrl);
    const database = await this.request(`/v1/databases/${databaseId}`);
    const rawProperties = database.properties;
    if (!rawProperties || typeof rawProperties !== "object") {
      throw new Error("Notion DB 속성 응답 없음");
    }
    const properties: DatabaseSchema["properties"] = {};
    for (const [name, value] of Object.entries(rawProperties as JsonObject)) {
      if (!value || typeof value !== "object") continue;
      const type = (value as JsonObject).type;
      if (type === "title" || type === "status" || type === "rich_text") properties[name] = type;
    }
    return { dataSourceId: databaseId, properties };
  }

  async findByDocumentKey(input: {
    dataSourceId: string;
    documentKey: string;
    mapping: PropertyMapping;
  }): Promise<ExistingDocument | null> {
    const lookupProperty = input.mapping.documentKey ?? input.mapping.body;
    if (!lookupProperty) throw new Error("문서 키 조회 속성 없음");
    const response = await this.request(`/v1/databases/${input.dataSourceId}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        page_size: 2,
        filter: { property: lookupProperty, rich_text: { contains: input.documentKey } },
      }),
    });
    const results = Array.isArray(response.results) ? response.results : [];
    if (results.length > 1) throw new Error("같은 문서 키를 가진 페이지가 여러 개입니다.");
    const page = results[0] as JsonObject | undefined;
    if (!page) return null;
    const properties = (page.properties as JsonObject | undefined) ?? {};
    const markerSource = input.mapping.contentHash
      ? propertyText(properties[input.mapping.contentHash])
      : propertyText(properties[input.mapping.body ?? ""]);
    const hash = input.mapping.contentHash
      ? markerSource || undefined
      : markerHash(markerSource, input.documentKey);
    return {
      pageId: String(page.id),
      url: String(page.url),
      title: propertyText(properties[input.mapping.title]),
      status: input.mapping.status ? propertyStatus(properties[input.mapping.status]) : undefined,
      contentHash: hash,
    };
  }

  async createPage(input: {
    dataSourceId: string;
    properties: Record<string, unknown>;
    children: NotionBlock[];
  }): Promise<CreatedDocument> {
    const page = await this.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        parent: { database_id: input.dataSourceId },
        properties: input.properties,
        children: input.children,
      }),
    });
    return { pageId: String(page.id), url: String(page.url) };
  }

  private async clearChildren(pageId: string): Promise<void> {
    while (true) {
      const response = await this.request(`/v1/blocks/${pageId}/children?page_size=100`);
      const results = Array.isArray(response.results) ? response.results : [];
      if (results.length === 0) break;
      for (const child of results) {
        const id = (child as JsonObject).id;
        if (typeof id === "string") {
          await this.request(`/v1/blocks/${id}`, { method: "DELETE" });
        }
      }
    }
  }

  async updatePage(input: {
    pageId: string;
    properties: Record<string, unknown>;
    children: NotionBlock[];
  }): Promise<void> {
    await this.request(`/v1/pages/${input.pageId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ properties: input.properties }),
    });
    await this.clearChildren(input.pageId);
    if (input.children.length) await this.appendBlocks(input.pageId, input.children);
  }

  async appendBlocks(pageId: string, children: NotionBlock[]): Promise<void> {
    await this.request(`/v1/blocks/${pageId}/children`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ children }),
    });
  }

  async finalizePage(input: { pageId: string; properties: Record<string, unknown> }): Promise<void> {
    await this.request(`/v1/pages/${input.pageId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ properties: input.properties }),
    });
  }

  async verifyPage(input: {
    pageId: string;
    expectedTitle: string;
    expectedStatus?: string;
    expectedDocumentKey: string;
    expectedContentHash: string;
  }): Promise<{ title: string; status?: string; markerFound: boolean }> {
    const page = await this.request(`/v1/pages/${input.pageId}`);
    const properties = (page.properties as JsonObject | undefined) ?? {};
    let title = "";
    let status: string | undefined;
    let markerFound = false;
    for (const property of Object.values(properties)) {
      const text = propertyText(property);
      if (text === input.expectedTitle) title = text;
      const expectedMarker = `${DOCUMENT_MARKER_PREFIX}${input.expectedDocumentKey}:${input.expectedContentHash}`;
      if (text.includes(expectedMarker) || text === input.expectedContentHash) markerFound = true;
      const candidateStatus = propertyStatus(property);
      if (candidateStatus === input.expectedStatus) status = candidateStatus;
    }
    return { title, status, markerFound };
  }
}

export function createNotionTransport(): NotionTransport {
  return new ConnectorNotionTransport();
}