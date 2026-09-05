import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getUserScopedOperatorPendingSpaceCodeRequestsQueryKey,
  runOperatorPendingRetry,
} from "../operatorPendingSpaceCodeRequestsQuery";

const readAppFile = (path: string) =>
  readFileSync(join(__dirname, "../..", path), "utf8");

describe("space list pending sections", () => {
  it("renders operator approvals before invitations and personal applications in the list header", () => {
    const source = readAppFile("app/(tabs)/of.tsx");
    const operatorSections = [...source.matchAll(/<OperatorPendingBar/g)].map(
      (match) => match.index,
    );
    const invitationSections = [...source.matchAll(/<InvitationBar/g)].map(
      (match) => match.index,
    );
    const personalRequestSections = [...source.matchAll(/<CodeRequestBar/g)].map(
      (match) => match.index,
    );

    expect(operatorSections).toHaveLength(1);
    expect(invitationSections).toHaveLength(1);
    expect(personalRequestSections).toHaveLength(1);
    operatorSections.forEach((operatorIndex, index) => {
      expect(operatorIndex).toBeLessThan(invitationSections[index]!);
      expect(invitationSections[index]!).toBeLessThan(
        personalRequestSections[index]!,
      );
    });
  });

  it("shows every sorted non-archived space without role or status filters", () => {
    const source = readAppFile("app/(tabs)/of.tsx");

    expect(source).not.toContain("DropdownFilter");
    expect(source).not.toContain("roleFilter");
    expect(source).not.toContain("statusFilter");
    expect(source).not.toContain("해당하는 공간이 없어요");
    expect(source).toContain("data={allSpaces}");
    expect(source).toContain('s.status !== "ARCHIVED"');
  });

  it("uses one content-sized menu button below the centered space title", () => {
    const source = readAppFile("app/(tabs)/of.tsx");
    const headerStart = source.indexOf('<PageHeader');
    const sheetStart = source.indexOf("<ActionSheetModal", headerStart);
    const headerActions = source.slice(headerStart, sheetStart);

    expect(headerActions).not.toContain("showAdd");
    expect(headerActions).not.toContain("showArchive");
    expect(headerActions).toContain("styles.headerActionRow");
    expect(headerActions).toContain('name=\"more-horizontal\"');
    expect(headerActions).toContain('accessibilityLabel=\"공간 메뉴 열기\"');
    expect(source).toContain("height: Sizing.searchButtonSize");
    expect(source).toContain("marginTop: 4");
    expect(source).toContain("marginBottom: 16");
    expect(source).toContain('label: "보관된 공간"');
  });

  it("lets space cards grow with content while keeping a compact minimum touch target", () => {
    const source = readAppFile("app/(tabs)/of.tsx");

    expect(source).toContain("const SPACE_CARD_MIN_HEIGHT = 132");
    expect(source.match(/minHeight: SPACE_CARD_MIN_HEIGHT/g)).toHaveLength(3);
    expect(source).not.toContain("SPACE_CARD_HEIGHT");
    expect(source).not.toContain('height: "100%"');
    expect(source).toContain('accessibilityLabel={`${item.name} 공간 열기`}');
  });

  it("scales card typography from its width and lets long titles wrap fully", () => {
    const source = readAppFile("app/(tabs)/of.tsx");

    expect(source).toContain("const titleFontSize = cardWidth * 0.064");
    expect(source).toContain("const descriptionFontSize = cardWidth * 0.04");
    expect(source).toContain('fontWeight: "700"');
    expect(source).not.toContain(
      '<Text style={styles.cardName} numberOfLines={1}>',
    );
  });

  it("loads and displays up to three recent visible space posts inside each space card", () => {
    const source = readAppFile("app/(tabs)/of.tsx");

    expect(source).toContain("useQueries");
    expect(source).toContain("getListSpaceLettersQueryKey(space.id)");
    expect(source).toContain("sortRecentLetters");
    expect(source).toContain(".slice(0, 3)");
    expect(source).toContain("<RecentPostCards");
    expect(source).toContain("articleTitle || \"제목 없음\"");
    expect(source).toContain("spaceLetterToViewModel");
    expect(source).toContain("<CanonicalCardSlot");
    expect(source).toContain("<ArticleCardItem");
    expect(source).toContain(
      "90,\n    Math.floor((availableWidth - 16) / 3)",
    );
    expect(source).toContain("coverWidth * Sizing.cardRatio");
    expect(source).not.toContain("recentPostExcerpt");
    const recentPostsStyle = source.slice(
      source.indexOf("recentPosts:"),
      source.indexOf("cardSpacer:", source.indexOf("recentPosts:")),
    );
    expect(recentPostsStyle).toContain('justifyContent: "flex-start"');
    expect(recentPostsStyle).not.toContain('justifyContent: "center"');
  });

  it("rerenders recent posts after authenticated queries resolve and refreshes them manually", () => {
    const source = readAppFile("app/(tabs)/of.tsx");

    expect(source).toContain("await prepareAuthSession()");
    expect(source).toContain("enabled: !!userId && !authIsLoading");
    expect(source).toContain("{ userId }");
    expect(source).toContain(
      "[router, cardWidth, recentLettersBySpaceId]",
    );
    expect(source).toContain("extraData={recentLettersBySpaceId}");
    expect(source).toContain(
      "...spaceLettersQueries.map((query) => query.refetch())",
    );
    expect(source).toContain("for (const queryKey of spaceLetterQueryKeys)");
    expect(source).toContain(
      "void queryClient.refetchQueries({ queryKey, exact: true })",
    );
  });

  it("uses distinct copy for operator approvals and personal applications", () => {
    const source = readAppFile("app/(tabs)/of.tsx");

    expect(source).toContain(
      '<Text style={styles.inviteSectionLabel}>승인 대기</Text>',
    );
    expect(source).toContain(
      '<Text style={styles.inviteSectionLabel}>신청 중</Text>',
    );
    expect(source).toContain(
      '<Text style={styles.pendingBadgeText}>신청 중</Text>',
    );
    expect(source).not.toContain("승인 대기 중");
  });

  it("opens participant management from an operator summary", () => {
    const source = readAppFile("app/(tabs)/of.tsx");
    const handlerStart = source.indexOf(
      "const handleOperatorPendingBarPress",
    );
    const handlerEnd = source.indexOf(
      "const renderSpaceItem",
      handlerStart,
    );
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handler).toContain('pathname: "/of-space-participants"');
    expect(handler).toContain("id: summary.space.id");
    expect(handler).toContain("spaceName: summary.space.name");
  });

  it("invalidates the operator summary after approvals and rejections", () => {
    const source = readAppFile("app/of-space-participants.tsx");
    const invalidations = source.match(
      /queryKey: getUserScopedOperatorPendingSpaceCodeRequestsQueryKey\(userId\)/g,
    );

    expect(invalidations).toHaveLength(3);
  });

  it("keeps operator summary caches isolated between signed-in users", () => {
    const firstUserKey =
      getUserScopedOperatorPendingSpaceCodeRequestsQueryKey("user-a");
    const secondUserKey =
      getUserScopedOperatorPendingSpaceCodeRequestsQueryKey("user-b");

    expect(firstUserKey).not.toEqual(secondUserKey);
    expect(firstUserKey.at(-1)).toEqual({ userId: "user-a" });
    expect(secondUserKey.at(-1)).toEqual({ userId: "user-b" });
  });

  it("does not block the existing space list on supplemental summary state", () => {
    const source = readAppFile("app/(tabs)/of.tsx");
    const loadingStart = source.indexOf("const isLoading =");
    const loadingEnd = source.indexOf("const refetchAll", loadingStart);
    const loadingAndError = source.slice(loadingStart, loadingEnd);

    expect(loadingAndError).not.toContain("operatorPendingQuery.isLoading");
    expect(loadingAndError).not.toContain("operatorPendingQuery.isError");
    expect(source).toContain("const isOperatorSummaryOnlyLoading =");
    expect(source).toContain("const isOperatorSummaryOnlyError =");
    expect(source.indexOf("isOperatorSummaryOnlyLoading ?")).toBeLessThan(
      source.indexOf("!hasRawContent ?"),
    );
    expect(source.indexOf("isOperatorSummaryOnlyError ?")).toBeLessThan(
      source.indexOf("!hasRawContent ?"),
    );
  });

  it("waits for the authenticated session before the initial supplemental request", () => {
    const source = readAppFile("app/(tabs)/of.tsx");
    const queryStart = source.indexOf(
      "const operatorPendingQuery = useListOperatorPendingSpaceCodeRequests",
    );
    const queryEnd = source.indexOf("const allSpaces", queryStart);
    const query = source.slice(queryStart, queryEnd);

    expect(query.indexOf("await prepareAuthSession()")).toBeLessThan(
      query.indexOf("return listOperatorPendingSpaceCodeRequests"),
    );
    expect(source).toContain("operatorPendingIsFetching");
    expect(source).toContain('fetchStatus ===\n        "fetching"');
  });

  it("blocks repeated retries and unlocks after a successful retry", async () => {
    const lock = { current: false };
    let resolveRequest!: () => void;
    let calls = 0;
    const refetch = () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        resolveRequest = resolve;
      });
    };

    const first = runOperatorPendingRetry(lock, refetch);
    const duplicate = await runOperatorPendingRetry(lock, refetch);

    expect(duplicate).toBe(false);
    expect(calls).toBe(1);
    resolveRequest();
    await expect(first).resolves.toBe(true);

    const next = runOperatorPendingRetry(lock, async () => {
      calls += 1;
    });
    await expect(next).resolves.toBe(true);
    expect(calls).toBe(2);
  });

  it("keeps retry layout fixed and exposes disabled busy state", () => {
    const source = readAppFile("app/(tabs)/of.tsx");

    expect(source).toContain("width: 104");
    expect(source.match(/height: 44/g)).toHaveLength(2);
    expect(source.match(/flexGrow: 0/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source.match(/flexShrink: 0/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("disabled={isOperatorRetrying}");
    expect(source).toContain("busy: isOperatorRetrying");
  });
});