import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldTriggerTabPrefetch } from "../prefetchTabData";

const appRoot = join(__dirname, "../..");
const userContext = readFileSync(join(appRoot, "contexts/UserContext.tsx"), "utf8");
const rootLayout = readFileSync(join(appRoot, "app/_layout.tsx"), "utf8");

describe("탭 데이터 미리 로딩 트리거 (Task #2196)", () => {
  it("wires the prefetch call into UserProvider, gated by the confirmed-session helper", () => {
    expect(userContext).toContain(
      'import { prefetchOtherTabsFirstLayerData, shouldTriggerTabPrefetch } from "@/lib/prefetchTabData";',
    );
    expect(userContext).toContain(
      "if (!shouldTriggerTabPrefetch({ sessionUserId: session?.user?.id, resolvedUserId })) return;",
    );
    expect(userContext).toContain(
      "void prefetchOtherTabsFirstLayerData(queryClient, resolvedUserId);",
    );
  });

  it("guards against re-firing on every re-render for the same already-prefetched user", () => {
    const block = userContext.slice(
      userContext.indexOf("const prefetchedForUserIdRef"),
      userContext.indexOf("void prefetchOtherTabsFirstLayerData"),
    );
    expect(block).toContain("if (prefetchedForUserIdRef.current === resolvedUserId) return;");
    expect(block).toContain("prefetchedForUserIdRef.current = resolvedUserId;");
  });

  it("does not gate on the userId prop alone — production always passes one", () => {
    // The one real caller always supplies an explicit userId prop (see
    // ProtectedRouteStack below), so a naive `if (overrideUserId) return`
    // check would silently disable the prefetch in every real session. The
    // shouldTriggerTabPrefetch helper (unit-tested separately below) is the
    // actual gate instead.
    expect(rootLayout).toContain("<UserProvider key={userId} userId={userId}>");
    expect(userContext).not.toContain("if (overrideUserId) return;\n    if (prefetchedForUserIdRef");
  });
});

describe("shouldTriggerTabPrefetch", () => {
  it("fires for the real production shape: an explicit userId prop backed by a matching session", () => {
    // This is exactly what ProtectedRouteStack renders in production —
    // UserProvider always receives userId={session.user.id} explicitly.
    expect(
      shouldTriggerTabPrefetch({ sessionUserId: "user-a", resolvedUserId: "user-a" }),
    ).toBe(true);
  });

  it("stays silent for a test harness with no real backing session", () => {
    expect(
      shouldTriggerTabPrefetch({ sessionUserId: undefined, resolvedUserId: "user-a" }),
    ).toBe(false);
  });

  it("stays silent while the session is mid-transition to a different user", () => {
    expect(
      shouldTriggerTabPrefetch({ sessionUserId: "user-old", resolvedUserId: "user-new" }),
    ).toBe(false);
  });

  it("stays silent for an empty resolvedUserId", () => {
    expect(shouldTriggerTabPrefetch({ sessionUserId: "", resolvedUserId: "" })).toBe(false);
  });
});
