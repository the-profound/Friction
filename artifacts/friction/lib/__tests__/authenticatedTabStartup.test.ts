import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, "../..", relativePath), "utf8");

describe("authenticated native tab startup", () => {
  const rootLayout = read("app/_layout.tsx");
  const tabLayout = read("app/(tabs)/_layout.tsx");
  const recordScreen = read("app/(tabs)/on.tsx");
  const notificationDeepLink = read("lib/useNotificationDeepLink.ts");

  it("starts directly on the record tab instead of transitioning through inbox", () => {
    expect(tabLayout).toContain('initialRouteName="on"');
    expect(rootLayout).not.toContain(
      '(segments[1] as string) === "index"',
    );
  });

  it("passes the authenticated identity through the protected provider boundary", () => {
    expect(rootLayout).toContain(
      "<UserProvider key={userId} userId={userId}>",
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