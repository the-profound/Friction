import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getUserScopedOperatorPendingSpaceCodeRequestsQueryKey } from "../operatorPendingSpaceCodeRequestsQuery";

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
});