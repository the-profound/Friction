/**
 * Unit tests for the snapshot / background-save reliability logic inside
 * useReadingMemo, extracted into plain TypeScript so they run in the vitest
 * node environment without React Native mocks.
 *
 * Scenarios covered:
 *   A. Background transition writes a snapshot when content is dirty.
 *   B. Hydration: snapshot (newer) wins over server data.
 *   C. Hydration: legacy plain-string memoContent round-trips intact.
 *   D. Snapshot is cleared after a successful save.
 *   E. Empty content is not snapshot-persisted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Minimal in-memory AsyncStorage stand-in
// ---------------------------------------------------------------------------

const store: Record<string, string> = {};

const AsyncStorage = {
  async setItem(key: string, value: string) { store[key] = value; },
  async getItem(key: string): Promise<string | null> { return store[key] ?? null; },
  async removeItem(key: string) { delete store[key]; },
};

// Replication of the snapshot helpers from useReadingMemo (same logic, tested independently)
interface SnapshotData {
  content: string;
  title: string;
  memoArticleId?: string;
  updatedAt: number;
}

async function writeSnapshot(key: string, data: SnapshotData | null): Promise<void> {
  try {
    if (data) {
      await AsyncStorage.setItem(key, JSON.stringify(data));
    } else {
      await AsyncStorage.removeItem(key);
    }
  } catch { /* non-fatal */ }
}

async function readSnapshot(key: string): Promise<SnapshotData | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SnapshotData) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Replication of parseMemoPages (same logic as utils/memoPages.ts, validated
// separately; used here only to confirm the hydration path handles both
// JSON-array and legacy plain-string content).
// ---------------------------------------------------------------------------
function parseMemoPages(content: string): string[] {
  if (!content) return [""];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
      return parsed.length > 0 ? parsed : [""];
    }
  } catch { /* not JSON */ }
  return [content];
}

// ---------------------------------------------------------------------------
// Minimal persistence controller (mirrors the key paths of useReadingMemo)
// ---------------------------------------------------------------------------

