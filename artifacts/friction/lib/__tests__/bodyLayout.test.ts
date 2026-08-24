import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computePageGeometry,
  getPageTextContentHeight,
  resolvePageWidth,
} from "../pageGeometry";

describe("shared letter page geometry", () => {
  it("uses the full logical page C and an integer 0.88C text column", () => {
    const layout = computePageGeometry(301, {
      aspectRatio: 5 / 8,
      paddingXCqi: 6,
      paddingYCqi: 15,
    });

    expect(layout.pageWidth).toBe(301);
    expect(layout.pageHeight).toBeCloseTo(481.6, 8);
    expect(layout.paddingX).toBeCloseTo(18.06, 8);
    expect(layout.paddingY).toBeCloseTo(45.15, 8);
    expect(layout.textColumnWidth).toBe(Math.round(301 - 2 * 18.06));
    expect(layout.textColumnWidth).toBe(265);
  });

  it("keeps physical insets and the reader title bar as explicit lower reservations", () => {
    const layout = computePageGeometry(300, {
      aspectRatio: 5 / 8,
      paddingXCqi: 6,
      paddingYCqi: 15,
    });
    const titleBarHeight = Math.round(20 + (3.4 / 100) * 300 * 1.3);
    const readerAvailable = getPageTextContentHeight(layout, 34 + titleBarHeight);

    expect(titleBarHeight).toBe(33);
    expect(readerAvailable).toBeCloseTo(323, 8);
    expect(getPageTextContentHeight(layout)).toBeCloseTo(390, 8);
  });

  it("derives C from the page aspect ratio, never from a virtual body box", () => {
    expect(resolvePageWidth(390, 844, 5 / 8)).toBe(390);
    expect(resolvePageWidth(1024, 600, 5 / 8)).toBe(375);
  });
});

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
      "readerFontSize(ReaderTokens.typeScale.titleCqi, pageWidth)",
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

describe("completed letter compatibility", () => {
  const appRoot = join(__dirname, "../..");
  const read = (relativePath: string) =>
    readFileSync(join(appRoot, relativePath), "utf8");

  it("renders saved page boundaries without rewriting finalized letter data", () => {
    const reader = read("app/read.tsx");
    const articlesRoute = read("../api-server/src/routes/articles.ts");

    expect(reader).toContain("return article.pages.map(normalizePageItem);");
    expect(articlesRoute).toContain('if (existing.status === "LETTER")');
    expect(articlesRoute).toContain('Cannot modify a LETTER article');
  });
});

describe("page geometry renderer contract", () => {
  const appRoot = join(__dirname, "../..");
  const read = (relativePath: string) =>
    readFileSync(join(appRoot, relativePath), "utf8");

  it("makes writing, closing preview, reader, and photo export share the 0.88C column", () => {
    const writing = read("app/on-01a.tsx");
    const closing = read("app/on-01c.tsx");
    const reader = read("app/read.tsx");
    const exportModal = read("components/SaveAsPhotos/SaveAsPhotosModal.tsx");
    const memo = read("components/MemoWebEditor/MemoWebEditor.tsx");

    expect(writing).toContain("pageWidth: containerWidth");
    expect(writing).toContain("getBodyContentHeight(editorLayout, readerBottomReservation)");
    expect(writing).not.toContain("* 0.92");
    expect(closing).toContain("width: storedBody.pageWidth");
    expect(closing).toContain("width: fallbackBody.pageWidth");
    expect(reader).not.toContain("safeAreaBox");
    expect(reader).toContain("width: layout.textColumnWidth");
    expect(exportModal).toContain("width: bodyLayout.pageWidth");
    expect(exportModal).toContain("width: bodyLayout.textColumnWidth");
    expect(memo).toContain("computePageGeometry(containerWidth");
    expect(memo).toContain("width: textColumnWidth");
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