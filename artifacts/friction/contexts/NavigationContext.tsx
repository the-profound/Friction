import { type Href, router, usePathname, useSegments } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { MainTabKey, OfSubTabKey, ToSubTabKey } from "@/constants/tokens";
import type { NavContextValue, NavLayer, OfMiniSubTabKey } from "@/types/navigation";

const TAB_ROUTES: Record<MainTabKey, Href> = {
  IN: "/(tabs)" as Href,
  ON: "/(tabs)/on" as Href,
  OF: "/(tabs)/of" as Href,
  TO: "/(tabs)/to" as Href,
};

const SEGMENT_TO_TAB: Record<string, MainTabKey> = {
  index: "IN",
  on: "ON",
  of: "OF",
  to: "TO",
};

const DETAIL_ROUTE_TO_TAB: Record<string, MainTabKey> = {
  "on-01a": "ON",
  "on-01b": "ON",
  "on-01c": "ON",
  "on-02": "ON",
  "of-01": "OF",
  "of-01-detail": "OF",
  "of-02": "OF",
  "of-02-detail": "OF",
  "of-03": "OF",
  "to-01": "TO",
  "to-02": "TO",
  "to-03": "TO",
  "read": "IN",
};

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

  const programmaticNav = useRef(false);

  const segments = useSegments();
  const pathname = usePathname();

  useEffect(() => {
    if (programmaticNav.current) {
      programmaticNav.current = false;
      return;
    }

    let detectedTab: MainTabKey | undefined;

    if (segments.length >= 1 && segments[0] === "(tabs)") {
      const tabSegment = segments[1] || "index";
      detectedTab = SEGMENT_TO_TAB[tabSegment];
    } else if (segments.length >= 1) {
      const routeSegment = segments[0];
      detectedTab = DETAIL_ROUTE_TO_TAB[routeSegment];
    }

    if (detectedTab && detectedTab !== activeTab) {
      if (detectedTab === "OF" || detectedTab === "TO") {
        setActiveTabState((prev) => {
          if (prev !== "OF" && prev !== "TO") {
            setPrevMainTab(prev);
          }
          return detectedTab;
        });
        setLayer("sub");
      } else {
        setActiveTabState(detectedTab);
        setLayer("main");
      }
      setHeaderScrolled(false);
    }
  }, [segments, pathname]);

  const setActiveTab = useCallback((tab: MainTabKey) => {
    programmaticNav.current = true;
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
    router.navigate(TAB_ROUTES[tab]);
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
    programmaticNav.current = true;
    setActiveTabState(prevMainTab);
    setLayer("main");
    setHeaderScrolled(false);
    router.navigate(TAB_ROUTES[prevMainTab]);
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
