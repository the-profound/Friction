import { Platform } from "react-native";

export const Colors = {
  zinc900: "#18181b",
  zinc800: "#27272a",
  zinc700: "#3f3f46",
  zinc600: "#52525b",
  zinc500: "#71717a",
  zinc400: "#a1a1aa",
  zinc300: "#d4d4d8",
  zinc200: "#e4e4e7",
  zinc100: "#f4f4f5",
  zinc50: "#fafafa",
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",

  navBarBg: "#FFFFFF",
  navBarBorder: "rgba(0,0,0,0.06)",
  navBarShadowOuter: "rgba(0,0,0,0.13)",
  navBarShadowInner: "rgba(0,0,0,0.09)",
  headerShadow: "rgba(0,0,0,0.08)",

  tabActive: "#18181b",
  tabInactive: "#d4d4d8",
  tabInactiveAlt: "#a1a1aa",

  dotActive: "#18181b",
  dotInactive: "#d4d4d8",
  dotEdge: "rgba(0,0,0,0.08)",

  searchBgActive: "#d4d4d8",
  searchBgInactive: "#f4f4f5",
  searchBarBg: "#f4f4f5",
  searchIcon: "#a1a1aa",
  searchText: "#18181b",
  searchPlaceholder: "#a1a1aa",

  backButtonBg: "#F4F4F5",
  backButtonIcon: "#52525b",

  cardInactiveOpacity: 0.55,

  /** #92323D — 오늘의 인사·NEW 강조색 */
  noticeAccent: "#92323D",
  /** rgba(146,50,61,0.08) — 인사 헤더/행 배경 */
  noticeAccentSoft: "rgba(146,50,61,0.08)",

  readerOverflowBg: "#fecaca",
} as const;

export const Spacing = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 20,
  xxxl: 24,

  screenPx: 24,
  headerPt: 8,
  headerPb: 8,

  cardGap: 12,

  dateHeaderPt: 4,
  dateHeaderPb: 8,

  dotsMarginTop: 20,
  /** Vertical separation between date groups in the shared card carousel. */
  carouselGroupBottom: 12,

  navBarBottom: 36,

  navBarPaddingBottom: 116,
} as const;

export const Sizing = {
  navBarWidth: 340,
  navBarHeight: 60,
  /** Capsule radius and the CTA's circular radius are both derived from the shared height. */
  get navBarRadius() {
    return this.navBarHeight / 2;
  },
  navBarZIndex: 30,

  tabIconSize: 22,
  tabLabelSize: 10,

  backButtonW: 48,
  backButtonH: 52,
  backButtonIconSize: 20,
  backButtonStrokeWidth: 2.5,

  cardSlotW: 300,
  cardRatio: 8 / 5,
  get cardH() {
    return this.cardSlotW * this.cardRatio;
  },

  dateHeaderH: 44,
  dotsH: 28,
  /** Safe space inside the horizontally clipped carousel viewport for card shadows. */
  carouselShadowInsetTop: 6,
  carouselShadowInsetBottom: 10,

  dotActiveW: 18,
  dotActiveH: 6,
  dotInactiveW: 6,
  dotInactiveH: 6,
  dotEdgeSize: 5,
  dotMaxVisible: 7,

  headerTitleSize: 28,
  dateHeaderTextSize: 13,

  searchButtonSize: 36,
  searchIconSize: 17,
  plusIconSize: 18,

  searchBarHeight: 52,
  searchBarIconSize: 14,
  searchBarTextSize: 14,

  touchTargetMin: 44,

  swipeThreshold: 48,
  snapPeek: 56,
} as const;

/**
 * Minimum readability rules — every UI text element must satisfy these.
 *
 * Checked automatically by `pnpm --filter @workspace/friction check:typography`
 * (scripts/check-typography.mjs). Add `// typography-ok: <reason>` to the
 * end of a line to suppress a check when the exception is intentional.
 *
 * Background: Pretendard ExtraLight (200) renders significantly thinner on
 * native iOS/Android than in the browser. A combination of ExtraLight +
 * small size + light gray fails on-device readability even when it looks fine
 * in the web preview.
 */
