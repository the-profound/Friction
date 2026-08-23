import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("reader title typography", () => {
  const appRoot = join(__dirname, "../..");
  const read = (relativePath: string) =>
    readFileSync(join(appRoot, relativePath), "utf8");

  it("keeps title conversion anchored to the shared 6.4cqi token", () => {
    const tokens = read("constants/tokens.ts");
    const layout = read("lib/bodyLayout.ts");

    expect(tokens).toMatch(/titleCqi:\s*6\.4/);
    expect(tokens).toMatch(/titleScaleEm[\s\S]*this\.titleCqi\s*\/\s*this\.bodyCqi/);
    expect(layout).toContain(
      "readerFontSize(ReaderTokens.typeScale.titleCqi, containerWidth)",
    );
  });

  it("makes every WebView heading consume the title-size CSS variable", () => {
    const sharedCss = read("components/shared/bodyTypographyCss.ts");
    const editorHtml = read("components/WebViewMarkdownEditor/editorHtml.ts");
    const readerHtml = read("components/WebViewMarkdownReader/readerHtml.ts");
    const measureHtml = read("components/WebViewMeasureLayer/measureHtml.ts");
    const webMeasure = read("components/WebViewMeasureLayer/WebViewMeasureLayerWeb.tsx");
    const webEditor = read("components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx");

    expect(sharedCss).toContain("font-size:var(--title-font-size,${titleScaleEm}em)");
    expect(editorHtml).toContain("font-size:var(--title-font-size,6.4cqi)");
    expect(readerHtml).toContain('setProperty("--title-font-size",cmd.titleFontSizePx+"px")');
    expect(measureHtml).toContain('setProperty("--title-font-size",cmd.titleFontSizePx+"px")');
    expect(webMeasure).toContain("buildBodyTypographyCss");
    expect(webMeasure).toContain('rootSelector: ".webview-measure-layer"');
    expect(webEditor).toContain("ReaderTokens.typeScale.titleCqi");
  });
});

describe("thought card typography regression guards", () => {
  const appRoot = join(__dirname, "../..");
  const read = (relativePath: string) =>
    readFileSync(join(appRoot, relativePath), "utf8");

  it.each([240, 300, 420])(
    "keeps title/body font sizes at 6.4cqi/4cqi for a %dpx card",
    (cardWidth) => {
      const titleSize = (6.4 / 100) * cardWidth;
      const bodySize = (4 / 100) * cardWidth;

      expect(titleSize / bodySize).toBeCloseTo(6.4 / 4, 10);
    },
  );

  it("keeps compact preview limits out of the reading card", () => {
    const card = read("app/(tabs)/on.tsx");

    expect(card).toContain("getRecordCardContent(record)");
    expect(card).not.toContain("numberOfLines={titleLines}");
    expect(card).toContain('ellipsizeMode="tail"');
    expect(card).toContain("content.body || \"아직 적힌 내용이 없어요.\"");
  });

  it("uses the card width, not the padded text frame, for both font sizes", () => {
    const card = read("app/(tabs)/on.tsx");

    expect(card).toContain("readerFontSize(ReaderTokens.typeScale.titleCqi, width)");
    expect(card).toContain(
      "readerFontSize(ReaderTokens.typeScale.bodyCqi, width)",
    );
    expect(card).toContain("const bodyLines = Math.max(");
  });

  it("keeps the article card title tied to its scaled text frame", () => {
    const articleCard = read("components/ArticleCardItem/ArticleCardItem.tsx");

    expect(articleCard).toContain("const textFrameWidth = Math.max(1, w - pad * 2);");
    expect(articleCard).toContain(
      "readerFontSize(ReaderTokens.typeScale.titleCqi, textFrameWidth)",
    );
    expect(articleCard).toContain("numberOfLines={4}");
  });
});

describe("content list typography regression guards", () => {
  it("measures the rendered text frame before calculating title/body sizes", () => {
    const appRoot = join(__dirname, "../..");
    const card = readFileSync(join(appRoot, "app/(tabs)/on.tsx"), "utf8");

    expect(card).toContain("const [textFrameWidth, setTextFrameWidth] = useState(0);");
    expect(card).toContain("onLayout={(event) => {");
    expect(card).toContain("const nextWidth = Math.round(event.nativeEvent.layout.width);");
    expect(card).toContain("const contentWidth = textFrameWidth || fallbackTextWidth;");
    expect(card).toContain(
      "readerFontSize(ReaderTokens.typeScale.titleCqi, contentWidth)",
    );
    expect(card).toContain(
      "readerFontSize(ReaderTokens.typeScale.bodyCqi, contentWidth)",
    );
    expect(card).toContain("numberOfLines={bodyLines}");
  });
});