import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const editorRoot = join(__dirname, ".");
const writingScreen = readFileSync(join(editorRoot, "../../app/on-01a.tsx"), "utf8");
const types = readFileSync(join(editorRoot, "types.ts"), "utf8");
const nativeEditor = readFileSync(join(editorRoot, "WebViewMarkdownEditor.tsx"), "utf8");
const webEditor = readFileSync(join(editorRoot, "WebViewMarkdownEditorWeb.tsx"), "utf8");
const webViewSource = readFileSync(join(editorRoot, "editorWebviewSrc/index.ts"), "utf8");

describe("quote insertion contract", () => {
  it("passes attribution through the shared native command", () => {
    expect(writingScreen).toContain("buildStoredSentenceQuote(sentence)");
    expect(writingScreen).toContain("insertQuote(quote.text, quote.attribution)");
    expect(types).toContain('{ type: "insertQuote"; text: string; attribution?: string }');
    expect(types).toContain("insertQuote: (text: string, attribution?: string) => void;");
    expect(nativeEditor).toContain(
      'sendCommand({ type: "insertQuote", text, attribution });',
    );
  });

  it("uses the same blockquote paragraphs on web and native WebView", () => {
    expect(webEditor).toContain("const quoteAttribution = attribution?.trim();");
    expect(webEditor).toContain("type: \"blockquote\"");
    expect(webEditor).toContain("quoteAttribution");
    expect(webViewSource).toContain("cmd.attribution");
    expect(webViewSource).toContain("type: \"blockquote\"");
    expect(webViewSource).toContain("quoteAttribution");
  });
});