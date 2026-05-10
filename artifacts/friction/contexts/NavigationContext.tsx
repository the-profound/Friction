import { type Href, router, useGlobalSearchParams, usePathname, useSegments } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { MainTabKey, OfSubTabKey, ToSubTabKey } from "@/constants/tokens";
import type { NavContextValue, NavLayer } from "@/types/navigation";

const TAB_ROUTES: Record<MainTabKey, Href> = {
  IN: "/(tabs)" as Href,
  ON: "/(tabs)/on" as Href,
  AR: "/(tabs)/archive" as Href,
  OF: "/(tabs)/of" as Href,
  TO: "/(tabs)/to" as Href,
};

const SEGMENT_TO_TAB: Record<string, MainTabKey> = {
  index: "IN",
  on: "ON",
  archive: "AR",
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
  "to-03": { tab: "TO" },
  "read": { tab: "IN" },
};

const OF_SUB_TABS = new Set<string>(["personal", "group", "sentence"]);
const TO_SUB_TABS = new Set<string>(["send"]);

const NavigationContext = createContext<NavContextValue | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTabState] = useState<MainTabKey>("IN");
  const [prevMainTab, setPrevMainTab] = useState<MainTabKey>("IN");
  const [layer, setLayer] = useState<NavLayer>("main");
  const [ofSubTab, setOfSubTabState] = useState<OfSubTabKey>("personal");
  const [toSubTab, setToSubTabState] = useState<ToSubTabKey>("send");
  const [headerScrolled, setHeaderScrolled] = useState(false);

  const lastSyncRef = useRef({ tab: "IN" as MainTabKey, ofSub: "personal" as OfSubTabKey, toSub: "send" as ToSubTabKey });
  const pathnameRef = useRef<string>("");

  const segments = useSegments();
  const pathname = usePathname();
  const globalParams = useGlobalSearchParams<{ subTab?: string }>();

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

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

    if (detectedTab === "OF") {
      setActiveTabState((prev) => {
        if (prev !== "OF") {
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
    if (tab === "OF") {
      setActiveTabState((prev) => {
        if (prev !== "OF") {
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
    lastSyncRef.current = { ...lastSyncRef.current, ofSub: subTab };
    if (pathnameRef.current === "/of") {
      router.setParams({ subTab });
    } else {
      router.navigate({ pathname: "/(tabs)/of", params: { subTab } } as Href);
    }
  }, []);

  const setToSubTab = useCallback((subTab: ToSubTabKey) => {
    setToSubTabState(subTab);
    lastSyncRef.current = { ...lastSyncRef.current, toSub: subTab };
    if (pathnameRef.current === "/to") {
      router.setParams({ subTab });
    } else {
      router.navigate({ pathname: "/(tabs)/to", params: { subTab } } as Href);
    }
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
      headerScrolled,
      setActiveTab,
      setOfSubTab,
      setToSubTab,
      goBackToMainLayer,
      setHeaderScrolled,
    }),
    [
      activeTab,
      prevMainTab,
      layer,
      ofSubTab,
      toSubTab,
      headerScrolled,
      setActiveTab,
      setOfSubTab,
      setToSubTab,
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
