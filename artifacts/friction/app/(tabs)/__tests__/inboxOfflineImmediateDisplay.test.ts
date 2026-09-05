import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const libRoot = join(__dirname, "../../../lib");
const read = (root: string, relativePath: string) =>
  readFileSync(join(root, relativePath), "utf8");

// Regression coverage for Task 1970 (수신함 표지 카드 재시작·오프라인 즉시 표시).
// The inbox screen has no render harness (see friction-large-screen-test-
// convention in project memory), so — like the sibling wiring tests in this
// directory — these assertions check the raw source text instead of
// rendering the component.
describe("inbox offline immediate display wiring", () => {
  it("keeps the inbox list endpoint in the offline disk-cache allowlist", () => {
    const persistence = read(libRoot, "offlineQueryPersistence.ts");
    expect(persistence).toContain('"/api/inbox"');
  });

  it("skips awaiting refetch() while offline so pull-to-refresh never hangs", () => {
    const index = read(appRoot, "(tabs)/index.tsx");

    expect(index).toContain('import { useIsOnline } from "@/lib/useIsOnline";');
    expect(index).toContain("const isOnline = useIsOnline();");
    expect(index).toMatch(
      /const handleRefresh = useCallback\(async \(\) => \{\s*if \(!isOnline\) \{[\s\S]*?showToast\(\{ message: "오프라인 상태예요\. 인터넷 연결을 확인해주세요\.", type: "info" \}\);\s*return;/,
    );
  });

  it("surfaces offline guidance instead of an infinite spinner when there is no cached data yet", () => {
    const index = read(appRoot, "(tabs)/index.tsx");

    expect(index).toMatch(
      /\{isOnline \? "불러오는 중\.\.\." : "오프라인 상태예요\. 인터넷 연결을 확인해주세요\."\}/,
    );
  });

  it("notifies the user that mark-as-read syncs later instead of failing silently while offline", () => {
    const index = read(appRoot, "(tabs)/index.tsx");

    // Envelope-open path (직접 봉투 열기 상호작용)
    expect(index).toMatch(
      /onOpen: async \(\) => \{[\s\S]*?if \(!isOnline\) \{[\s\S]*?showToast\(\{ message: "오프라인 상태예요\. 온라인이 되면 자동으로 반영돼요\.", type: "info" \}\);/,
    );
    // Regular letter-open path (prepareInboxItem)
    expect(index).toMatch(
      /const prepareInboxItem = useCallback\(\(item: InboxItem\) => \{[\s\S]*?if \(!isOnline\) \{[\s\S]*?showToast\(\{ message: "오프라인 상태예요\. 온라인이 되면 자동으로 반영돼요\.", type: "info" \}\);/,
    );
  });
});
