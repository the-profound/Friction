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
    expect(rootLayout).toContain("!hasRedirectedRef.current");
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
      'router.replace("/(tabs)/index")',
    );
  });
});