import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, "../..", relativePath), "utf8");

describe("authenticated native tab startup", () => {
  const rootLayout = read("app/_layout.tsx");
  const tabLayout = read("app/(tabs)/_layout.tsx");
  const recordScreen = read("app/(tabs)/on.tsx");
  const queryBoundary = read("components/QueryClientBoundary.tsx");
  const notificationDeepLink = read("lib/useNotificationDeepLink.ts");

  it("starts on the record tab even when the root URL resolves to inbox", () => {
    expect(tabLayout).toContain('initialRouteName="on"');
    expect(rootLayout).toContain(
      '(segments[1] as string) === "index"',
    );
    expect(rootLayout).toContain('router.replace("/(tabs)/on")');
    expect(rootLayout).toContain(
      "shouldDecideInitialRoute: !hasCompletedInitialNavigationRef.current",
    );
  });

  it("only forces the record tab once per session, then lets a deliberate inbox tap stay on inbox", () => {
    // The forced-records redirect must be gated by a ref that only allows
    // the very first post-hydration navigation check to redirect away from
    // the inbox route.
    expect(rootLayout).toContain(
      "const hasCompletedInitialNavigationRef = useRef(false);",
    );

    // The ref must flip to true after the first hydrated check regardless of
    // which way that check decided (not only when it actually redirected),
    // and it must not reset on every segment change — otherwise a user who
    // starts on the record tab and later taps the inbox tab for the first
    // time would still get bounced back to records.
    expect(rootLayout).toContain("if (!isHydrated) return;");
    expect(rootLayout).toContain(
      "hasCompletedInitialNavigationRef.current = true;",
    );
    expect(rootLayout).toContain("}, [isHydrated]);");
  });

  it("keeps the protected stack mounted while a foreground refresh synchronizes active reading", () => {
    const activeReadingContext = read("contexts/ActiveReadingContext.tsx");
    const refreshStart = activeReadingContext.indexOf(
      "const refreshActiveSession = useCallback",
    );
    const refreshEnd = activeReadingContext.indexOf("}, []);", refreshStart);
    const refreshBody = activeReadingContext.slice(refreshStart, refreshEnd);

    expect(refreshBody).not.toContain("setIsHydrated(false)");
    expect(rootLayout).toContain('if (Platform.OS === "web") return;');
    expect(rootLayout).toContain("void refreshActiveSession();");
  });

  it("passes the authenticated identity through the protected provider boundary", () => {
    const boundaryStart = rootLayout.indexOf("<QueryClientBoundary>");
    const userProviderStart = rootLayout.indexOf(
      "<UserProvider key={userId} userId={userId}>",
    );
    const boundaryEnd = rootLayout.indexOf("</QueryClientBoundary>");

    expect(boundaryStart).toBeGreaterThan(-1);
    expect(userProviderStart).toBeGreaterThan(boundaryStart);
    expect(boundaryEnd).toBeGreaterThan(userProviderStart);
    expect(rootLayout).toContain(
      "<UserProvider key={userId} userId={userId}>",
    );
    expect(rootLayout).toContain("screenLayout={renderQueryClientBoundary}");
    expect(queryBoundary).toContain(
      "<QueryClientProvider client={queryClient}>",
    );
    expect(queryBoundary).toContain(
      'import { queryClient } from "@/lib/queryClient";',
    );
  });

  it("wraps every native tab screen in the same QueryClient boundary", () => {
    expect(tabLayout).toContain(
      "screenLayout={renderQueryClientBoundary}",
    );
  });

  it("does not mount record query hooks in a detached native transition preview", () => {
    expect(recordScreen).toContain(
      "const queryClient = useContext(QueryClientContext);",
    );
    expect(recordScreen).toContain("if (!queryClient) return null;");
    expect(recordScreen).toContain("return <OnScreenContent />;");
  });

  it("keeps notification taps routed explicitly to inbox", () => {
    expect(notificationDeepLink).toContain(
      'router.replace("/(tabs)")',
    );
  });
});