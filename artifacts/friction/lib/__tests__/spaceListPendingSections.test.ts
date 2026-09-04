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
  it("renders operator approvals before invitations and personal applications in every list branch", () => {
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

    expect(operatorSections).toHaveLength(2);
    expect(invitationSections).toHaveLength(2);
    expect(personalRequestSections).toHaveLength(2);
    operatorSections.forEach((operatorIndex, index) => {
      expect(operatorIndex).toBeLessThan(invitationSections[index]!);
      expect(invitationSections[index]!).toBeLessThan(
        personalRequestSections[index]!,
      );
    });
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