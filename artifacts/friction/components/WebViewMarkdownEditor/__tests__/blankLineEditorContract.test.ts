import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const frictionRoot = join(__dirname, "../../..");
const read = (path: string) => readFileSync(join(frictionRoot, path), "utf8");

describe("editor blank paragraph ownership", () => {
  it("registers the blank-aware paragraph schema on web and native", () => {
    const web = read("components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx");
    const native = read("components/WebViewMarkdownEditor/editorWebviewSrc/index.ts");

    expect(web).toContain("paragraph: false");
    expect(web).toContain("BlankAwareParagraph,");
    expect(native).toContain("BlankAwareParagraph,");
  });

  it("removes only a structurally empty synthetic caret paragraph during export", () => {
    for (const source of [
      read("components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx"),
      read("components/WebViewMarkdownEditor/editorWebviewSrc/index.ts"),
    ]) {
      expect(source).toContain(
        'getAttribute(CARET_PARAGRAPH_ATTRIBUTE) === "true"',
      );
      expect(source).toContain(".lastElementChild.hasChildNodes()");
    }
  });

  it("does not trim authored terminal characters in the native serializer", () => {
    const native = read(
      "components/WebViewMarkdownEditor/editorWebviewSrc/index.ts",
    );

    expect(native).toContain('md.replace(/\\n\\n$/, "")');
    expect(native).not.toContain("md.trimEnd()");
  });

  it("ships the paragraph ownership markers in the generated native editor", () => {
    const generated = read("components/WebViewMarkdownEditor/editorHtml.ts");

    expect(generated).toContain("data-friction-caret-paragraph");
    expect(generated).toContain("data-friction-preserved-blank");
  });

  it("normalizes emphasis delimiters at the web/native editor boundary", () => {
    const web = read("components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx");
    const native = read("components/WebViewMarkdownEditor/editorWebviewSrc/index.ts");
    const generated = read("components/WebViewMarkdownEditor/editorHtml.ts");

    expect(web).toContain("normalizeMarkdownEmphasisDelimiters");
    expect(web).toContain("td.turndown(root.innerHTML)");
    expect(native).toContain("normalizeMarkdownEmphasisDelimiters");
    expect(native).toContain('tag === "strong" || tag === "b"');
    expect(generated).toContain("data-friction-caret-paragraph");
  });

  it("parses multiline emphasis in the native editor before replacing line breaks", () => {
    const native = read("components/WebViewMarkdownEditor/editorWebviewSrc/index.ts");

    expect(native).toContain(
      'out.replace(/\\*\\*\\*([^*]+?)\\*\\*\\*/g, "<strong><em>$1</em></strong>")',
    );
    expect(native).toContain(
      'renderInline(paraLines.join("\\n")).replace(/\\n/g, "<br>")',
    );
    expect(native).not.toContain("[^*\\n]+?");
    expect(native).not.toContain("[^_\\n]+?");
  });
});