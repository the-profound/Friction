import { useCallback, useEffect, useRef, useState } from "react";
import {
  PanResponder,
  Platform,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PanResponderGestureState,
} from "react-native";
import {
  findDateGroupAtOffset,
  getDateGroupPageDecision,
  preserveDateGroupAnchor,
  resolveDateGroupAnchor,
  resolveDateGroupLayouts,
  shouldApplyDateGroupMeasurement,
  type DateGroupLayout,
} from "@/lib/dateGroupVerticalSnap";
import { Sizing } from "@/constants/tokens";

interface VerticalListRef {
  scrollToOffset: (params: { offset: number; animated: boolean }) => void;
}

interface MeasurableView {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

interface WheelEventLike {
  deltaY: number;
  deltaMode?: number;
  preventDefault?: () => void;
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
  estimatedGroupHeight?: number;
  estimatedGroupHeights?: ReadonlyMap<string, number>;
  viewportRef?: React.RefObject<MeasurableView | null>;
  /** Starts the shared press guard before a vertical page transition. */
  onPageGestureStart?: () => void;
  /** Moves back to the first date group when the owning tab is reselected. */
  resetKey?: string | number;
}

const FLING_VELOCITY = 0.5;
const WHEEL_SETTLE_DELAY_MS = 90;
const PAGE_ANIMATION_TIMEOUT_MS = 700;

/**
 * Owns the vertical date-group page contract.
 *
 * The FlatList is deliberately not the gesture owner: free scrolling makes a
 * tall group behave differently from a short group and is not consistent on
 * React Native Web. Touch/mouse drags are resolved by PanResponder and web
 * wheel/trackpad input is resolved by the same pure page decision.
 */
export function useDateGroupVerticalSnap({
  groupKeys,
  groupSignature,
  listRef,
  enabled,
  estimatedGroupHeight,
  estimatedGroupHeights,
  viewportRef,
  onPageGestureStart,
  resetKey,
}: UseDateGroupVerticalSnapOptions) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const [pageLocked, setPageLocked] = useState(false);
  const layoutsRef = useRef(new Map<string, DateGroupLayout>());
  const heightsRef = useRef(new Map<string, number>());
  const measuredLayoutsRef = useRef(new Map<string, DateGroupLayout>());
  const groupNodesRef = useRef(new Map<string, MeasurableView>());
  const groupKeysRef = useRef<string[]>([...groupKeys]);
  const previousKeysRef = useRef<string[]>([]);
  const currentOffsetRef = useRef(0);
  const currentKeyRef = useRef<string | null>(groupKeys[0] ?? null);
  const gestureStartKeyRef = useRef<string | null>(null);
  const nativeGestureStartOffsetRef = useRef(0);
  const isNativeDraggingRef = useRef(false);
  const pendingRestoreKeyRef = useRef<string | null>(null);
  const pendingRestoreAnimatedRef = useRef(false);
  const restoreFrameRef = useRef<number | null>(null);
  const measureFrameRef = useRef<number | null>(null);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelDistanceRef = useRef(0);
  const pageUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionGenerationRef = useRef(0);
  const layoutGenerationRef = useRef(0);
  const resetKeyRef = useRef(resetKey);
  const isPageAnimatingRef = useRef(false);
  const programmaticTargetRef = useRef<number | null>(null);
  const finishGestureRef = useRef((
    _distanceY: number,
    _velocityY: number,
    _animated: boolean,
    _forceLock: boolean,
  ) => {});
  const beginGestureRef = useRef(() => {});

  groupKeysRef.current = [...groupKeys];

  const clearWheelTimer = useCallback(() => {
    if (wheelTimerRef.current !== null) {
      clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = null;
    }
  }, []);

  const clearPageAnimationLock = useCallback(() => {
    transitionGenerationRef.current += 1;
    if (pageUnlockTimerRef.current !== null) {
      clearTimeout(pageUnlockTimerRef.current);
      pageUnlockTimerRef.current = null;
    }
    isPageAnimatingRef.current = false;
    programmaticTargetRef.current = null;
    setPageLocked(false);
  }, []);

  const rebuildLayouts = useCallback(() => {
    const resolved = resolveDateGroupLayouts(
      groupKeysRef.current,
      heightsRef.current,
      measuredLayoutsRef.current,
    );
    layoutsRef.current.clear();
    for (const layout of resolved) layoutsRef.current.set(layout.dateKey, layout);
  }, []);

