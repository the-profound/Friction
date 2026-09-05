import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const myScreen = readFileSync(join(appRoot, "app/(tabs)/to.tsx"), "utf8");
const offlinePersistence = readFileSync(
  join(appRoot, "lib/offlineQueryPersistence.ts"),
  "utf8",
);
const useIsOnline = readFileSync(join(appRoot, "lib/useIsOnline.ts"), "utf8");

describe("마이 탭 오프라인 디스크 캐시 허용목록", () => {
  it("includes every 마이 탭 list/profile endpoint (Task #1971)", () => {
    // Profile, 내 편지, 내 공간, 발송기록, 이웃 — the five queries the 마이
    // 탭 renders on cold start. Losing any of these from the allowlist means
    // that data goes back to blocking on a network response every time the
    // app restarts or the device is offline.
    expect(offlinePersistence).toContain('"/api/articles"'); // 내 편지 목록
    expect(offlinePersistence).toContain('"/api/spaces"'); // 내 공간 목록
    expect(offlinePersistence).toContain('"/api/send-records"'); // 발송기록
    expect(offlinePersistence).toContain('"/api/neighbors"'); // 이웃 목록
    expect(offlinePersistence).toContain("USER_PROFILE_PATH_PATTERN"); // 프로필 (/api/users/<id>)
  });
});

describe("마이 탭 로딩/오프라인 상태 분기", () => {
  it("keys the empty-state renderer off the active tab's own query, not a hardcoded tab check", () => {
    expect(myScreen).toContain("const activeTabQuery =");
    expect(myScreen).toContain('myTab === "letters" ? articlesQuery : myTab === "spaces" ? spacesQuery : null');
  });

  it("shows a distinct offline notice instead of a misleading empty state when there is no cached data yet", () => {
    const renderEmpty = myScreen.slice(
      myScreen.indexOf("const renderEmpty = useCallback"),
      myScreen.indexOf("const renderError = useCallback"),
    );
    expect(renderEmpty).toContain("!isOnline && activeTabQuery?.isPending");
    expect(renderEmpty).toContain("오프라인 상태예요");
    expect(renderEmpty).not.toContain("아직 보낸 편지가 없어요");
  });

  it("keeps the loading spinner branch based on the query's own isLoading, so cached data never sits behind a spinner", () => {
    const renderEmpty = myScreen.slice(
      myScreen.indexOf("const renderEmpty = useCallback"),
      myScreen.indexOf("const renderError = useCallback"),
    );
    expect(renderEmpty).toContain("activeTabQuery?.isLoading");
  });

  it("gives both the letters and spaces tabs an error retry path (not just letters)", () => {
    const listEmpty = myScreen.slice(
      myScreen.indexOf("const listEmpty ="),
      myScreen.indexOf("return (\n    <View style={styles.container}>"),
    );
    expect(listEmpty).toContain("articlesQuery.isError");
    expect(listEmpty).toContain("spacesQuery.isError");
    expect(listEmpty).toContain("편지를 불러오지 못했어요");
    expect(listEmpty).toContain("공간을 불러오지 못했어요");
  });
});

describe("마이 탭 네트워크 필요 동작의 오프라인 안내", () => {
  it("subscribes to the shared onlineManager instead of re-implementing connectivity detection", () => {
    expect(useIsOnline).toContain("onlineManager.subscribe");
    expect(useIsOnline).toContain("onlineManager.isOnline()");
  });

  it("guards the retry button so tapping it while offline explains why instead of silently pausing", () => {
    const renderError = myScreen.slice(
      myScreen.indexOf("const renderError = useCallback"),
      myScreen.indexOf("const contentPadding = useMemo"),
    );
    expect(renderError).toContain("if (!isOnline)");
    expect(renderError).toContain("showToast(");
    expect(renderError).toContain("오프라인 상태예요");
  });

  it("guards manual pull-to-refresh the same way and wires it into the FlatList", () => {
    expect(myScreen).toContain("const handleManualRefresh = useCallback(async () => {");
    const handler = myScreen.slice(
      myScreen.indexOf("const handleManualRefresh = useCallback"),
      myScreen.indexOf("const sendRecordByArticleId = useMemo"),
    );
    expect(handler).toContain("if (!isOnline)");
    expect(handler).toContain("showToast(");
    expect(myScreen).toContain("refreshControl={");
    expect(myScreen).toContain("onRefresh={handleManualRefresh}");
  });

  it("skips the focus-triggered background refetches entirely while offline", () => {
    const focusEffect = myScreen.slice(
      myScreen.indexOf("useFocusEffect(\n    useCallback(() => {"),
      myScreen.indexOf("const handleManualRefresh"),
    );
    expect(focusEffect).toContain("if (!isOnline) return;");
  });
});