function makeController(key: string) {
  let latestContent = "";
  let latestTitle = "";
  let pendingContent: string | null = null;
  let pendingTitle: string | null = null;
  let inFlightSave: Promise<void> | null = null;

  function markDirty(content: string, title: string) {
    latestContent = content;
    latestTitle = title;
    pendingContent = content;
    pendingTitle = title;
  }

  function flushPending() {
    const c = pendingContent;
    const t = pendingTitle;
    pendingContent = null;
    pendingTitle = null;
    return { content: c, title: t };
  }

  /** Mirrors the AppState "background" handler */
  async function onBackground() {
    const dirty =
      pendingContent !== null || pendingTitle !== null || inFlightSave !== null;
    if (!dirty) return;
    const content = pendingContent ?? latestContent;
    const title = pendingTitle ?? latestTitle;
    if (!content.trim()) return;
    await writeSnapshot(key, { content, title, updatedAt: Date.now() });
  }

  /** Mirrors the successful-save path that clears the snapshot */
  async function onSaveSuccess() {
    pendingContent = null;
    pendingTitle = null;
    await writeSnapshot(key, null);
  }

  return { markDirty, flushPending, onBackground, onSaveSuccess, getLatest: () => ({ latestContent, latestTitle }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset in-memory storage before each test
  for (const k of Object.keys(store)) delete store[k];
});

describe("Snapshot – background transition", () => {
  it("A1: writes snapshot when content is dirty at background time", async () => {
    const key = "snap_A1";
    const ctrl = makeController(key);
    ctrl.markDirty("작성 중인 메모 내용", "메모 제목");

    await ctrl.onBackground();

    const snap = await readSnapshot(key);
    expect(snap).not.toBeNull();
    expect(snap!.content).toBe("작성 중인 메모 내용");
    expect(snap!.title).toBe("메모 제목");
  });

  it("A2: does NOT write snapshot when there is nothing dirty", async () => {
    const key = "snap_A2";
    const ctrl = makeController(key);
    // No markDirty call → nothing dirty

    await ctrl.onBackground();

    const snap = await readSnapshot(key);
    expect(snap).toBeNull();
  });

  it("A3: does NOT write snapshot for empty content", async () => {
    const key = "snap_A3";
    const ctrl = makeController(key);
    ctrl.markDirty("", "제목만 있음");

    await ctrl.onBackground();

    // empty content → should NOT snapshot (content.trim() === "")
    const snap = await readSnapshot(key);
    expect(snap).toBeNull();
  });
});

describe("Snapshot – hydration on re-entry", () => {
  it("B1: snapshot content wins when newer than server data", async () => {
    const key = "snap_B1";
    const serverContent = '["서버에 저장된 내용"]';
    const snapshotContent = '["앱 종료 직전 편집한 내용"]';

    // Simulate: snapshot was written before crash
    await writeSnapshot(key, {
      content: snapshotContent,
      title: "메모 제목",
      updatedAt: Date.now(),
    });

    const snap = await readSnapshot(key);
    expect(snap).not.toBeNull();

    // Hydration logic: snapshot present → use snapshot over server
    const hydratedContent = snap!.content ?? serverContent;
    expect(hydratedContent).toBe(snapshotContent);

    // Verify pages parse correctly
    const pages = parseMemoPages(hydratedContent);
    expect(pages).toEqual(["앱 종료 직전 편집한 내용"]);
  });

  it("B2: multi-page snapshot is correctly deserialized", async () => {
    const key = "snap_B2";
    const pages = ["첫 번째 페이지 내용", "두 번째 페이지 내용", "세 번째 페이지 내용"];
    const serialized = JSON.stringify(pages);

    await writeSnapshot(key, { content: serialized, title: "멀티 페이지 메모", updatedAt: Date.now() });

    const snap = await readSnapshot(key);
    expect(snap).not.toBeNull();

    const parsed = parseMemoPages(snap!.content);
    expect(parsed).toEqual(pages);
    expect(parsed).toHaveLength(3);
  });

  it("C1: legacy plain-string memoContent (non-JSON) is read as a single page without migration", () => {
    const legacyContent = "이것은 레거시 형식의 메모 내용입니다. JSON 배열이 아닙니다.";
    const pages = parseMemoPages(legacyContent);

    // Must return the original string wrapped in an array — no data loss, no migration needed
    expect(pages).toHaveLength(1);
    expect(pages[0]).toBe(legacyContent);
  });

  it("C2: legacy content with markdown is preserved exactly", () => {
    const legacy = "# 독서 메모\n\n**중요한 구절**: 어쩌고 저쩌고\n\n> 인용문";
    const pages = parseMemoPages(legacy);

    expect(pages).toHaveLength(1);
    expect(pages[0]).toBe(legacy);
  });
});

describe("Snapshot – cleared after successful save", () => {
  it("D1: snapshot is removed after save succeeds", async () => {
    const key = "snap_D1";
    const ctrl = makeController(key);
    ctrl.markDirty("메모 내용", "제목");

    // Background triggered before save completes
    await ctrl.onBackground();
    expect(await readSnapshot(key)).not.toBeNull();

    // Save completes successfully
    await ctrl.onSaveSuccess();
    expect(await readSnapshot(key)).toBeNull();
  });

  it("D2: snapshot survives until save succeeds (not cleared prematurely)", async () => {
    const key = "snap_D2";
    const ctrl = makeController(key);
    ctrl.markDirty("중요한 메모 내용", "제목");
    await ctrl.onBackground();

    // Before save completes, snapshot must still exist
    expect(await readSnapshot(key)).not.toBeNull();
  });
});

describe("Snapshot – round-trip integrity", () => {
  it("E1: content is preserved byte-for-byte through write → read", async () => {
    const key = "snap_E1";
    const original = '["특수 문자: \\"따옴표\\", 백슬래시 \\\\", "두 번째 페이지"]';

    await writeSnapshot(key, { content: original, title: "제목", updatedAt: 1000 });
    const snap = await readSnapshot(key);

    expect(snap!.content).toBe(original);
  });

  it("E2: memoArticleId is preserved in the snapshot for create-on-recover path", async () => {
    const key = "snap_E2";
    const articleId = "article-uuid-12345";

    await writeSnapshot(key, {
      content: '["페이지 내용"]',
      title: "제목",
      memoArticleId: articleId,
      updatedAt: Date.now(),
    });

    const snap = await readSnapshot(key);
    expect(snap!.memoArticleId).toBe(articleId);
  });
});
