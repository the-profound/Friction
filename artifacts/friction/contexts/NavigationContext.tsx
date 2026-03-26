import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { MainTabKey, OfSubTabKey, ToSubTabKey } from "@/constants/tokens";
import type { NavContextValue, NavLayer, OfMiniSubTabKey } from "@/types/navigation";

const DEFAULT_OF_MINI: Record<OfSubTabKey, OfMiniSubTabKey> = {
  personal: "my",
  group: "my",
  sentence: "my",
};

const NavigationContext = createContext<NavContextValue | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTabState] = useState<MainTabKey>("IN");
  const [prevMainTab, setPrevMainTab] = useState<MainTabKey>("IN");
  const [layer, setLayer] = useState<NavLayer>("main");
  const [ofSubTab, setOfSubTabState] = useState<OfSubTabKey>("personal");
  const [toSubTab, setToSubTabState] = useState<ToSubTabKey>("neighbors");
  const [ofMiniSubTab, setOfMiniSubTabState] = useState<Record<OfSubTabKey, OfMiniSubTabKey>>(DEFAULT_OF_MINI);
  const [headerScrolled, setHeaderScrolled] = useState(false);

  const setActiveTab = useCallback((tab: MainTabKey) => {
    if (tab === "OF" || tab === "TO") {
      setActiveTabState((prev) => {
        if (prev !== "OF" && prev !== "TO") {
          setPrevMainTab(prev);
        }
        return tab;
      });
      setLayer("sub");
    } else {
      setActiveTabState(tab);
      setLayer("main");
    }
    setHeaderScrolled(false);
  }, []);

  const setOfSubTab = useCallback((subTab: OfSubTabKey) => {
    setOfSubTabState(subTab);
  }, []);

  const setToSubTab = useCallback((subTab: ToSubTabKey) => {
    setToSubTabState(subTab);
  }, []);

  const setOfMiniSubTab = useCallback((ofSub: OfSubTabKey, miniTab: OfMiniSubTabKey) => {
    setOfMiniSubTabState((prev) => ({ ...prev, [ofSub]: miniTab }));
  }, []);

  const goBackToMainLayer = useCallback(() => {
    setActiveTabState(prevMainTab);
    setLayer("main");
    setHeaderScrolled(false);
  }, [prevMainTab]);

  const value = useMemo<NavContextValue>(
    () => ({
      activeTab,
      prevMainTab,
      layer,
      ofSubTab,
      toSubTab,
      ofMiniSubTab,
      headerScrolled,
      setActiveTab,
      setOfSubTab,
      setToSubTab,
      setOfMiniSubTab,
      goBackToMainLayer,
      setHeaderScrolled,
    }),
    [
      activeTab,
      prevMainTab,
      layer,
      ofSubTab,
      toSubTab,
      ofMiniSubTab,
      headerScrolled,
      setActiveTab,
      setOfSubTab,
      setToSubTab,
      setOfMiniSubTab,
      goBackToMainLayer,
      setHeaderScrolled,
    ]
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error("useNavigation must be used within NavigationProvider");
  }
  return ctx;
}
