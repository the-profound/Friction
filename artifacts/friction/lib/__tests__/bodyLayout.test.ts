import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: {
    OS: "web",
    select: (options: Record<string, unknown>) => options.web ?? options.default,
  },
}));
import {
  computePageGeometry,
  getPageTextContentHeight,
  resolvePageWidth,
} from "../pageGeometry";
import { calculateCardReturnDistance } from "../../components/CardSelectOverlay/returnDistance";
import {
  BODY_FONT_FALLBACK_PROBE_TEXT,
  BODY_REGULAR_FONT_FAMILY,
  BODY_SEMIBOLD_FONT_FAMILY,
  buildBodyFontReadyScript,
  buildEmbeddedBodyFontFaceCss,
} from "../../components/shared/bodyTypographyFonts";
import { buildBodyTypographyCss } from "../../components/shared/bodyTypographyCss";
import { bodyTypographyMetrics, computeBodyLayout } from "../bodyLayout";
import { markdownToHtml } from "../markdownRenderer";
import { splitContentToPages } from "../pageDivision";
import { parseMarkdownBlocks } from "../../utils/markdownParser";
import { ReaderTokens } from "../../constants/tokens";

describe("letter body font fallback contract", () => {
  it("registers WOFF2 as a Metro asset without dropping the default assets", () => {
    const metroConfig = readFileSync(
      join(__dirname, "../../metro.config.js"),
      "utf8",
    );

    expect(metroConfig).toMatch(
      /config\.resolver\.assetExts\s*=\s*Array\.from\(/,
    );
    expect(metroConfig).toContain(
      'new Set([...config.resolver.assetExts, "woff2"])',
    );
  });

  it("embeds compressed Eulyoo and Noto Serif KR WOFF2 faces", () => {
    const css = buildEmbeddedBodyFontFaceCss({
      regularBase64: "eulyoo-regular",
      semiBoldBase64: "eulyoo-semibold",
      notoRegularBase64: "noto-regular",
      notoSemiBoldBase64: "noto-semibold",
    });

    expect(css).toContain("data:font/woff2;base64,eulyoo-regular");
    expect(css).toContain("data:font/woff2;base64,noto-regular");
    expect(css.match(/format\('woff2'\)/g)).toHaveLength(4);
    expect(css).not.toContain("font-weight:700");
    expect(BODY_REGULAR_FONT_FAMILY).toBe(
      "'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif",
    );
    expect(BODY_SEMIBOLD_FONT_FAMILY).toBe(
      "'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif",
    );
  });

  it("keeps each embedded body font compressed enough for concurrent WebViews", () => {
    const fontDir = join(__dirname, "../../assets/fonts");
    const files = [
      "Eulyoo1945-Regular.woff2",
      "Eulyoo1945-SemiBold.woff2",
      "NotoSerifKR-400Regular-korean.woff2",
      "NotoSerifKR-600SemiBold-korean.woff2",
    ];
    let embeddedBytes = 0;
    for (const file of files) {
      const font = readFileSync(join(fontDir, file));
      expect(font.subarray(0, 4).toString("ascii")).toBe("wOF2");
      expect(font.byteLength).toBeLessThan(1_600_000);
      embeddedBytes += font.byteLength;
    }
    const previousEulyooOnlyBytes =
      readFileSync(join(fontDir, "Eulyoo1945-Regular.otf")).byteLength +
      readFileSync(join(fontDir, "Eulyoo1945-SemiBold.otf")).byteLength;
    expect(embeddedBytes).toBeLessThan(previousEulyooOnlyBytes + 100_000);
  });

  it("waits for the fallback-only glyph before native rendering and measurement", () => {
    expect(BODY_FONT_FALLBACK_PROBE_TEXT).toContain("잓");
    const script = buildBodyFontReadyScript(true);
    expect(script).toContain("document.fonts.load");
    expect(script).toContain("NotoSerifKR_400Regular");
    expect(script).toContain("NotoSerifKR_600SemiBold");
    expect(script).toContain("onBodyFontsReady");
    expect(script).toContain("setTimeout");
    expect(script).toContain("freezeFallback");
    expect(script).toContain('--body-regular-font-family","serif"');
  });

  it("resolves readiness without invoking font loads when embedded faces are unavailable", async () => {
    const posted: unknown[] = [];
    let loadHandler: (() => void) | undefined;
    const load = vi.fn();
    const windowStub = {
      __rnBridge: { post: (event: unknown) => posted.push(event) },
      addEventListener: (_type: string, handler: () => void) => {
        loadHandler = handler;
      },
    };
    const documentStub = {
      fonts: { load, ready: Promise.resolve() },
    };
    const source = buildBodyFontReadyScript(false).replace(/^<script>|<\/script>$/g, "");
    new Function("window", "document", "setTimeout", "clearTimeout", source)(
      windowStub,
      documentStub,
      setTimeout,
      clearTimeout,
    );
    loadHandler?.();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(load).not.toHaveBeenCalled();
    expect(posted[0]).toMatchObject({ type: "onBodyFontsReady", ok: true });
  });

  it("checks all four embedded faces with the Korean fallback probe", async () => {
    const posted: unknown[] = [];
    let loadHandler: (() => void) | undefined;
    const load = vi.fn((_font: string, _probe: string) => Promise.resolve([]));
    const windowStub = {
      __rnBridge: { post: (event: unknown) => posted.push(event) },
      addEventListener: (_type: string, handler: () => void) => {
        loadHandler = handler;
      },
    };
    const documentStub = {
      fonts: { load, ready: Promise.resolve() },
    };
    const source = buildBodyFontReadyScript(true).replace(/^<script>|<\/script>$/g, "");
    new Function("window", "document", "setTimeout", "clearTimeout", source)(
      windowStub,
      documentStub,
      setTimeout,
      clearTimeout,
    );
    loadHandler?.();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(load).toHaveBeenCalledTimes(4);
    expect(load.mock.calls.every((call) => call[1] === BODY_FONT_FALLBACK_PROBE_TEXT)).toBe(true);
    expect(posted[0]).toMatchObject({ type: "onBodyFontsReady", ok: true });
  });

  it("uses the four-font readiness gate in editor, reader, and measurement WebViews", () => {
    const appRoot = join(__dirname, "../..");
    const read = (relativePath: string) =>
      readFileSync(join(appRoot, relativePath), "utf8");
    const layout = read("app/_layout.tsx");
    const editor = read("components/WebViewMarkdownEditor/WebViewMarkdownEditor.tsx");
    const reader = read("components/WebViewMarkdownReader/WebViewMarkdownReader.tsx");
    const measure = read("components/WebViewMeasureLayer/WebViewMeasureLayer.tsx");
    const webEditor = read("components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx");
    const webReader = read("components/WebViewMarkdownReader/WebViewMarkdownReaderWeb.tsx");
    const webMeasure = read("components/WebViewMeasureLayer/WebViewMeasureLayerWeb.tsx");

    expect(layout).toContain("NotoSerifKR-400Regular-korean.woff2");
    expect(layout).toContain("NotoSerifKR-600SemiBold-korean.woff2");
    expect(layout).toContain("setEditorFonts(regular, semiBold, notoRegular, notoSemiBold)");
    for (const source of [editor, reader, measure]) {
      expect(source).toContain("areEditorFontsReady");
      expect(source).toContain("onBodyFontsReady");
      expect(source).toContain("notoRegularBase64");
      expect(source).toContain("notoSemiBoldBase64");
      expect(source).toContain("textZoom={100}");
    }
    for (const source of [webEditor, webReader, webMeasure]) {
      expect(source).toContain("BODY_REGULAR_FONT_FAMILY");
      expect(source).toContain("waitForWebBodyFonts");
      expect(source).toContain("logWebBodyTypographyDiagnostic");
    }
  });

  it("keeps native editor commands and touch handling intact when regenerating HTML", () => {
    const editorSource = readFileSync(
      join(__dirname, "../../components/WebViewMarkdownEditor/editorWebviewSrc/index.ts"),
      "utf8",
    );
    const editorBundle = readFileSync(
      join(__dirname, "../../components/WebViewMarkdownEditor/editorHtml.ts"),
      "utf8",
    );
    const editableCase = editorSource.slice(
      editorSource.indexOf('case "setEditable"'),
      editorSource.indexOf('case "setSourceArticleSlot"'),
    );
    const overflowCase = editorSource.slice(
      editorSource.indexOf('case "setOverflowRanges"'),
      editorSource.indexOf('case "setOverflowProbeConfig"'),
    );
    const swipeSection = editorSource.slice(
      editorSource.indexOf("let swipeStartY"),
      editorSource.indexOf("// ── Selection handle drag detection"),
    );

    expect(editableCase).toContain("const next = !!cmd.isEditable;");
    expect(editableCase).not.toContain("availableContentHeightPx");
    expect(overflowCase).toContain("setMeta(overflowPluginKey, { ranges })");
    expect(overflowCase).not.toContain("ranges: []");
    expect(editorSource).toContain('document.addEventListener("focusout"');
    expect(editorSource).toContain("const target = e.target as Element;");
    expect(swipeSection).toContain("const dy = e.touches[0].clientY - swipeStartY;");
    expect(swipeSection).not.toContain("selHandleDragStartY");

    expect(editorBundle).toMatch(
      /case"setEditable":\{let \w+=!!\w+\.isEditable;/,
    );
    expect(editorBundle).toMatch(
      /case"setOverflowRanges":\{[^}]+setMeta\(\w+,\{ranges:\w+\}\)/,
    );
    expect(editorBundle).toContain('addEventListener("focusout"');
    expect(editorBundle).toMatch(
      /\.touches\[0\]\.clientY-[\w$]+>[\w$]+&&\([\w$]+=!0,[\w$]+\(\{type:"onSwipeDownToDismiss"\}\)\)/,
    );
  });
});

describe("shared letter page geometry", () => {
  it.each([240, 301, 390])("creates one exact Korean body contract at %dpx", (width) => {
    const metrics = bodyTypographyMetrics(computeBodyLayout(width));
    const koreanProbe = "가나다라마바사아자차카타파하잓";
    expect(koreanProbe).toContain("잓");
    expect(metrics.textColumnWidth).toBe(Math.round(width * 0.88));
    expect(metrics.fontSizePx).toBeCloseTo(width * 0.04);
    expect(ReaderTokens.lineHeight.relaxed).toBe(1.8);
    expect(ReaderTokens.paragraphSpacing.bodyEm).toBe(0.6);
    expect(metrics.lineHeightPx).toBeCloseTo(
      metrics.fontSizePx * ReaderTokens.lineHeight.relaxed,
    );
    expect(metrics.paragraphGapPx).toBeCloseTo(
      metrics.fontSizePx * ReaderTokens.paragraphSpacing.bodyEm,
    );
    expect(metrics.letterSpacingPx).toBeCloseTo(metrics.fontSizePx * 0.05);
    expect(metrics.textScalePercent).toBe(100);
  });

  it("uses the shared paragraph-gap variable in visible body CSS only", () => {
    const visibleCss = buildBodyTypographyCss({
      rootSelector: ".reader",
      blockSelector: ".reader",
      blockMargins: "spaced",
      hrStyle: "spaced",
    });
    const measureCss = buildBodyTypographyCss({
      rootSelector: ".measure",
      blockSelector: ".measure",
      blockMargins: "zero",
      hrStyle: "measure",
    });

    expect(visibleCss).toContain(
      ".reader p{margin-bottom:var(--body-paragraph-gap)",
    );
    expect(measureCss).toContain(".measure p{margin:0");
    expect(measureCss).not.toContain(
      "margin-bottom:var(--body-paragraph-gap)",
    );
  });

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

    expect(sharedCss).toContain("font-size:var(--title-font-size)");
    expect(editorHtml).toContain("font-size:var(--title-font-size)");
    expect(editorHtml).not.toContain("var(--title-font-size,");
    expect(editorHtml).toContain("const bodyTypographyCss = buildBodyTypographyCss");
    expect(editorHtml).toContain("<style>${fontFaceCSS}${bodyTypographyCss}");
    expect(editorHtml).toContain("paragraphGapPx");
    expect(readerHtml).toContain('setProperty("--title-font-size",m.titleFontSizePx+"px")');
    expect(measureHtml).toContain('setProperty("--title-font-size",m.titleFontSizePx+"px")');
    expect(readerHtml).toContain('setProperty("--body-paragraph-gap",m.paragraphGapPx+"px")');
    expect(measureHtml).toContain('var gap=m.paragraphGapPx');
    expect(webMeasure).toContain("buildBodyTypographyCss");
    expect(webMeasure).toContain('rootSelector: ".webview-measure-layer"');
    expect(webEditor).toContain('"--title-font-size": `${typography.titleFontSizePx}px`');
    expect(webEditor).toContain('"--body-paragraph-gap": `${typography.paragraphGapPx}px`');
  });

  it("reports the same effective metric fields from every renderer", () => {
    const diagnostics = read("lib/bodyTypographyDiagnostics.ts");
    const readerHtml = read("components/WebViewMarkdownReader/readerHtml.ts");
    const measureHtml = read("components/WebViewMeasureLayer/measureHtml.ts");
    const editorSource = read("components/WebViewMarkdownEditor/editorWebviewSrc/index.ts");
    const required = [
      "domWidthPx",
      "fontSizePx",
      "lineHeightPx",
      "letterSpacingPx",
      "textSizeAdjust",
      "devicePixelRatio",
      "configuredTextZoomPercent",
      "effectiveFontScaleRatio",
      "eulyooRegular",
      "eulyooSemiBold",
    ];
    for (const field of required) {
      expect(diagnostics).toContain(field);
      expect(readerHtml).toContain(field);
      expect(measureHtml).toContain(field);
      expect(editorSource).toContain(field);
    }
  });

  it("uses one editor typography contract with no nested horizontal inset", () => {
    const nativeEditor = read("components/WebViewMarkdownEditor/editorHtml.ts");
    const nativeEditorSource = read("components/WebViewMarkdownEditor/editorWebviewSrc/index.ts");
    const webEditor = read("components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx");
    const writingScreen = read("app/on-01a.tsx");
    const css = buildBodyTypographyCss({
      rootSelector: "#editor-content",
      blockSelector: ".ProseMirror",
      blockMargins: "spaced",
      hrStyle: "flush",
    });

    expect(css).toContain("#editor-content{font-family:");
    expect(css).toContain(".ProseMirror li p{margin-bottom:0}");
    expect(css).toContain("overflow-wrap:break-word");
    expect(css).toContain("word-break:normal");
    expect(css).toContain("text-size-adjust:100%");
    expect(nativeEditor).toContain("buildBodyTypographyCss");
    expect(nativeEditor).toContain('rootSelector: "#editor-content"');
    expect(nativeEditor).toContain("width:var(--text-column-width)");
    expect(nativeEditor).toContain(".hr-wrapper{position:relative;margin:1em 0;cursor:pointer}");
    expect(nativeEditor).not.toContain("cursor:pointer;padding:10px 0");
    expect(nativeEditor).toContain(
      ".tiptap-question-block{background-color:#eff6ff;border-radius:6px;padding:0;margin:0 0 1em}",
    );
    expect(nativeEditor).toContain(".tiptap-question-block p::before{content:'Q. '}");
    expect(nativeEditor).toContain(
      ".tiptap-question-block p{margin:0;font-family:var(--body-regular-font-family",
    );
    expect(nativeEditorSource).toContain('setProperty("--text-column-width"');
    expect(nativeEditorSource).toContain("metrics.lineHeightPx !== lastBodyLineHeightPx");
    expect(nativeEditorSource).toContain('case "setBodyFontMode"');
    expect(webEditor).toContain("buildBodyTypographyCss");
    expect(webEditor).toContain('rootSelector: ".web-markdown-editor-scroll-container"');
    expect(webEditor).toContain("width: var(--text-column-width)");
    expect(webEditor).toContain("padding: 16px 0 120px");
    expect(webEditor).not.toContain("padding: 16px 24px 120px");
    expect(webEditor).toContain('padding: "8px 0"');
    expect(webEditor).toContain("hasCompleteBodyFontSet");
    expect(writingScreen).toContain(
      "width: textColumnWidth, alignSelf: \"center\"",
    );
  });

  it("keeps representative Korean Markdown blocks in the shared rendering vocabulary", () => {
    const probe = [
      "# 플랫폼 줄바꿈 확인",
      "",
      "가잓 같은 폴백 글자와 가나다라마바사아자차카타파하",
      "공백없는긴문자열공백없는긴문자열공백없는긴문자열",
      "",
      "- 목록 **강조**",
      "1. 순서 목록 <u>밑줄</u>",
      "",
      "> 인용문은 같은 폭과 줄바꿈 규칙을 사용한다.",
      "",
      "---",
    ].join("\n");
    const html = markdownToHtml(probe);

    expect(html).toContain("<h1>플랫폼 줄바꿈 확인</h1>");
    expect(html).toContain("공백없는긴문자열");
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<strong>강조</strong>");
    expect(html).toContain("<u>밑줄</u>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr>");

    const pages = splitContentToPages("첫 페이지\n---\n두 번째 페이지");
    expect(pages.map((page) => parseMarkdownBlocks(page.content))).toEqual([
      [
        expect.objectContaining({
          type: "paragraph",
          rawText: "첫 페이지",
        }),
      ],
      [
        expect.objectContaining({
          type: "paragraph",
          rawText: "두 번째 페이지",
        }),
      ],
    ]);
  });

  it("ties measurement callbacks to the request that produced them", () => {
    const writingScreen = read("app/on-01a.tsx");
    const nativeMeasure = read("components/WebViewMeasureLayer/WebViewMeasureLayer.tsx");
    const webMeasure = read("components/WebViewMeasureLayer/WebViewMeasureLayerWeb.tsx");

    expect(nativeMeasure).toContain(
      "onMeasured: (heights: Record<string, number>, request: MeasureRequest) => void",
    );
    expect(nativeMeasure).toContain("onMeasuredRef.current(heights ?? {}, req)");
    expect(webMeasure).toContain("onMeasuredRef.current(heights, request)");
    expect(webMeasure).toContain("latestMeasureSeqRef");
    expect(webMeasure).toContain("hasCompleteBodyFontSet");
    expect(read("lib/bodyTypographyDiagnostics.ts")).toContain(
      "webBodyFontReadyPromise",
    );
    expect(writingScreen).toContain(
      "if (measuredRequest !== warningRequestRef.current) return",
    );
    expect(writingScreen).toContain(
      "warningMeasurement.request === warningRequest",
    );
    expect(writingScreen).toContain(
      "pending.request !== measuredRequest",
    );
    expect(writingScreen).toContain("fontMode: nativeBodyFontMode");
    expect(writingScreen).toContain(
      "pending.request.fontMode === nativeBodyFontMode",
    );
    expect(writingScreen).toContain(
      "measuredRequest.fontMode !== getNativeBodyFontMode()",
    );
    const nativeFontMode = read("lib/nativeBodyFontMode.ts");
    expect(nativeFontMode).toContain("if (!ok && mode !== \"fallback\")");
    expect(nativeFontMode).toContain("for (const listener of listeners)");
  });

  it("hides only the web editor scrollbar while preserving its scroll container", () => {
    const webEditor = read("components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx");
    const nativeEditor = read("components/WebViewMarkdownEditor/WebViewMarkdownEditor.tsx");

    expect(webEditor).toContain('className="web-markdown-editor-scroll-container"');
    expect(webEditor).toContain("scrollbar-width: none");
    expect(webEditor).toContain("-ms-overflow-style: none");
    expect(webEditor).toContain(".web-markdown-editor-scroll-container::-webkit-scrollbar");
    expect(webEditor).toContain('overflow: "auto"');
    expect(nativeEditor).toContain("showsVerticalScrollIndicator={false}");
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

  it("makes writing, closing preview, reader, and memo share the 0.88C column", () => {
    const writing = read("app/on-01a.tsx");
    const closing = read("app/on-01c.tsx");
    const reader = read("app/read.tsx");
    const memo = read("components/MemoWebEditor/MemoWebEditor.tsx");

    expect(writing).toContain("pageWidth: containerWidth");
    expect(writing).toContain("getBodyContentHeight(editorLayout, readerBottomReservation)");
    expect(writing).not.toContain("* 0.92");
    expect(closing).toContain("width: storedBody.pageWidth");
    expect(closing).toContain("width: fallbackBody.pageWidth");
    expect(reader).not.toContain("safeAreaBox");
    expect(reader).toContain("width: layout.textColumnWidth");
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
    expect(card).toContain("const bodyLines = getRecordCardBodyLineCount({");
    expect(card).toContain("numberOfLines={2}");
  });

  it("keeps the article card title tied to its scaled text frame", () => {
    const tokens = read("constants/tokens.ts");
    const cardCover = read("components/ArticleCardItem/ArticleCardCover.tsx");

    expect(tokens).toMatch(/titleCqi:\s*6\.4/);
    expect(tokens).toMatch(/cardTitleCqi:\s*11\.2/);
    expect(cardCover).toContain(
      "const textFrameWidth = Math.max(1, resolvedWidth - pad * 2);",
    );
    expect(cardCover).toContain(
      "readerFontSize(ReaderTokens.typeScale.cardTitleCqi, textFrameWidth)",
    );
    expect(cardCover).toContain("numberOfLines={4}");
  });

  it("renders a 300px card title at about 32px without changing reader title scale", () => {
    const cardTextFrameWidth = 300 - 24 * 2;
    const cardTitleSize = (11.2 / 100) * cardTextFrameWidth;

    expect(cardTitleSize).toBeCloseTo(28.224, 3);
    expect((6.4 / 100) * 300).toBeCloseTo(19.2, 3);
  });

  it("renders filtered letters with the shared cover card at the fixed card ratio", () => {
    const recordsScreen = read("app/(tabs)/on.tsx");

    expect(recordsScreen).toContain('import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";');
    expect(recordsScreen).toContain('if (record.kind === "letter")');
    expect(recordsScreen).toContain("cover={record.article.cover}");
    expect(recordsScreen).toContain("if (record.kind === \"letter\") return baseHeight;");
    expect(recordsScreen).toContain("return baseHeight;");
  });

  it("attaches both card lists to one-step date paging and anchor restoration", () => {
    const recordsScreen = read("app/(tabs)/on.tsx");
    const inboxScreen = read("app/(tabs)/index.tsx");
    const pagingHook = read("hooks/useDateGroupVerticalSnap.ts");
    const dots = read("components/DotIndicator/DotIndicator.tsx");

    expect(recordsScreen).toContain("ref={recordListRef}");
    expect(recordsScreen).toContain("ref={recordListViewportRef}");
    expect(recordsScreen).toContain("verticalDateSnap.setGroupRef(item.dateKey, node)");
    expect(recordsScreen).toContain("estimatedGroupHeights: estimatedRecordGroupHeights");
    expect(recordsScreen).toContain("useDateGroupVerticalSnap({");
    expect(inboxScreen).toContain("useDateGroupVerticalSnap({");
    for (const [source, controllerName] of [
      [recordsScreen, "verticalDateSnap"],
      [inboxScreen, "inboxVerticalDateSnap"],
    ] as const) {
      expect(source).toContain(`${controllerName}.onScrollEndDrag`);
      expect(source).toContain("onWheel: ");
      expect(source).toContain('Platform.OS !== "web"');
      expect(source).toContain("pageLocked");
    }
    expect(pagingHook).toContain("getDateGroupPageDecision(");
    expect(pagingHook).toContain("onMoveShouldSetPanResponderCapture");
    expect(pagingHook).toContain("wheelDistanceRef.current -= rawDelta * multiplier");
    expect(pagingHook).toContain("measurementGeneration !== layoutGenerationRef.current");
    expect(pagingHook).toContain("shouldApplyDateGroupMeasurement(");
    expect(pagingHook).not.toContain("onMomentumScrollEnd");
    expect(pagingHook).not.toContain("getDateGroupSnapTarget");
    expect(pagingHook).not.toContain("scheduleSettle");
    expect(dots).toContain("{total > 1 ? dots.map");
  });
});

describe("selectable article card projection contract", () => {
  const appRoot = join(__dirname, "../..");
  const read = (relativePath: string) =>
    readFileSync(join(appRoot, relativePath), "utf8");

  it("projects the canonical card into small slots with an outer transform", () => {
    const slot = read("components/ArticleCardItem/CanonicalCardSlot.tsx");

    expect(slot).toContain("width: Sizing.cardSlotW");
    expect(slot).toContain("height: canonicalHeight");
    expect(slot).toContain("transform: [{ scale }]");
    expect(slot).toContain('overflow: "hidden"');
  });

  it("keeps the space creator metadata on the canonical layout path", () => {
    const myTab = read("app/(tabs)/to.tsx");
    const profile = read("app/user-profile/[userId].tsx");
    const space = read("app/of-space-detail.tsx");

    expect(space).toContain("<View style={styles.metaIconRow}>");
    expect(space).not.toContain("onPress={() => handleNavigateToAuthor(space.creatorId)}");
    expect(space).not.toContain('testID="space-creator-profile"');
    expect(space).not.toContain('name="chevron-right" size={12} color={Colors.zinc400}');
    expect(space).toContain("!space.isAnonymous ?");
    expect(space).toContain("익명 공간장");
  });

  it("disables info-bar navigation back to the screen's current entity", () => {
    const overlay = read("components/CardSelectOverlay/CardSelectOverlay.tsx");

    expect(overlay).toContain("isRead={meta.isRead ?? false}");
    expect(overlay).toContain("isRead={displayMetas[0]?.isRead ?? false}");
  });

  it("waits for the overlay's origin card before hiding its source slot", () => {
    const overlay = read("components/CardSelectOverlay/CardSelectOverlay.tsx");
    const inbox = read("app/(tabs)/index.tsx");
    const myTab = read("app/(tabs)/to.tsx");
    const profile = read("app/user-profile/[userId].tsx");
    const space = read("app/of-space-detail.tsx");

    expect(space).toContain('router.push(`/user-profile/${authorId}` as never);');
    expect(space).toContain("onNavigateToAuthor={handleNavigateToAuthor}");
    expect(space).toContain(
      "authorId: isAnonymousSpace ? null : tapLetter.authorId ?? null,",
    );
    expect(space).toContain("collectionName: space?.name ?? null,");
    expect(space).not.toContain("collectionId: id");
  });

  it("makes the non-anonymous space creator row open the creator profile", () => {
    const space = read("app/of-space-detail.tsx");

    expect(space).toContain('router.push(`/user-profile/${authorId}` as never);');
    expect(space).toContain("onNavigateToAuthor={handleNavigateToAuthor}");
    expect(space).toContain(
      "authorId: isAnonymousSpace ? null : tapLetter.authorId ?? null,",
    );
    expect(space).toContain("collectionName: space?.name ?? null,");
    expect(space).not.toContain("collectionId: id");
  });

  it("renders the non-anonymous space creator row as static metadata", () => {
    const space = read("app/of-space-detail.tsx");

    expect(space).toContain("<View style={styles.metaIconRow}>");
    expect(space).not.toContain("onPress={() => handleNavigateToAuthor(space.creatorId)}");
    expect(space).not.toContain('testID="space-creator-profile"');
    expect(space).not.toContain('name="chevron-right" size={12} color={Colors.zinc400}');
    expect(space).toContain("!space.isAnonymous ?");
    expect(space).toContain("익명 공간장");
  });

  it("disables info-bar navigation back to the screen's current entity", () => {
    const overlay = read("components/CardSelectOverlay/CardSelectOverlay.tsx");
    const myTab = read("app/(tabs)/to.tsx");
    const profile = read("app/user-profile/[userId].tsx");
    const collection = read("app/of-01-detail.tsx");

    expect(overlay).toContain("currentCollectionId?: string | null;");
    expect(overlay).toContain("currentAuthorId?: string | null;");
    expect(overlay).toContain("collectionId !== currentCollectionId");
    expect(overlay).toContain("authorId !== currentAuthorId");
    expect(myTab).toContain("currentAuthorId={userId}");
    expect(profile).toContain("currentAuthorId={profileUserId}");
    expect(collection).toContain("currentCollectionId={id}");
  });

  it("makes non-anonymous participant names open profiles without exposing anonymous identities", () => {
    const participants = read("app/of-space-participants.tsx");

    expect(participants).toContain("onNavigateToAuthor?: (authorId: string) => void;");
    expect(participants).toContain("const canNavigateToProfile = !isAnonymous");
    expect(participants).toContain('name="chevron-right" size={12} color={Colors.zinc400}');
    expect(participants).toContain('router.push(`/user-profile/${authorId}` as never);');
    expect(participants).toContain("onNavigateToAuthor={handleNavigateToAuthor}");
    expect(participants).toContain("accountNickname ?? \"알 수 없음\"");
    expect(participants).not.toContain("isAnonymous && onNavigateToAuthor");
  });

  it("returns the overlay to its source with one shared distance-based motion", () => {
    const overlay = read("components/CardSelectOverlay/CardSelectOverlay.tsx");
    const closeBlock = overlay.slice(
      overlay.indexOf("// ── Close animation"),
      overlay.indexOf("// ── Envelope opening animation"),
    );

    expect(overlay).toContain("const OPEN_MIN_DURATION = 150;");
    expect(overlay).toContain("const OPEN_MAX_DURATION = 280;");
    expect(overlay).toContain("const OPEN_DURATION_PER_PIXEL = 0.2;");
    expect(overlay).toContain("const CLOSE_MIN_DURATION = 150;");
    expect(overlay).toContain("const CLOSE_MAX_DURATION = 320;");
    expect(overlay).toContain("const CLOSE_DURATION_PER_PIXEL = 0.25;");
    expect(overlay).toContain("const TRANSITION_EASING = Easing.out(Easing.poly(4));");
    expect(overlay).toContain("const getOpenDuration = (distance: number)");
    expect(overlay).toContain("const getCloseDuration = (distance: number)");
    expect(overlay).toContain("Animated.timing(progress, {");
    expect(overlay).toContain("duration: getOpenDuration(");
    expect(overlay).toContain("easing: TRANSITION_EASING");
    expect(closeBlock).toContain("progress.stopAnimation((currentProgress) =>");
    expect(closeBlock).toContain("swipeY.stopAnimation((currentSwipeY) =>");
    expect(closeBlock).toContain("carouselX.stopAnimation((currentCarouselX) =>");
    expect(closeBlock).toContain("calculateCardReturnDistance({");
    expect(closeBlock).toContain("const closeDuration = getCloseDuration(calculateCardReturnDistance({");
    expect(closeBlock).toContain("const closeTiming = (value: Animated.Value, toValue: number)");
    expect(closeBlock).toContain("closeTiming(carouselX, -initIdx * SLOT_W)");
    expect(closeBlock).toContain("duration: closeDuration");
    expect(closeBlock).toContain("easing: TRANSITION_EASING");
    expect(closeBlock).not.toContain("CLOSE_DURATION = 140");
  });

  it("cross-fades the carousel source shadow on the hero progress used for return", () => {
    const overlay = read("components/CardSelectOverlay/CardSelectOverlay.tsx");
    const card = read("components/ArticleCardItem/ArticleCardItem.tsx");

    const scalePressable = read("components/shared/ScalePressable.tsx");
    const inbox = read("app/(tabs)/index.tsx");
    const baseTransform = {
      startTx: 0,
      originScale: 1,
      finalScale: 1,
      cardWidth: 300,
      progress: 1,
      carouselX: 0,
      carouselTargetX: 0,
    };

    expect(calculateCardReturnDistance({ ...baseTransform, startTy: 100, swipeY: 0 })).toBe(100);
    expect(calculateCardReturnDistance({ ...baseTransform, startTy: 100, swipeY: 50 })).toBe(50);
    expect(calculateCardReturnDistance({ ...baseTransform, startTy: -100, swipeY: 50 })).toBe(150);
  });

  it("includes unfinished scale and carousel movement in the return distance", () => {
    expect(
      calculateCardReturnDistance({
        startTx: 0,
        startTy: 0,
        originScale: 0.5,
        finalScale: 1,
        cardWidth: 300,
        progress: 1,
        swipeY: 0,
        carouselX: -20,
        carouselTargetX: -80,
      }),
    ).toBe(210);
  });

  it("keeps details fixed and fades them while a resisted vertical dismiss drags only the card", () => {
    const overlay = read("components/CardSelectOverlay/CardSelectOverlay.tsx");
    const verticalGestureBlock = overlay.slice(
      overlay.indexOf("// ── Pan responder (horizontal carousel + vertical dismiss)"),
      overlay.indexOf("// ── Active card info"),
    );
    const detailsBlock = overlay.slice(
      overlay.indexOf("{/* Details (info bar)"),
      overlay.indexOf("{/* Full-screen fade-to-black overlay"),
    );

    expect(overlay).toContain("const DISMISS_FADE_DURATION = 100;");
    expect(overlay).toContain("const DISMISS_RESISTANCE_DISTANCE = 180;");
    expect(verticalGestureBlock).toContain("const beginVerticalDismiss = useCallback");
    expect(verticalGestureBlock).toContain("toValue: 0");
    expect(verticalGestureBlock).toContain("swipeY.setValue(applyDismissResistance(g.dy))");
    expect(verticalGestureBlock).toContain("restoreDetailsAfterDismiss()");
    expect(detailsBlock).not.toContain("transform: [{ translateY: swipeY }]");
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

describe("unified article card cover regression guards", () => {
  const appRoot = join(__dirname, "../..");
  const read = (relativePath: string) =>
    readFileSync(join(appRoot, relativePath), "utf8");

  it("shares the canonical card surface across card, reader, and preview", () => {
    const card = read("components/ArticleCardItem/ArticleCardItem.tsx");

    const scalePressable = read("components/shared/ScalePressable.tsx");
    const cardCover = read("components/ArticleCardItem/ArticleCardCover.tsx");
    const coverPage = read("components/CoverPage/CoverPage.tsx");
    const coverPreview = read("components/CoverPreview/CoverPreview.tsx");

    expect(card).toContain('import ArticleCardCover from "./ArticleCardCover"');
    expect(card).toContain("<ArticleCardCover");
    expect(coverPage).toContain("<ArticleCardCover");
    expect(coverPreview).toContain("<ArticleCardCover");
    expect(cardCover).toContain('alignSelf: "flex-start"');
    expect(cardCover).toContain('alignItems: "flex-end"');
    expect(cardCover).toContain("getArticleCardSenderBottomOffset");
    expect(cardCover).toContain("getArticleCardCoverFontFamily");
  });

  it("uses a readable fallback when an image cover cannot render", () => {
    const presentation = read("lib/articleCoverPresentation.ts");
    const cover = read("components/ArticleCardItem/ArticleCardCover.tsx");

    expect(presentation).toContain(
      'const isMissingImage = cover?.type === "image" && !isImageRendered;',
    );
    expect(presentation).toContain("textColor: isMissingImage");
    expect(cover).toContain("onError={handleImageError}");
    expect(cover).toContain("presentation.isImageRendered");
  });

  it("keeps the source cover visible until the selected native image is composited", () => {
    const cover = read("components/ArticleCardItem/ArticleCardCover.tsx");

    expect(cover).toContain("const imageSource = useMemo(");
    expect(cover).toContain("cacheKey: imageUrl");
    expect(cover).toContain("source={imageSource}");
    expect(cover).toContain("onDisplay={handleImageDisplay}");
    expect(cover).toContain("requestAnimationFrame(() => {");
    expect(cover).toContain("onImageLoad();");
  });

  it("preserves the outer scroll position while a cover is selected", () => {
    const restoration = read("hooks/useSelectionScrollRestoration.ts");
    const selectionScreens = [
      "app/(tabs)/index.tsx",
      "app/(tabs)/to.tsx",
      "app/user-profile/[userId].tsx",
      "app/of-space-detail.tsx",
    ].map(read);

    expect(restoration).toContain("useSelectionScrollRestoration");
    expect(restoration).toContain("captureScrollOffset");
    expect(restoration).toContain("cancelScrollRestoration");
    expect(restoration).toContain("restoreScrollOffset(restore.offset)");
    expect(restoration).toContain("requestAnimationFrame");
    for (const screen of selectionScreens) {
      expect(screen).toContain("useSelectionScrollRestoration");
      expect(screen).toContain("captureScrollOffset()");
      expect(screen).toContain("scrollEnabled=");
    }
  });

  it("keeps cover types and palettes while removing alignment controls", () => {
    const editor = read("components/CoverEditor/CoverEditor.tsx");
    const preview = read("components/CoverPreview/CoverPreview.tsx");

    expect(editor).toContain("표지 타입");
    expect(editor).toContain("서체");
    expect(editor).toContain("고딕");
    expect(editor).toContain("세리프");
    expect(editor).toContain("텍스트 색상");
    expect(editor).toContain("배경 색상");
    expect(editor).not.toContain("텍스트 정렬");
    expect(editor).not.toContain("CoverTextAlign");
    expect(editor).not.toContain('title="표지 설정"');
    expect(preview).toContain("COMPACT_PREVIEW_HEIGHT = 200");
    expect(preview).toContain("COMPACT_PREVIEW_WIDTH");
    expect(preview).toContain("aspectRatio: ReaderTokens.aspectRatio");
  });

  it("keeps the editor cover as the source for every external card surface", () => {
    const externalCardScreens = [
      "app/(tabs)/index.tsx",
      "app/(tabs)/to.tsx",
      "app/of-space-detail.tsx",
      "app/user-profile/[userId].tsx",
      "components/CardSelectOverlay/CardSelectOverlay.tsx",
    ];

    for (const relativePath of externalCardScreens) {
      const source = read(relativePath);
      expect(source, relativePath).toContain("<ArticleCardItem");
      expect(source, relativePath).toContain("cover=");
    }

    const closingScreen = read("app/on-01c.tsx");
    expect(closingScreen).toContain("coverSaveQueueRef.current(async () =>");
    expect(closingScreen).toContain("data: { cover: nextCover }");
    expect(closingScreen).toContain("data: patchData");

    const spacesRoute = read("../api-server/src/routes/spaces.ts");
    expect(spacesRoute).toContain("articleCover: article?.cover ?? null");
  });
});
