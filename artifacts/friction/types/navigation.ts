import type { MainTabKey, OfSubTabKey, ToSubTabKey } from "@/constants/tokens";

export type NavLayer = "main" | "sub";

export type OfMiniSubTabKey = "my" | "subscribed" | "joined";

export interface NavState {
  activeTab: MainTabKey;
  prevMainTab: MainTabKey;
  layer: NavLayer;
  ofSubTab: OfSubTabKey;
  toSubTab: ToSubTabKey;
  ofMiniSubTab: Record<OfSubTabKey, OfMiniSubTabKey>;
  headerScrolled: boolean;
  ofSubTabTapKey: number;
}

export interface NavActions {
  setActiveTab: (tab: MainTabKey) => void;
  setOfSubTab: (subTab: OfSubTabKey) => void;
  setToSubTab: (subTab: ToSubTabKey) => void;
  setOfMiniSubTab: (ofSubTab: OfSubTabKey, miniTab: OfMiniSubTabKey) => void;
  goBackToMainLayer: () => void;
  setHeaderScrolled: (scrolled: boolean) => void;
}

export interface NavContextValue extends NavState, NavActions {}
