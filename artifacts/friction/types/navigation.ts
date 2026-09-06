import type { MainTabKey, OfSubTabKey, ToSubTabKey } from "@/constants/tokens";

export type NavLayer = "main" | "sub";
export type RecordKindIntent = "thought" | "editing" | "letter";

export interface NavState {
  activeTab: MainTabKey;
  prevMainTab: MainTabKey;
  layer: NavLayer;
  ofSubTab: OfSubTabKey;
  toSubTab: ToSubTabKey;
  headerScrolled: boolean;
  tabReselectVersion: Record<MainTabKey, number>;
  recordKindIntent: RecordKindIntent;
}

export interface NavActions {
  setActiveTab: (tab: MainTabKey) => void;
  setOfSubTab: (subTab: OfSubTabKey) => void;
  setToSubTab: (subTab: ToSubTabKey) => void;
  goBackToMainLayer: () => void;
  setHeaderScrolled: (scrolled: boolean) => void;
  setRecordKindIntent: (kind: RecordKindIntent) => void;
}

export interface NavContextValue extends NavState, NavActions {}
