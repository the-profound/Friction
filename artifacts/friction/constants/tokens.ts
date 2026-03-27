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
  cardPeek: 24,

  dateHeaderPt: 16,
  dateHeaderPb: 12,

  dotsMarginTop: 20,

  navBarBottom: 20,
  miniSubTabBottom: 98,

  navBarPaddingBottom: 108,
} as const;

export const Sizing = {
  navBarWidth: 300,
  navBarHeight: 68,
  navBarRadius: 999,
  navBarZIndex: 30,
  miniSubTabZIndex: 29,

  tabIconSize: 22,
  tabLabelSize: 10,

  backButtonW: 48,
  backButtonH: 52,
  backButtonIconSize: 20,
  backButtonStrokeWidth: 2.5,

  cardSlotW: 330,
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
    fontWeight: "700" as const,
    fontFamily: Platform.select({ ios: "Inter_700Bold", default: "Inter_700Bold" }),
    letterSpacing: -0.5,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: "500" as const,
    fontFamily: Platform.select({ ios: "Inter_500Medium", default: "Inter_500Medium" }),
  },
  dateHeader: {
    fontSize: 13,
    fontWeight: "600" as const,
    fontFamily: Platform.select({ ios: "Inter_600SemiBold", default: "Inter_600SemiBold" }),
  },
  searchInput: {
    fontSize: 14,
    fontFamily: Platform.select({ ios: "Inter_400Regular", default: "Inter_400Regular" }),
  },
  body: {
    fontSize: 16,
    fontFamily: Platform.select({ ios: "Inter_400Regular", default: "Inter_400Regular" }),
  },
  bodyMedium: {
    fontSize: 16,
    fontWeight: "500" as const,
    fontFamily: Platform.select({ ios: "Inter_500Medium", default: "Inter_500Medium" }),
  },
  bodySemiBold: {
    fontSize: 16,
    fontWeight: "600" as const,
    fontFamily: Platform.select({ ios: "Inter_600SemiBold", default: "Inter_600SemiBold" }),
  },
  caption: {
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Inter_400Regular", default: "Inter_400Regular" }),
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

  miniSubTabDuration: 220,

  scaleActive: 1.1,
  scaleInactive: 0.97,
  subTabScaleFrom: 0.9,
  subTabTranslateYFrom: 6,
  miniSubTabTranslateYFrom: 16,
} as const;

export const Shadows = {
  navBar: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.13,
      shadowRadius: 12,
    },
    android: {
      elevation: 8,
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
} as const;

export const Borders = {
  navBar: {
    borderWidth: 1,
    borderColor: Colors.navBarBorder,
  },
} as const;

export const ZIndex = {
  navBar: 30,
  miniSubTab: 29,
  overlay: 50,
  modal: 60,
  toast: 70,
} as const;

export const TabConfig = {
  mainTabs: [
    { key: "IN" as const, label: "수신함", icon: "inbox" as const },
    { key: "ON" as const, label: "기록함", icon: "file-text" as const },
    { key: "OF" as const, label: "보관함", icon: "layers" as const },
    { key: "TO" as const, label: "발신함", icon: "send" as const },
  ],
  ofSubTabs: [
    { key: "personal" as const, label: "개인 모음", icon: "user" as const },
    { key: "group" as const, label: "단체 모음", icon: "share-2" as const },
    { key: "sentence" as const, label: "문장 모음", icon: "compass" as const },
  ],
  toSubTabs: [
    { key: "neighbors" as const, label: "이웃 목록", icon: "users" as const },
    { key: "history" as const, label: "발신 목록", icon: "clock" as const },
    { key: "send" as const, label: "보내기", icon: "truck" as const },
  ],
  ofMiniSubTabs: {
    personal: [
      { key: "my" as const, label: "내 모음" },
      { key: "subscribed" as const, label: "구독 모음" },
    ],
    group: [
      { key: "my" as const, label: "나의 단체 모음" },
      { key: "joined" as const, label: "참여 중" },
      { key: "subscribed" as const, label: "구독 중" },
    ],
    sentence: null,
  },
} as const;

export type MainTabKey = (typeof TabConfig.mainTabs)[number]["key"];
export type OfSubTabKey = (typeof TabConfig.ofSubTabs)[number]["key"];
export type ToSubTabKey = (typeof TabConfig.toSubTabs)[number]["key"];