export const ReadabilityMinimums = {
  /** Minimum font size (px) for any readable UI text. Reader body is exempt. */
  fontSizePx: 12,

  /**
   * Minimum font weight for non-display body/secondary text.
   * Regular (400) is the floor; ExtraLight (200) is only for large display text.
   */
  fontWeightRegular: 400 as const,

  /**
   * For small text (12–13 px), Medium (500) is recommended over Regular (400)
   * to preserve on-device readability — native renders thinner than web preview.
   */
  fontWeightSmallRecommended: 500 as const,

  /**
   * Lightest zinc step allowed for body/secondary text.
   * zinc300 (#d4d4d8) and zinc400 (#a1a1aa) are reserved for:
   *   - placeholder / ghost text
   *   - disabled / inactive states
   *   - decorative dots, icon colors, non-readable chrome
   * All readable body/secondary text must be zinc500 (#71717a) or darker.
   */
  textColorMinStep: "zinc500" as const,
} as const;

export const Typography = {
  headerTitle: {
    fontSize: 28,
    fontWeight: "900" as const,
    fontFamily: Platform.select({ ios: "Pretendard-Black", default: "Pretendard-Black" }),
    letterSpacing: -0.5,
  },
  /**
   * tabLabel — intentional design exception to ReadabilityMinimums.
   * Navigation tab labels use ExtraLight 10 px as a deliberate minimalist
   * design choice; the icon carries the primary affordance, the label is
   * supplementary chrome. This is the ONLY approved ExtraLight usage at sub-12 px.
   */
  tabLabel: {
    fontSize: 10,
    fontWeight: "200" as const,
    fontFamily: Platform.select({ ios: "Pretendard-ExtraLight", default: "Pretendard-ExtraLight" }),
  },
  dateHeader: {
    fontSize: 13,
    fontWeight: "600" as const,
    fontFamily: Platform.select({ ios: "Pretendard-SemiBold", default: "Pretendard-SemiBold" }),
  },
  searchInput: {
    fontSize: 14,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard-Regular" }),
  },
  body: {
    // Body text — Pretendard Regular(400); use bodyExtraLight for decorative large text only
    fontSize: 16,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard-Regular" }),
  },
  bodyMedium: {
    fontSize: 16,
    fontWeight: "600" as const,
    fontFamily: Platform.select({ ios: "Pretendard-SemiBold", default: "Pretendard-SemiBold" }),
  },
  bodySemiBold: {
    fontSize: 16,
    fontWeight: "600" as const,
    fontFamily: Platform.select({ ios: "Pretendard-SemiBold", default: "Pretendard-SemiBold" }),
  },
  // Decorative — use only for large display text where ExtraLight is an intentional design choice
  bodyExtraLight: {
    fontSize: 16,
    fontFamily: Platform.select({ ios: "Pretendard-ExtraLight", default: "Pretendard-ExtraLight" }),
  },
  caption: {
    // Caption — Pretendard Regular(400) for readability at small sizes
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard-Regular" }),
  },
  captionMedium: {
    // Caption with Medium(500) weight — for metadata labels that need extra emphasis
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Pretendard-Medium", default: "Pretendard-Medium" }),
  },
} as const;

export const Animation = {
  crossFadeDuration: 220,
  crossFadeEasing: "ease" as const,

  cardTransitionDuration: 320,
  cardTransitionEasing: [0.25, 0.46, 0.45, 0.94] as const,

  opacityScaleDuration: 220,

  dotTransitionDuration: 200,

  headerShadowDuration: 200,

  searchBarDuration: 280,

  scaleActive: 1.1,
  scaleInactive: 0.97,
  subTabScaleFrom: 0.9,
  subTabTranslateYFrom: 6,
} as const;

export const Shadows = {
  /** One raised-surface treatment shared by the dock and the circular CTA. */
  navBar: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.13,
      shadowRadius: 10,
    },
    android: {
      elevation: 4,
    },
    web: {
      boxShadow: "0px 5px 14px rgba(0,0,0,0.16), 0px 1px 2px rgba(0,0,0,0.08)",
    } as object,
    default: {},
  }),
  headerScrolled: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
    },
    android: {
      elevation: 4,
    },
    default: {},
  }),
  previewPage: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 10,
    },
    android: {
      elevation: 5,
    },
    web: {
      boxShadow: "0px 2px 12px rgba(0,0,0,0.09), 0px 8px 28px rgba(0,0,0,0.06)",
    },
    default: {},
  }),
  /** Standard raised card surface, including React Native Web's CSS shadow. */
  card: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
    },
    android: {
      elevation: 5,
    },
    web: {
      boxShadow: "0px 4px 14px rgba(0,0,0,0.12)",
    } as object,
    default: {},
  }),
  /** A restrained shadow used only by date-group carousel cards. */
  carouselCard: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 6,
    },
    android: {
      elevation: 3,
    },
    web: {
      boxShadow: "0px 2px 8px rgba(0,0,0,0.10)",
    } as object,
    default: {},
  }),
} as const;

