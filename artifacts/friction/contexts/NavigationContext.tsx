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

interface DetailRouteInfo {
  tab: MainTabKey;
  ofSubTab?: OfSubTabKey;
  toSubTab?: ToSubTabKey;
}

const DETAIL_ROUTE_MAP: Record<string, DetailRouteInfo> = {
  "on-01a": { tab: "ON" },
  "on-01b": { tab: "ON" },
  "on-01c": { tab: "ON" },
  "on-02": { tab: "ON" },
  "of-01": { tab: "OF", ofSubTab: "personal" },
  "of-01-detail": { tab: "OF", ofSubTab: "personal" },
  "of-02": { tab: "OF", ofSubTab: "group" },
  "of-02-detail": { tab: "OF", ofSubTab: "group" },
  "of-03": { tab: "OF", ofSubTab: "sentence" },
  "to-01": { tab: "TO", toSubTab: "neighbors" },
  "to-02": { tab: "TO", toSubTab: "send" },
  "to-03": { tab: "TO", toSubTab: "history" },
  "read": { tab: "IN" },
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
    let detectedOfSubTab: OfSubTabKey | undefined;
    let detectedToSubTab: ToSubTabKey | undefined;

    if (segments.length >= 1 && segments[0] === "(tabs)") {
      const tabSegment = segments[1] || "index";
      detectedTab = SEGMENT_TO_TAB[tabSegment];
    } else if (segments.length >= 1) {
      const routeSegment = segments[0];
      const info = DETAIL_ROUTE_MAP[routeSegment];
      if (info) {
        detectedTab = info.tab;
        detectedOfSubTab = info.ofSubTab;
        detectedToSubTab = info.toSubTab;
      }
    }

    if (!detectedTab) return;

    const tabChanged = detectedTab !== activeTab;
    const subTabChanged = (detectedOfSubTab && detectedOfSubTab !== ofSubTab) ||
                          (detectedToSubTab && detectedToSubTab !== toSubTab);

    if (tabChanged || subTabChanged) {
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

      if (detectedOfSubTab) {
        setOfSubTabState(detectedOfSubTab);
      }
      if (detectedToSubTab) {
        setToSubTabState(detectedToSubTab);
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
    programmaticNav.current = true;
    setOfSubTabState(subTab);
    router.setParams({ subTab });
  }, []);

  const setToSubTab = useCallback((subTab: ToSubTabKey) => {
    programmaticNav.current = true;
    setToSubTabState(subTab);
    router.setParams({ subTab });
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
