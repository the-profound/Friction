import { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  findDateGroupAtOffset,
  getDateGroupSnapTarget,
  preserveDateGroupAnchor,
  resolveDateGroupLayouts,
  type DateGroupLayout,
} from "@/lib/dateGroupVerticalSnap";

interface VerticalListRef {
  scrollToOffset: (params: { offset: number; animated: boolean }) => void;
}

interface MeasurableView {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

interface UseDateGroupVerticalSnapOptions {
  groupKeys: readonly string[];
  /**
   * Include record IDs/counts here so a refresh that keeps the same date keys
   * still gets an anchor restoration after earlier groups change height.
   */
  groupSignature: string;
  listRef: React.RefObject<VerticalListRef | null>;
  enabled: boolean;
  bottomInset?: number;
  estimatedGroupHeight?: number;
  estimatedGroupHeights?: ReadonlyMap<string, number>;
  viewportRef?: React.RefObject<MeasurableView | null>;
}

const WEB_SETTLE_DELAY_MS = 120;
const NATIVE_SETTLE_DELAY_MS = 180;

/**
 * Adds date-header anchoring without using FlatList paging. Paging would
 * force an oversized group to hide its lower cards/actions, and is not
 * implemented consistently by React Native Web.
 */
export function useDateGroupVerticalSnap({
  groupKeys,
  groupSignature,
  listRef,
  enabled,
  bottomInset = 0,
  estimatedGroupHeight,
  estimatedGroupHeights,
  viewportRef,
}: UseDateGroupVerticalSnapOptions) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const layoutsRef = useRef(new Map<string, DateGroupLayout>());
  const heightsRef = useRef(new Map<string, number>());
  const measuredLayoutsRef = useRef(new Map<string, DateGroupLayout>());
  const groupNodesRef = useRef(new Map<string, MeasurableView>());
  const groupKeysRef = useRef<string[]>([...groupKeys]);
  const previousKeysRef = useRef<string[]>([]);
  const currentOffsetRef = useRef(0);
  const anchorKeyRef = useRef<string | null>(null);
  const anchorDistanceRef = useRef(0);
  const interactedRef = useRef(false);
  const pendingRestoreKeyRef = useRef<string | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const measureFrameRef = useRef<number | null>(null);
  const settleUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSettlingRef = useRef(false);
  const programmaticTargetRef = useRef<number | null>(null);
  groupKeysRef.current = [...groupKeys];

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const restoreAnchor = useCallback(() => {
    const key = pendingRestoreKeyRef.current;
    if (!key || !enabled) return;
    const layout = layoutsRef.current.get(key);
    if (!layout) return;
    if (viewportRef?.current && groupNodesRef.current.has(key) && !measuredLayoutsRef.current.has(key)) {
      return;
    }

    pendingRestoreKeyRef.current = null;
    const offset = Math.max(0, layout.offset + anchorDistanceRef.current);
    currentOffsetRef.current = offset;
    listRef.current?.scrollToOffset({ offset, animated: false });
  }, [enabled, listRef, viewportRef]);

