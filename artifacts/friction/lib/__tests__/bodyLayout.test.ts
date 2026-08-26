import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computePageGeometry,
  getPageTextContentHeight,
  resolvePageWidth,
} from "../pageGeometry";
import { calculateCardReturnDistance } from "../../components/CardSelectOverlay/returnDistance";

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

  it("hides only the web editor scrollbar while preserving its scroll container", () => {
    const webEditor = read("components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx");
    const nativeEditor = read("components/WebViewMarkdownEditor/WebViewMarkdownEditor.tsx");

    expect(webEditor).toContain('className="web-markdown-editor-scroll-container"');
    expect(webEditor).toContain("scrollbar-width: none");
    expect(webEditor).toContain("-ms-overflow-style: none");
    expect(webEditor).toContain("scrollbar-gutter: stable");
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

  it("keeps selectable three-column and space cards on the canonical layout path", () => {
    const myTab = read("app/(tabs)/to.tsx");
    const profile = read("app/user-profile/[userId].tsx");
    const space = read("app/of-space-detail.tsx");

    expect(myTab).toContain("CanonicalCardSlot width={cellWidth} height={cellHeight}");
    expect(profile).toContain("CanonicalCardSlot width={cellWidth} height={cellHeight}");
    expect(myTab).not.toContain("cardWidth={cellWidth}");
    expect(profile).not.toContain("cardWidth={cellWidth}");
    expect(space).toContain("CanonicalCardSlot width={SC_CARD_W} height={SC_CARD_H}");
    expect(space).not.toContain("function ScaledCardSlot");
    expect(space).toContain("ref={upcomingOpeningSlotRef}");
    expect(space).toContain("slot.measureInWindow((x, y, width, height) =>");
    expect(space).toContain("letter.id === hiddenCardId");
  });

  it("preserves the originating card's dimmed state in the selection overlay", () => {
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

    expect(overlay).toContain("onShow={handleModalShow}");
    expect(overlay).toContain("onLayout={handleOriginCardLayout}");
    expect(overlay).toContain("cardLayoutSessionRef.current !== session");
    expect(overlay).toContain("modalShownSessionRef.current !== session");
    expect(overlay).toContain("openSessionRef.current !== session");
    expect(inbox).toContain("onReady={() => setIsTappedSourceHidden(true)}");
    expect(myTab).toContain("onReady={() => setIsSelectedSourceHidden(true)}");
    expect(profile).toContain("onReady={() => setIsSelectedSourceHidden(true)}");
    expect(space).toContain("onReady={() => setIsTappedSourceHidden(true)}");
  });

  it("connects space letter author navigation without treating the space as a collection", () => {
    const space = read("app/of-space-detail.tsx");

    expect(space).toContain(
      'router.push(`/user-profile/${authorId}` as never);',
    );
    expect(space).toContain("onNavigateToAuthor={handleNavigateToAuthor}");
    expect(space).toContain(
      "authorId: isAnonymousSpace ? null : tapLetter.authorId ?? null,",
    );
    expect(space).toContain("collectionName: space?.name ?? null,");
    expect(space).not.toContain("collectionId: id");
  });

  it("makes the non-anonymous space creator row open the creator profile", () => {
    const space = read("app/of-space-detail.tsx");

    expect(space).toContain("onPress={() => handleNavigateToAuthor(space.creatorId)}");
    expect(space).toContain('testID="space-creator-profile"');
    expect(space).toContain('name="chevron-right" size={12} color={Colors.zinc400}');
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
    const inbox = read("app/(tabs)/index.tsx");

    expect(card).toContain("export function ArticleCardShadow");
    expect(card).toContain("hideShadow?: boolean;");
    expect(card).toContain("...StyleSheet.absoluteFill");
    expect(overlay).toContain("originUsesCarouselShadow?: boolean;");
    expect(overlay).toContain("const originShadowOpacity = useMemo(");
    expect(overlay).toContain("outputRange: [1, 0]");
    expect(overlay).toContain("originUsesCarouselShadow && slotIndex === initialIndex");
    expect(overlay).toContain("carouselShadow");
    expect(overlay).toContain("opacity={sourceShadowOpacity}");
    expect(overlay).toContain("opacity={selectedShadowOpacity}");
    expect(overlay).toContain("hideShadow");
    expect(inbox).toContain("originUsesCarouselShadow");
  });

  it("measures the actual remaining vertical distance after a downward drag", () => {
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