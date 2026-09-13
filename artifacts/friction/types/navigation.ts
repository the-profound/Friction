import type { MainTabKey, OfSubTabKey, ToSubTabKey } from "@/constants/tokens";

export type NavLayer = "main" | "sub";
export type RecordKindIntent = "thought" | "editing" | "letter";
export type RecordKindIntentOptions = {
  scrollToTop?: boolean;
  focusRecordId?: string;
};
export type RecordScrollToTopIntent = {
  kind: RecordKindIntent;
  token: number;
};
export type RecordFocusIntent = {
  kind: RecordKindIntent;
  recordId: string;
  token: number;
};

export interface NavState {
  activeTab: MainTabKey;
  prevMainTab: MainTabKey;
  layer: NavLayer;
  ofSubTab: OfSubTabKey;
  toSubTab: ToSubTabKey;
  headerScrolled: boolean;
  tabReselectVersion: Record<MainTabKey, number>;
  recordKindIntent: RecordKindIntent;
  recordScrollToTopIntent: RecordScrollToTopIntent | null;
  recordFocusIntent: RecordFocusIntent | null;
}

export interface NavActions {
  setActiveTab: (tab: MainTabKey) => void;
  setOfSubTab: (subTab: OfSubTabKey) => void;
  setToSubTab: (subTab: ToSubTabKey) => void;
  goBackToMainLayer: () => void;
  setHeaderScrolled: (scrolled: boolean) => void;
  setRecordKindIntent: (kind: RecordKindIntent, options?: RecordKindIntentOptions) => void;
  consumeRecordScrollToTopIntent: (token: number) => void;
  consumeRecordFocusIntent: (token: number) => void;
}

export interface NavContextValue extends NavState, NavActions {}
