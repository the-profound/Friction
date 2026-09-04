import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldApplyBodyTypographyGeneration } from "../../../lib/bodyTypographyDiagnostics";

const appRoot = join(__dirname, "../../..");
const read = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

describe("native writing editor typography contract", () => {
  it("applies one layout generation before ProseMirror is created", () => {
    const source = read("components/WebViewMarkdownEditor/editorWebviewSrc/index.ts");
    const nativeEditor = read("components/WebViewMarkdownEditor/WebViewMarkdownEditor.tsx");
    const initCase = source.slice(
      source.indexOf('case "init"'),
      source.indexOf('case "setMarkdown"'),
    );

    expect(initCase.indexOf("applyBodyMetrics")).toBeGreaterThanOrEqual(0);
    expect(initCase.indexOf("applyBodyMetrics")).toBeLessThan(
      initCase.indexOf("setupEditor"),
    );
    expect(nativeEditor).toContain(
      "layoutGeneration: typographyStateRef.current.generation",
    );
    expect(shouldApplyBodyTypographyGeneration(4, 3)).toBe(true);
    expect(shouldApplyBodyTypographyGeneration(4, 4)).toBe(true);
    expect(shouldApplyBodyTypographyGeneration(3, 4)).toBe(false);
  });

  it("keeps generated HTML synchronized with fixed iOS text scaling", () => {
    const builder = read("components/WebViewMarkdownEditor/buildEditorHtml.mjs");
    const generated = read("components/WebViewMarkdownEditor/editorHtml.ts");

    for (const source of [builder, generated]) {
      expect(source).toContain("-webkit-text-size-adjust:none");
      expect(source).toContain("text-size-adjust:none");
    }
    expect(builder).toContain('process.argv.includes("--check")');
    expect(read("package.json")).toContain('"check:editor-html"');
  });

  it("uses the Friction cursor token for web and native editor carets", () => {
    const tokens = read("constants/tokens.ts");
    const webEditor = read(
      "components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx",
    );
    const builder = read("components/WebViewMarkdownEditor/buildEditorHtml.mjs");
    const generated = read("components/WebViewMarkdownEditor/editorHtml.ts");
    const cursorColor = tokens.match(/cursorAccent:\s*"([^"]+)"/)?.[1];

    expect(cursorColor).toBe("#92323D");
    expect(webEditor).toContain(
      '"--editor-cursor-color": Colors.cursorAccent',
    );
    expect(webEditor).toContain(
      'caretColor: "var(--editor-cursor-color)"',
    );
    expect(webEditor).toContain(
      "caret-color: var(--editor-cursor-color)",
    );
    for (const source of [builder, generated]) {
      expect(source).toContain(
        `:root{--editor-cursor-color:${cursorColor}}`,
      );
      expect(source).toContain(
        "caret-color:var(--editor-cursor-color)",
      );
    }
  });

  it("reports effective metrics and line boundaries for mixed writing samples", () => {
    const source = read("components/WebViewMarkdownEditor/editorWebviewSrc/index.ts");
    const sample = [
      "# iOS 줄바꿈 확인",
      "",
      "가나다라마바사 mixed English words 띄어쓰기 경계를 확인합니다.",
      "",
      "- 목록과 한영 mixed item",
      "",
      "> 인용문에서도 같은 줄 경계를 확인합니다.",
    ].join("\n");

    expect(sample).toContain("mixed English");
    expect(sample).toContain("- 목록");
    expect(sample).toContain("> 인용문");
    expect(source).toContain("lineBreakOffsets: readLineBreakOffsets(probe)");
    expect(source).toContain("layoutGeneration,");
    expect(source).toContain("effectiveFontScaleRatio");
    expect(source).toContain("fontFamily: computed.fontFamily");
  });
});