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
    const recentLettersLogic = readAppFile("lib/spaceRecentLetters.ts");

    expect(source).toContain("useQueries");
    expect(source).toContain("getListSpaceLettersQueryKey(space.id)");
    expect(source).toContain(
      'import { sortRecentLetters } from "@/lib/spaceRecentLetters";',
    );
    expect(recentLettersLogic).toContain(".slice(0, 3)");
    expect(source).toContain("<RecentPostCards");
    expect(source).toContain("articleTitle || \"제목 없음\"");
    expect(source).toContain("spaceLetterToViewModel");
    expect(source).toContain("<ArticleCardItem");
    expect(source).toContain(
      "const coverWidth = Math.floor((availableWidth - 16) / 3);",
    );
    expect(source).not.toContain("Math.min(\n    90,");
    expect(source).toContain("coverWidth * Sizing.cardRatio");
    expect(source).toContain(
      "const coverRadius = 16 * (coverWidth / Sizing.cardSlotW);",
    );
    expect(source).toContain("cardWidth={coverWidth}");
    expect(source).toContain("cardRadius={coverRadius}");
    expect(source).not.toContain("<CanonicalCardSlot");
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
    expect(source).toContain("refetchOnMount: false");
    expect(source).toContain("refetchOnWindowFocus: false");
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

    // Only the primary queries (spaces/invitations/code requests) may drive
    // the full-screen loading/error branches. The operator summary query must
    // never be part of that decision.
    expect(loadingAndError).not.toContain("operatorPendingQuery.isLoading");
    expect(loadingAndError).not.toContain("operatorPendingQuery.isError");

    // There must be no separate full-screen branch dedicated to the operator
    // summary query failing or loading — that would still cover the whole
    // screen for a supplemental query.
    expect(source).not.toContain("isOperatorSummaryOnlyLoading");
    expect(source).not.toContain("isOperatorSummaryOnlyError");
    expect(source).not.toContain("승인 대기 목록을 불러오지 못했어요</Text>");

    // The empty state must render whenever there is no primary or operator
    // content, regardless of the operator query's own error/loading status.
    expect(source).toContain("!hasRawContent ?");
    expect(source).toContain(
      "const hasRawContent = hasPrimaryContent || operatorPending.length > 0;",
    );
  });

  it("surfaces the operator summary failure as a small non-blocking notice instead", () => {
    const source = readAppFile("app/(tabs)/of.tsx");

    // A dedicated, non-blocking banner component exists and is driven purely
    // by the operator query's own error/retry state.
    expect(source).toContain("function OperatorPendingStatusBanner(");
    const bannerStart = source.indexOf("function OperatorPendingStatusBanner(");
    const bannerEnd = source.indexOf("function OperatorPendingBar(", bannerStart);
    const banner = source.slice(bannerStart, bannerEnd);
    expect(banner).toContain("if (!visible) return null;");
    expect(banner).toContain("승인 대기 목록을 불러오지 못했어요");
    expect(banner).toContain("disabled={isRetrying}");
    expect(banner).toContain("busy: isRetrying");

    // It must be wired into both the list header (spaces exist) and the
    // empty state (no spaces at all) so failures are visible either way,
    // gated only on the operator query's own isError flag.
    const bannerUsages = [
      ...source.matchAll(/<OperatorPendingStatusBanner/g),
    ];
    expect(bannerUsages).toHaveLength(2);

    const listHeaderStart = source.indexOf("const listHeaderComponent = (");
    const listHeaderEnd = source.indexOf("return (", listHeaderStart);
    const listHeader = source.slice(listHeaderStart, listHeaderEnd);
    expect(listHeader).toContain("<OperatorPendingStatusBanner");
    expect(listHeader).toContain("visible={operatorPendingQuery.isError}");
    // The banner must precede the pending bar itself in the header so the
    // failure notice and (empty) approvals list never both render at once
    // in a confusing order.
    expect(listHeader.indexOf("<OperatorPendingStatusBanner")).toBeLessThan(
      listHeader.indexOf("<OperatorPendingBar"),
    );

    const emptyStateStart = source.indexOf("!hasRawContent ?");
    const emptyStateEnd = source.indexOf(") : (", emptyStateStart);
    const emptyState = source.slice(emptyStateStart, emptyStateEnd);
    expect(emptyState).toContain("공간이 없어요");
    expect(emptyState).toContain("<OperatorPendingStatusBanner");
    expect(emptyState).toContain("visible={operatorPendingQuery.isError}");

    // Retrying the notice reuses the same retry lock/handler as the rest of
    // the screen, not a bespoke path.
    expect(source.match(/onRetry={handleOperatorRetry}/g)).toHaveLength(2);
    expect(source.match(/isRetrying={isOperatorRetrying}/g)).toHaveLength(2);
  });

  it("gates the supplemental request on userId and delegates auth to customFetch", () => {
    const source = readAppFile("app/(tabs)/of.tsx");
    const queryStart = source.indexOf(
      "const operatorPendingQuery = useListOperatorPendingSpaceCodeRequests",
    );
    const queryEnd = source.indexOf("const allSpaces", queryStart);
    const query = source.slice(queryStart, queryEnd);

    // Auth is delegated to the generated hook's default queryFn (customFetch +
    // _authRefreshCallback). There must be no bespoke prepareAuthSession call.
    expect(query).not.toContain("queryFn");
    expect(query).not.toContain("prepareAuthSession");
    // The query must be disabled until a userId is present.
    expect(query).toContain("enabled: !!userId");
    // Fetching-state tracking is still in place for optimistic refresh.
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

    // The main full-screen retry button still exposes disabled/busy state
    // driven by the manual-refresh lock.
    expect(source).toContain("disabled={isManualRefreshing}");
    expect(source).toContain("busy: isManualRefreshing");

    // The non-blocking operator summary notice exposes its own
    // disabled/busy state, driven by the shared retry lock.
    const bannerStart = source.indexOf("function OperatorPendingStatusBanner(");
    const bannerEnd = source.indexOf("function OperatorPendingBar(", bannerStart);
    const banner = source.slice(bannerStart, bannerEnd);
    expect(banner).toContain("disabled={isRetrying}");
    expect(banner).toContain("busy: isRetrying");
  });
});