import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const onScreen = readFileSync(join(appRoot, "app/(tabs)/on.tsx"), "utf8");
const offlinePersistence = readFileSync(
  join(appRoot, "lib/offlineQueryPersistence.ts"),
  "utf8",
);

describe("기록함 탭 오프라인 디스크 캐시 허용목록", () => {
  it("includes every 기록함 탭 list endpoint (Task #1991)", () => {
    // 단상 목록, 질문 큐, 모음 목록 — the three queries the 기록함 탭 needs
    // that were not already covered by the 수신함/마이 탭 allowlist entries
    // (편지 목록 is shared with the 마이 탭 via "/api/articles").
    expect(offlinePersistence).toContain('"/api/thoughts"'); // 단상 목록 - useListThoughts
    expect(offlinePersistence).toContain('"/api/thoughts/question-queue"'); // 질문 큐 - useGetThoughtQuestionQueue
    expect(offlinePersistence).toContain('"/api/my-collections"'); // 내 모음 목록 - useListMyCollections
    // Already covered by the 마이 탭's own entry — must not be duplicated.
    expect(offlinePersistence).toContain('"/api/articles"');
  });
});

describe("기록함 탭 로딩/오프라인 상태 분기", () => {
  it("excludes the supplemental question queue from the full-screen loading gate", () => {
    const isLoadingBlock = onScreen.slice(
      onScreen.indexOf("const isLoading ="),
      onScreen.indexOf("const isOfflineWithoutCache ="),
    );
    expect(isLoadingBlock).toContain("articlesQuery.isLoading && !articlesQuery.data");
    expect(isLoadingBlock).toContain("thoughtsQuery.isLoading && !thoughtsQuery.data");
    expect(isLoadingBlock).not.toContain("questionQuery.isLoading");
    expect(isLoadingBlock).not.toContain("questionQuery.data");
  });

  it("shows a distinct offline notice instead of the normal empty state when the primary lists have no cache", () => {
    expect(onScreen).toContain(
      "const isOfflineWithoutCache =\n    !isOnline && (articlesQuery.isPending || thoughtsQuery.isPending);",
    );
    const renderBlock = onScreen.slice(
      onScreen.indexOf("isOfflineWithoutCache ? ("),
      onScreen.indexOf('view === "card" && cardGroups.length > 0 ? ('),
    );
    expect(renderBlock).toContain("오프라인 상태예요");
    expect(renderBlock).toContain("wifi-off");
    expect(renderBlock).toContain("<RefreshableEmpty");
  });

  it("checks the offline branch before the loading spinner branch so a cached restore still wins", () => {
    expect(onScreen.indexOf("isLoading ? (")).toBeLessThan(
      onScreen.indexOf("isOfflineWithoutCache ? ("),
    );
  });
});

describe("기록함 탭 네트워크 필요 동작의 오프라인 안내", () => {
  it("subscribes to the shared onlineManager via useIsOnline, matching the 마이 탭 pattern", () => {
    expect(onScreen).toContain('import { useIsOnline } from "@/lib/useIsOnline";');
    expect(onScreen).toContain("const isOnline = useIsOnline();");
  });

  it("guards manual pull-to-refresh so it explains why instead of silently pausing while offline", () => {
    const handler = onScreen.slice(
      onScreen.indexOf("const handleRefresh = useCallback"),
      onScreen.indexOf("const openRecord = useCallback"),
    );
    expect(handler).toContain("if (!isOnline)");
    expect(handler).toContain("showToast(");
    expect(handler).toContain("오프라인 상태예요");
  });
});
