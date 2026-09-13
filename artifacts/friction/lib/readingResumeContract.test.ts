import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("native reading resume contract", () => {
  it("retires page-turn callbacks and flushes progress at the suspension boundary", () => {
    const source = readSource("../app/read.tsx");
    expect(source).toContain("pageTurnGenerationRef.current += 1");
    expect(source).toContain("cancelAnimation(currentSlotSV)");
    expect(source).toContain("void flushPositionRef.current()");
    expect(source).toContain("entersReaderSuspension(previousState");
  });

  it("retires queued debounce generations before an immediate lifecycle flush", () => {
    const source = readSource("./useReadingSession.ts");
    expect(source).toContain("saveGenerationRef.current += 1");
    expect(source).toContain("saveBoundary.beginDispatch(true)");
    expect(source).toContain("generation !== saveGenerationRef.current");
    expect(source).toContain("if (!hydratedRef.current");
    expect(source).toContain("Math.max(saveRevisionRef.current + 1, Date.now())");
    expect(source).toContain("inFlightSaveRef.current?.key === saveKey");
    expect(source).toContain("if (saveIdentityRef.current === sessionIdentity) return");
    expect(source).toContain("lastPersistedPositionRef.current = null");
  });

  it("reinjects current content when the mounted WKWebView document reloads", () => {
    const source = readSource("../components/WebViewMarkdownReader/WebViewMarkdownReader.tsx");
    expect(source).toContain("onLoadStart={() =>");
    expect(source).toContain('bridge.reset("WebViewMarkdownReader document loaded")');
    expect(source).toContain("injectContent(htmlRef.current, pendingVersionRef.current)");
  });
});