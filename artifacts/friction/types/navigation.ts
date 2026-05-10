import type { MainTabKey, OfSubTabKey, ToSubTabKey } from "@/constants/tokens";

export type NavLayer = "main" | "sub";

export interface NavState {
  activeTab: MainTabKey;
  prevMainTab: MainTabKey;
  layer: NavLayer;
  ofSubTab: OfSubTabKey;
  toSubTab: ToSubTabKey;
  headerScrolled: boolean;
  showRecordFab: boolean;
}

export interface NavActions {
  setActiveTab: (tab: MainTabKey) => void;
  setOfSubTab: (subTab: OfSubTabKey) => void;
  setToSubTab: (subTab: ToSubTabKey) => void;
  goBackToMainLayer: () => void;
  setHeaderScrolled: (scrolled: boolean) => void;
  setShowRecordFab: (show: boolean) => void;
}

export interface NavContextValue extends NavState, NavActions {}