  const restoreAnchor = useCallback(() => {
    const key = pendingRestoreKeyRef.current;
    if (!key || !enabled) return;
    const layout = layoutsRef.current.get(key);
    if (!layout) return;
    if (
      viewportRef?.current
      && groupNodesRef.current.has(key)
      && !measuredLayoutsRef.current.has(key)
    ) {
      return;
    }

    pendingRestoreKeyRef.current = null;
    const shouldAnimate = pendingRestoreAnimatedRef.current;
    pendingRestoreAnimatedRef.current = false;
    currentKeyRef.current = key;
    const offset = Math.max(0, layout.offset);
    currentOffsetRef.current = offset;
    programmaticTargetRef.current = offset;
    listRef.current?.scrollToOffset({ offset, animated: shouldAnimate });
  }, [enabled, listRef, viewportRef]);

  const scheduleAnchorRestore = useCallback(() => {
    if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current);
    restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      restoreAnchor();
    });
  }, [restoreAnchor]);

  const measureGroupNode = useCallback((dateKey: string, node: MeasurableView) => {
    const viewport = viewportRef?.current;
    if (!viewport) return;
    const measurementGeneration = layoutGenerationRef.current;
    viewport.measureInWindow((_viewportX, viewportY) => {
      if (measurementGeneration !== layoutGenerationRef.current) return;
      node.measureInWindow((_groupX, groupY, _groupWidth, groupHeight) => {
        if (!shouldApplyDateGroupMeasurement(
          measurementGeneration,
          layoutGenerationRef.current,
          groupNodesRef.current.get(dateKey) === node,
          groupHeight,
        )) return;
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
      for (const [dateKey, node] of groupNodesRef.current) measureGroupNode(dateKey, node);
    });
  }, [measureGroupNode, viewportRef]);

  useEffect(() => {
    clearPageAnimationLock();
    layoutGenerationRef.current += 1;
    const nextKeys = [...groupKeys];
    const previousKeys = previousKeysRef.current;
    const previousKey = currentKeyRef.current;
    const shouldReset = resetKeyRef.current !== resetKey;
    resetKeyRef.current = resetKey;
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

    const nextAnchor = previousKeys.length > 0
      ? resolveDateGroupAnchor(previousKey, previousKeys, nextKeys, shouldReset)
      : nextKeys[0] ?? null;
    currentKeyRef.current = nextAnchor;
    pendingRestoreKeyRef.current = nextAnchor;
    pendingRestoreAnimatedRef.current = shouldReset && nextAnchor !== null;
    currentOffsetRef.current = layoutsRef.current.get(nextAnchor ?? "")?.offset ?? 0;
    previousKeysRef.current = nextKeys;

    if (viewportRef?.current) scheduleVisibleMeasurements();
    scheduleAnchorRestore();
  }, [
    enabled,
    clearPageAnimationLock,
    estimatedGroupHeight,
    estimatedGroupHeights,
    groupKeys,
    groupSignature,
    rebuildLayouts,
    resetKey,
    scheduleAnchorRestore,
    scheduleVisibleMeasurements,
    viewportRef,
    viewportHeight,
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

  const moveToDateKey = useCallback((
    dateKey: string | null,
    animated: boolean,
    forceLock = false,
  ) => {
    if (!dateKey) return;
    const layout = layoutsRef.current.get(dateKey);
    if (!layout) return;
    const offset = Math.max(0, layout.offset);
    const shouldAnimate = animated && Math.abs(offset - currentOffsetRef.current) >= 1;
    const shouldLock = forceLock || shouldAnimate;
    currentKeyRef.current = dateKey;
    currentOffsetRef.current = offset;
    programmaticTargetRef.current = shouldLock ? offset : null;
    isPageAnimatingRef.current = shouldLock;
    if (pageUnlockTimerRef.current !== null) clearTimeout(pageUnlockTimerRef.current);
    if (shouldLock) {
      const generation = transitionGenerationRef.current + 1;
      transitionGenerationRef.current = generation;
      setPageLocked(true);
      pageUnlockTimerRef.current = setTimeout(() => {
        if (transitionGenerationRef.current !== generation) return;
        clearPageAnimationLock();
      }, PAGE_ANIMATION_TIMEOUT_MS);
    }
    listRef.current?.scrollToOffset({ offset, animated: shouldAnimate });
  }, [clearPageAnimationLock, listRef]);

  const finishPageGesture = useCallback((
    distanceY: number,
    velocityY: number,
    animated: boolean,
    forceLock: boolean,
  ) => {
    if (!enabled || isPageAnimatingRef.current) return;
    onPageGestureStart?.();
    const currentKey = gestureStartKeyRef.current ?? currentKeyRef.current;
    const decision = getDateGroupPageDecision(
      currentKey,
      groupKeysRef.current,
      layoutsRef.current.size > 0 ? [...layoutsRef.current.values()] : [],
      distanceY,
      velocityY,
      Sizing.swipeThreshold,
      FLING_VELOCITY,
    );
    moveToDateKey(decision.dateKey, animated, forceLock);
  }, [enabled, moveToDateKey, onPageGestureStart]);
  finishGestureRef.current = finishPageGesture;

  const beginPageGesture = useCallback(() => {
    if (!enabled || isPageAnimatingRef.current) return;
    clearWheelTimer();
    wheelDistanceRef.current = 0;
    gestureStartKeyRef.current = currentKeyRef.current
      ?? findDateGroupAtOffset(currentOffsetRef.current, [...layoutsRef.current.values()])?.dateKey
      ?? groupKeysRef.current[0]
      ?? null;
    onPageGestureStart?.();
  }, [clearWheelTimer, enabled, onPageGestureStart]);
  beginGestureRef.current = beginPageGesture;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Platform.OS === "web"
        && !isPageAnimatingRef.current
        && Math.abs(gesture.dy) > Math.abs(gesture.dx)
        && Math.abs(gesture.dy) > 6,
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        Platform.OS === "web"
        && !isPageAnimatingRef.current
        && Math.abs(gesture.dy) > Math.abs(gesture.dx)
        && Math.abs(gesture.dy) > 6,
      onPanResponderGrant: () => beginGestureRef.current(),
      onPanResponderMove: () => {},
      onPanResponderRelease: (_, gesture: PanResponderGestureState) =>
        finishGestureRef.current(gesture.dy, gesture.vy, true, false),
      onPanResponderTerminate: (_, gesture: PanResponderGestureState) =>
        finishGestureRef.current(gesture.dy, gesture.vy, true, false),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  const onWheel = useCallback((event: WheelEventLike) => {
    if (!enabled) return;
    event.preventDefault?.();
    if (isPageAnimatingRef.current) return;
    const rawDelta = Number.isFinite(event.deltaY) ? event.deltaY : 0;
    if (rawDelta === 0) return;
    const multiplier = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? Math.max(1, viewportHeight)
        : 1;
    // The web wheel path was inverted relative to the pointer/touch gesture.
    // Keep native drag direction unchanged and reverse only this web input.
    wheelDistanceRef.current -= rawDelta * multiplier;
    clearWheelTimer();
    wheelTimerRef.current = setTimeout(() => {
      wheelTimerRef.current = null;
      const distance = wheelDistanceRef.current;
      wheelDistanceRef.current = 0;
      if (Math.abs(distance) < 1) return;
      beginPageGesture();
      finishGestureRef.current(distance, 0, true, false);
    }, WHEEL_SETTLE_DELAY_MS);
  }, [beginPageGesture, clearWheelTimer, enabled, viewportHeight]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, event.nativeEvent.contentOffset.y);
    const programmaticTarget = programmaticTargetRef.current;
    if (programmaticTarget !== null) {
      if (Math.abs(programmaticTarget - offset) < 1) {
        currentOffsetRef.current = programmaticTarget;
        if (!isPageAnimatingRef.current) programmaticTargetRef.current = null;
      }
      return;
    }
    currentOffsetRef.current = offset;
    const current = findDateGroupAtOffset(offset, [...layoutsRef.current.values()]);
    if (current && !isPageAnimatingRef.current && !isNativeDraggingRef.current) {
      currentKeyRef.current = current.dateKey;
    }
  }, []);

  const onScrollBeginDrag = useCallback(() => {
    if (!enabled || isPageAnimatingRef.current) return;
    isNativeDraggingRef.current = true;
    nativeGestureStartOffsetRef.current = currentOffsetRef.current;
    beginPageGesture();
  }, [beginPageGesture, enabled]);

  const onScrollEndDrag = useCallback((
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    if (!enabled || !isNativeDraggingRef.current) return;
    isNativeDraggingRef.current = false;
    const endOffset = Math.max(0, event.nativeEvent.contentOffset.y);
    currentOffsetRef.current = endOffset;
    const scrollVelocityY = event.nativeEvent.velocity?.y ?? 0;
    finishGestureRef.current(
      nativeGestureStartOffsetRef.current - endOffset,
      -scrollVelocityY,
      false,
      true,
    );
  }, [enabled]);

  useEffect(() => () => {
    clearWheelTimer();
    clearPageAnimationLock();
    if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current);
    if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current);
  }, [clearPageAnimationLock, clearWheelTimer]);

  return {
    onLayout,
    setGroupRef,
    onGroupLayout,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onWheel,
    panHandlers: panResponder.panHandlers,
    pageLocked,
  };
}