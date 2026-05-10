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

  dateHeaderPt: 8,
  dateHeaderPb: 12,

  dotsMarginTop: 20,

  navBarBottom: 20,

  navBarPaddingBottom: 108,
} as const;

export const Sizing = {
  navBarWidth: 300,
  navBarHeight: 68,
  navBarRadius: 999,
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

  dateHeaderH: 52,
  dotsH: 36,
  get groupH() {
    return this.dateHeaderH + this.cardH + this.dotsH;
  },

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

export const Typography = {
  headerTitle: {
    fontSize: 28,
    fontWeight: "900" as const,
    fontFamily: Platform.select({ ios: "Pretendard-Black", default: "Pretendard-Black" }),
    letterSpacing: -0.5,
  },
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
    fontFamily: Platform.select({ ios: "Pretendard-ExtraLight", default: "Pretendard-ExtraLight" }),
  },
  body: {
    fontSize: 16,
    fontFamily: Platform.select({ ios: "Pretendard-ExtraLight", default: "Pretendard-ExtraLight" }),
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
  caption: {
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Pretendard-ExtraLight", default: "Pretendard-ExtraLight" }),
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
  navBarIos: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.13,
      shadowRadius: 10,
    },
    default: {},
  }),
  navBarAndroid: Platform.select({
    android: {
      elevation: 4,
    },
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
      shadowRadius: 8,
    },
    android: {
      elevation: 4,
    },
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
    { key: "IN" as const, label: "수신함", icon: "inbox" as const },
    { key: "AR" as const, label: "보관함", icon: "archive" as const },
    { key: "ON" as const, label: "기록함", icon: "edit-3" as const },
    { key: "OF" as const, label: "단체 모음", icon: "users" as const },
    { key: "TO" as const, label: "발신함", icon: "send" as const },
  ],
  ofSubTabs: [
    { key: "group" as const, label: "단체 모음", icon: "share-2" as const },
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

  safeArea: {
    widthCqi: 90,
    heightCqi: 120,
  },

  padding: {
    xCqi: 4,
    yCqi: 10,
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
    sans: Platform.select({
      ios: "Pretendard-ExtraLight",
      default: "Pretendard-ExtraLight",
    }),
    sansMedium: Platform.select({
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
  },

  lineHeight: {
    relaxed: 1.8,
    tight: 1.2,
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