export const Borders = {
  navBar: {
    borderWidth: 1,
    borderColor: Colors.navBarBorder,
  },
} as const;

export const ZIndex = {
  navBar: 30,
  overlay: 50,
  modal: 60,
  toast: 70,
} as const;

export const TabConfig = {
  mainTabs: [
    { key: "IN" as const, label: "수신", icon: "inbox" as const },
    { key: "OF" as const, label: "공간", icon: "grid" as const },
    { key: "ON" as const, label: "기록", icon: "edit-3" as const },
    { key: "AR" as const, label: "보관", icon: "archive" as const },
    { key: "TO" as const, label: "마이", icon: "user" as const },
  ],
  ofSubTabs: [
    { key: "group" as const, label: "공간", icon: "grid" as const },
  ],
  toSubTabs: [
    { key: "send" as const, label: "보내기", icon: "truck" as const },
    { key: "history" as const, label: "보낸 기록", icon: "clock" as const },
    { key: "neighbors" as const, label: "이웃", icon: "users" as const },
  ],
} as const;

export type MainTabKey = (typeof TabConfig.mainTabs)[number]["key"];
export type OfSubTabKey = (typeof TabConfig.ofSubTabs)[number]["key"];
export type ToSubTabKey = (typeof TabConfig.toSubTabs)[number]["key"];

export const ReaderTokens = {
  aspectRatio: 5 / 8,

  padding: {
    xCqi: 6,
    yCqi: 15,
  },

  fontFamily: {
    serif: Platform.select({
      ios: "Eulyoo1945-Regular",
      default: "Eulyoo1945-Regular",
    }),
    serifBold: Platform.select({
      ios: "Eulyoo1945-SemiBold",
      default: "Eulyoo1945-SemiBold",
    }),
    notoSerif: Platform.select({
      ios: "NotoSerifKR_400Regular",
      default: "NotoSerifKR_400Regular",
    }),
    notoSerifBold: Platform.select({
      ios: "NotoSerifKR_600SemiBold",
      default: "NotoSerifKR_600SemiBold",
    }),
    notoSerifExtraBold: Platform.select({
      ios: "NotoSerifKR_800ExtraBold",
      default: "NotoSerifKR_800ExtraBold",
    }),
    // sans = Regular(400) for body/caption text; use sansExtraLight for decorative large text
    sans: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard-Regular",
    }),
    sansMedium: Platform.select({
      ios: "Pretendard-Medium",
      default: "Pretendard-Medium",
    }),
    sansExtraLight: Platform.select({
      ios: "Pretendard-ExtraLight",
      default: "Pretendard-ExtraLight",
    }),
    sansSemiBold: Platform.select({
      ios: "Pretendard-SemiBold",
      default: "Pretendard-SemiBold",
    }),
    sansBold: Platform.select({
      ios: "Pretendard-Black",
      default: "Pretendard-Black",
    }),
  },

  typeScale: {
    bodyCqi: 4.0,
    captionCqi: 3.4,
    metadataCqi: 2.8,
    titleCqi: 6.4,
    /** 편지 표지 카드 제목 전용 크기. 읽기·작성 화면 제목과 분리한다. */
    cardTitleCqi: 11.2,
    /** 제목 입력과 제목1 서식이 공유하는 본문 대비 배율. */
    get titleScaleEm() {
      return this.titleCqi / this.bodyCqi;
    },
  },

  lineHeight: {
    relaxed: 1.8,
    tight: 1.2,
  },

  paragraphSpacing: {
    /** 일반 본문 문단의 아래 여백. 본문 글자 크기에 대한 em 배율이다. */
    bodyEm: 0.6,
  },

  letterSpacing: {
    relaxedEm: 0.05,
    tightEm: -0.02,
  },

  bodyBg: "#FFFFFF",
  bodyText: "#1A1A1A",
} as const;

export function cqiToPx(cqi: number, containerWidth: number): number {
  return (cqi / 100) * containerWidth;
}

export function readerFontSize(
  scaleCqi: number,
  containerWidth: number,
): number {
  return cqiToPx(scaleCqi, containerWidth);
}

export function readerLetterSpacing(
  em: number,
  fontSize: number,
): number {
  return em * fontSize;
}
