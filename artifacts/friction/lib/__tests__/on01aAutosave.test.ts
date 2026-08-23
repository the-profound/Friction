import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const readScreen = () => readFileSync(join(appRoot, "app/on-01a.tsx"), "utf8");

describe("on-01a initial WebView export autosave regression", () => {
  it("ignores the export caused by injecting unchanged server content", () => {
    const screen = readScreen();

    expect(screen).toContain("const serverInjectionPendingRef = useRef(false);");
    expect(screen).toContain("if (serverInjectionPendingRef.current) {");
    expect(screen).toContain("if (md === serverContentRef.current) {");
    expect(screen).toContain("ignored initial server export");
  });

  it("keeps changed exports on the existing autosave path", () => {
    const screen = readScreen();
    const exportHandler = screen.slice(
      screen.indexOf("const handleAutosaveExport"),
      screen.indexOf("const handleEditorChange"),
    );

    expect(exportHandler).toContain("serverInjectionPendingRef.current = false;");
    expect(exportHandler).toContain("markDirty(titleRef.current, md);");
    expect(screen).toContain(
      "pendingExportsRef.current.set(requestId, handleAutosaveExport);",
    );
  });
});