  const scheduleAnchorRestore = useCallback(() => {
    if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current);
    restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      restoreAnchor();
    });
  }, [restoreAnchor]);

  const rebuildLayouts = useCallback(() => {
    const resolved = resolveDateGroupLayouts(
      groupKeysRef.current,
      heightsRef.current,
      measuredLayoutsRef.current,
    );
    layoutsRef.current.clear();
    for (const layout of resolved) {
      layoutsRef.current.set(layout.dateKey, layout);
    }
  }, []);

  const measureGroupNode = useCallback((dateKey: string, node: MeasurableView) => {
    const viewport = viewportRef?.current;
    if (!viewport) return;
    viewport.measureInWindow((_viewportX, viewportY) => {
      node.measureInWindow((_groupX, groupY, _groupWidth, groupHeight) => {
        if (groupNodesRef.current.get(dateKey) !== node || groupHeight <= 0) return;
        heightsRef.current.set(dateKey, groupHeight);
        measuredLayoutsRef.current.set(dateKey, {
          dateKey,
          offset: Math.max(0, currentOffsetRef.current + groupY - viewportY),
          height: groupHeight,
        });
        rebuildLayouts();
        if (pendingRestoreKeyRef.current === dateKey) scheduleAnchorRestore();
      });
    });
  }, [rebuildLayouts, scheduleAnchorRestore, viewportRef]);

  const scheduleVisibleMeasurements = useCallback(() => {
    if (!viewportRef?.current) return;
    if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current);
    measureFrameRef.current = requestAnimationFrame(() => {
      measureFrameRef.current = null;
      for (const [dateKey, node] of groupNodesRef.current) {
        measureGroupNode(dateKey, node);
      }
    });
  }, [measureGroupNode, viewportRef]);

  useEffect(() => {
    const nextKeys = [...groupKeys];
    const previousKeys = previousKeysRef.current;
    const previousAnchor = anchorKeyRef.current;
    const validKeys = new Set(nextKeys);
    for (const key of heightsRef.current.keys()) {
      if (!validKeys.has(key)) heightsRef.current.delete(key);
    }
    measuredLayoutsRef.current.clear();
    if (estimatedGroupHeight && estimatedGroupHeight > 0) {
      for (const key of nextKeys) heightsRef.current.set(key, estimatedGroupHeight);
    }
    if (estimatedGroupHeights) {
      for (const key of nextKeys) {
        const estimatedHeight = estimatedGroupHeights.get(key);
        if (estimatedHeight && estimatedHeight > 0) heightsRef.current.set(key, estimatedHeight);
      }
    }
    rebuildLayouts();

    if (previousKeys.length > 0 && previousAnchor) {
      const nextAnchor = preserveDateGroupAnchor(previousAnchor, previousKeys, nextKeys);
      if (nextAnchor !== previousAnchor) anchorDistanceRef.current = 0;
      anchorKeyRef.current = nextAnchor;
      pendingRestoreKeyRef.current = nextAnchor;
    }

    previousKeysRef.current = nextKeys;
    if (viewportRef?.current) scheduleVisibleMeasurements();
    // Mounted anchors wait for their actual measurement in restoreAnchor;
    // virtualized anchors restore immediately from their per-key estimate.
    scheduleAnchorRestore();
  }, [
    estimatedGroupHeight,
    estimatedGroupHeights,
    groupKeys,
    groupSignature,
    rebuildLayouts,
    scheduleAnchorRestore,
    scheduleVisibleMeasurements,
    viewportRef,
  ]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    if (nextHeight > 0 && nextHeight !== viewportHeight) setViewportHeight(nextHeight);
  }, [viewportHeight]);

  const setGroupRef = useCallback((dateKey: string, node: View | null) => {
    if (node) {
      groupNodesRef.current.set(dateKey, node);
      scheduleVisibleMeasurements();
    } else {
      groupNodesRef.current.delete(dateKey);
    }
  }, [scheduleVisibleMeasurements]);

  const onGroupLayout = useCallback((dateKey: string, event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    if (height <= 0) return;
    heightsRef.current.set(dateKey, height);
    rebuildLayouts();
    const node = groupNodesRef.current.get(dateKey);
    if (node && viewportRef?.current) measureGroupNode(dateKey, node);
    else if (pendingRestoreKeyRef.current === dateKey) scheduleAnchorRestore();
  }, [measureGroupNode, rebuildLayouts, scheduleAnchorRestore, viewportRef]);

  const clearSettleLock = useCallback(() => {
    if (settleUnlockTimerRef.current !== null) {
      clearTimeout(settleUnlockTimerRef.current);
      settleUnlockTimerRef.current = null;
    }
    isSettlingRef.current = false;
    programmaticTargetRef.current = null;
  }, []);

  const settleRef = useRef(() => {});
  settleRef.current = () => {
    settleTimerRef.current = null;
    if (!enabled || !interactedRef.current || isSettlingRef.current) return;
    const target = getDateGroupSnapTarget(
      currentOffsetRef.current,
      Math.max(0, viewportHeight - bottomInset),
      [...layoutsRef.current.values()],
    );
    if (target === null || Math.abs(target - currentOffsetRef.current) < 1) return;
    currentOffsetRef.current = target;
    isSettlingRef.current = true;
    programmaticTargetRef.current = target;
    listRef.current?.scrollToOffset({ offset: target, animated: true });
    settleUnlockTimerRef.current = setTimeout(clearSettleLock, 1000);
  };

  const scheduleSettle = useCallback((delay = WEB_SETTLE_DELAY_MS) => {
    clearSettleTimer();
    settleTimerRef.current = setTimeout(() => settleRef.current(), delay);
  }, [clearSettleTimer]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, event.nativeEvent.contentOffset.y);
    currentOffsetRef.current = offset;
    const current = findDateGroupAtOffset(offset, [...layoutsRef.current.values()]);
    if (current) {
      anchorKeyRef.current = current.dateKey;
      anchorDistanceRef.current = offset - current.offset;
    }

    const programmaticTarget = programmaticTargetRef.current;
    if (programmaticTarget !== null) {
      if (Math.abs(programmaticTarget - offset) < 1) clearSettleLock();
      return;
    }

    // Web wheel scrolling does not reliably emit the native drag lifecycle.
    if (Platform.OS === "web" && !isSettlingRef.current) {
      interactedRef.current = true;
      scheduleSettle();
    }
  }, [clearSettleLock, scheduleSettle]);

  const onScrollBeginDrag = useCallback(() => {
    interactedRef.current = true;
    clearSettleLock();
    clearSettleTimer();
  }, [clearSettleLock, clearSettleTimer]);

  const onMomentumScrollBegin = useCallback(() => {
    interactedRef.current = true;
    clearSettleTimer();
  }, [clearSettleTimer]);

  const onScrollEndDrag = useCallback(() => {
    interactedRef.current = true;
    scheduleSettle(Platform.OS === "web" ? WEB_SETTLE_DELAY_MS : NATIVE_SETTLE_DELAY_MS);
  }, [scheduleSettle]);

  const onMomentumScrollEnd = useCallback(() => {
    if (isSettlingRef.current) {
      clearSettleLock();
      return;
    }
    interactedRef.current = true;
    scheduleSettle(0);
  }, [clearSettleLock, scheduleSettle]);

  useEffect(() => () => {
    clearSettleTimer();
    clearSettleLock();
    if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current);
    if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current);
  }, [clearSettleLock, clearSettleTimer]);

  return {
    onLayout,
    setGroupRef,
    onGroupLayout,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
  };
}