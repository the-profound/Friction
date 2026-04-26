import { type Href, router, useGlobalSearchParams, usePathname, useSegments } from "expo-router";
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
  "to-03": { tab: "TO", toSubTab: "history" },
  "read": { tab: "IN" },
};

const OF_SUB_TABS = new Set<string>(["personal", "group", "sentence"]);
const TO_SUB_TABS = new Set<string>(["neighbors", "history", "send"]);

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
  const [ofSubTabTapKey, setOfSubTabTapKey] = useState(0);

  const lastSyncRef = useRef({ tab: "IN" as MainTabKey, ofSub: "personal" as OfSubTabKey, toSub: "neighbors" as ToSubTabKey });

  const segments = useSegments();
  const pathname = usePathname();
  const globalParams = useGlobalSearchParams<{ subTab?: string }>();

  useEffect(() => {
    let detectedTab: MainTabKey | undefined;
    let detectedOfSubTab: OfSubTabKey | undefined;
    let detectedToSubTab: ToSubTabKey | undefined;

    if (segments.length >= 1 && segments[0] === "(tabs)") {
      const tabSegment = segments[1] || "index";
      detectedTab = SEGMENT_TO_TAB[tabSegment];

      const paramSubTab = globalParams.subTab;
      if (detectedTab === "OF" && paramSubTab && OF_SUB_TABS.has(paramSubTab)) {
        detectedOfSubTab = paramSubTab as OfSubTabKey;
      } else if (detectedTab === "TO" && paramSubTab && TO_SUB_TABS.has(paramSubTab)) {
        detectedToSubTab = paramSubTab as ToSubTabKey;
      }
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

    const last = lastSyncRef.current;
    const tabChanged = detectedTab !== last.tab;
    const ofSubChanged = detectedOfSubTab && detectedOfSubTab !== last.ofSub;
    const toSubChanged = detectedToSubTab && detectedToSubTab !== last.toSub;

    if (!tabChanged && !ofSubChanged && !toSubChanged) return;

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

    lastSyncRef.current = {
      tab: detectedTab,
      ofSub: detectedOfSubTab || last.ofSub,
      toSub: detectedToSubTab || last.toSub,
    };

    setHeaderScrolled(false);
  }, [segments, pathname, globalParams.subTab]);

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
    lastSyncRef.current = { ...lastSyncRef.current, tab };
    setHeaderScrolled(false);
    router.navigate(TAB_ROUTES[tab]);
  }, []);

  const setOfSubTab = useCallback((subTab: OfSubTabKey) => {
    setOfSubTabState(subTab);
    setOfSubTabTapKey((k) => k + 1);
    lastSyncRef.current = { ...lastSyncRef.current, ofSub: subTab };
    router.setParams({ subTab });
  }, []);

  const setToSubTab = useCallback((subTab: ToSubTabKey) => {
    setToSubTabState(subTab);
    lastSyncRef.current = { ...lastSyncRef.current, toSub: subTab };
    router.setParams({ subTab });
  }, []);

  const setOfMiniSubTab = useCallback((ofSub: OfSubTabKey, miniTab: OfMiniSubTabKey) => {
    setOfMiniSubTabState((prev) => ({ ...prev, [ofSub]: miniTab }));
  }, []);

  const goBackToMainLayer = useCallback(() => {
    setActiveTabState(prevMainTab);
    setLayer("main");
    lastSyncRef.current = { ...lastSyncRef.current, tab: prevMainTab };
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
      ofSubTabTapKey,
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
      ofSubTabTapKey,
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
