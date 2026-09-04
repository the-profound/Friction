import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { ReaderTokens, Shadows } from "@/constants/tokens";
import {
  PREVIEW_PAGER_HORIZONTAL_ACTIVATION,
  PREVIEW_PAGER_VERTICAL_FAILURE,
  getPreviewPagerTurn,
} from "./gesturePolicy";

type PagerSlotRole = "prev" | "current" | "next";

interface PagerDimensions {
  width: number;
  height: number;
}

export interface PreviewPagerProps {
  pageCount: number;
  pageIndex: number;
  onPageChange: (pageIndex: number) => void;
  renderPage: (pageIndex: number, dimensions: PagerDimensions) => React.ReactNode;
}

const SLOT_MAX_ROTATE_DEG = 4;
const PARK_EXTRA = 120;
const SNAP_CONFIG = { damping: 18, stiffness: 280, mass: 0.8 };
const SLIDE_EASING = Easing.bezier(0.25, 0.46, 0.45, 0.94);

/**
 * Closing-screen preview pager.
 *
 * This deliberately mirrors the ordinary letter-page mode of read.tsx:
 * the next page stays under the current page, the current page follows a
 * horizontal drag out, and the previous page follows a drag in. Slots are
 * keyed by page index so a completed turn moves an existing WebView instance
 * instead of unmounting and mounting it again.
 */
export default function PreviewPager({
  pageCount,
  pageIndex,
  onPageChange,
  renderPage,
}: PreviewPagerProps) {
  const [availableSize, setAvailableSize] = useState<PagerDimensions>({ width: 0, height: 0 });
  const dimensions = useMemo(() => {
    const maxHeight = Math.min(availableSize.height, 480);
    const width = Math.min(availableSize.width, maxHeight * ReaderTokens.aspectRatio);
    return {
      width,
      height: width > 0 ? width / ReaderTokens.aspectRatio : 0,
    };
  }, [availableSize.height, availableSize.width]);
  const currentSlotSV = useSharedValue(0);
  const prevSlotSV = useSharedValue(0);
  const nextSlotSV = useSharedValue(0);
  const containerWidthSV = useSharedValue(0);
  const activeSwipeRef = useRef<"forward" | "backward" | null>(null);
  const pageIndexRef = useRef(pageIndex);
  const pageCountRef = useRef(pageCount);
  const onPageChangeRef = useRef(onPageChange);
  const generationRef = useRef(0);
  const committingRef = useRef(false);

  pageIndexRef.current = pageIndex;
  pageCountRef.current = pageCount;
  onPageChangeRef.current = onPageChange;

  const handleContainerLayout = useCallback((event: { nativeEvent: { layout: PagerDimensions } }) => {
    const { width, height } = event.nativeEvent.layout;
    setAvailableSize((previous) => (
      previous.width === width && previous.height === height
        ? previous
        : { width, height }
    ));
  }, []);

  useLayoutEffect(() => {
    // A server page refresh or viewport change invalidates callbacks from the
    // previous slot topology before the slots are reset.
    generationRef.current += 1;
    const width = dimensions.width;
    containerWidthSV.value = width;
    currentSlotSV.value = 0;
    prevSlotSV.value = -(width + PARK_EXTRA);
    nextSlotSV.value = 0;
    activeSwipeRef.current = null;
    committingRef.current = false;
  }, [
    containerWidthSV,
    currentSlotSV,
    dimensions.width,
    nextSlotSV,
    pageCount,
    pageIndex,
    prevSlotSV,
  ]);

  const finishPageTurn = useCallback((direction: -1 | 1, sourcePage: number, generation: number) => {
    if (generation !== generationRef.current || sourcePage !== pageIndexRef.current) return;
    const pageDelta = direction === -1 ? 1 : -1;
    const nextPage = Math.max(0, Math.min(pageCountRef.current - 1, sourcePage + pageDelta));
    committingRef.current = false;
    activeSwipeRef.current = null;
    onPageChangeRef.current(nextPage);
  }, []);
  const finishPageTurnRef = useRef(finishPageTurn);
  finishPageTurnRef.current = finishPageTurn;

  const panGesture = useMemo(() => {
    const hitSlop = Platform.OS === "android"
      ? { left: -24, right: -24 }
      : undefined;
    const gesture = Gesture.Pan()
      .activeOffsetX([
        -PREVIEW_PAGER_HORIZONTAL_ACTIVATION,
        PREVIEW_PAGER_HORIZONTAL_ACTIVATION,
      ])
      .failOffsetY([
        -PREVIEW_PAGER_VERTICAL_FAILURE,
        PREVIEW_PAGER_VERTICAL_FAILURE,
      ])
      .runOnJS(true);
    if (hitSlop) gesture.hitSlop(hitSlop);

    return gesture
      .onBegin(() => {
        if (committingRef.current) return;
      })
      .onUpdate((event) => {
        if (committingRef.current) return;
        const width = containerWidthSV.value || 300;
        const total = pageCountRef.current;
        const current = pageIndexRef.current;
        const dx = event.translationX;
        const dy = event.translationY;
        if (total < 2 || Math.abs(dy) > Math.abs(dx) * 1.8) return;
        if (dx < 0) {
          if (current >= total - 1) return;
          activeSwipeRef.current = "forward";
          currentSlotSV.value = Math.max(dx, -(width + PARK_EXTRA));
        } else if (dx > 0) {
          if (current <= 0) return;
          activeSwipeRef.current = "backward";
          prevSlotSV.value = Math.max(-(width + PARK_EXTRA), dx - width);
        }
      })
      .onEnd((event) => {
        if (committingRef.current) return;
        const width = containerWidthSV.value || 300;
        const total = pageCountRef.current;
        const current = pageIndexRef.current;
        const dx = event.translationX;
        const goingNext = dx < 0;
        const canNavigate = goingNext ? current < total - 1 : current > 0;
        const activeDirection = goingNext ? "forward" : "backward";

        const snapBack = () => {
          currentSlotSV.value = withSpring(0, SNAP_CONFIG);
          prevSlotSV.value = withSpring(-(width + PARK_EXTRA), SNAP_CONFIG);
          activeSwipeRef.current = null;
        };

        if (
          !canNavigate
          || activeSwipeRef.current !== activeDirection
          || Math.abs(event.translationY) > Math.abs(dx) * 1.8
        ) {
          snapBack();
          return;
        }

        const destinationPage = getPreviewPagerTurn({
          pageIndex: current,
          pageCount: total,
          width,
          translationX: dx,
          velocityX: event.velocityX,
        });
        if (destinationPage === current) {
          snapBack();
          return;
        }

        const direction: -1 | 1 = goingNext ? -1 : 1;
        const sourcePage = current;
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        committingRef.current = true;
        if (direction === -1) {
          currentSlotSV.value = withTiming(
            -(width + PARK_EXTRA),
            { duration: 240, easing: SLIDE_EASING },
            () => runOnJS(finishPageTurnRef.current)(direction, sourcePage, generation),
          );
        } else {
          prevSlotSV.value = withTiming(
            0,
            { duration: 240, easing: SLIDE_EASING },
            () => runOnJS(finishPageTurnRef.current)(direction, sourcePage, generation),
          );
        }
      })
      .onFinalize(() => {
        if (committingRef.current) return;
        const width = containerWidthSV.value || 300;
        currentSlotSV.value = withSpring(0, SNAP_CONFIG);
        prevSlotSV.value = withSpring(-(width + PARK_EXTRA), SNAP_CONFIG);
        nextSlotSV.value = withSpring(0, SNAP_CONFIG);
        activeSwipeRef.current = null;
      });
  }, [containerWidthSV, currentSlotSV, nextSlotSV, prevSlotSV]);

  const total = Math.max(0, pageCount);
  const current = Math.max(0, Math.min(pageIndex, Math.max(0, total - 1)));
  const slots = [
    { pageIdx: current + 1, role: "next" as const },
    { pageIdx: current, role: "current" as const },
    { pageIdx: current - 1, role: "prev" as const },
  ];

  return (
    <GestureDetector gesture={panGesture}>
      <View
        style={[
          styles.container,
          Platform.OS === "web" ? ({ touchAction: "none" } as object) : undefined,
        ]}
        onLayout={handleContainerLayout}
      >
        <View style={[styles.frame, dimensions]}>
          {dimensions.width > 0 && total > 0 && (
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              {slots.map((slot) => (
                <PreviewPagerSlot
                  key={`page-${slot.pageIdx}`}
                  role={slot.role}
                  currentSlotSV={currentSlotSV}
                  prevSlotSV={prevSlotSV}
                  nextSlotSV={nextSlotSV}
                  containerWidthSV={containerWidthSV}
                >
                  {slot.pageIdx >= 0 && slot.pageIdx < total
                    ? renderPage(slot.pageIdx, dimensions)
                    : null}
                </PreviewPagerSlot>
              ))}
            </View>
          )}
        </View>
      </View>
    </GestureDetector>
  );
}

function PreviewPagerSlot({
  role,
  currentSlotSV,
  prevSlotSV,
  nextSlotSV,
  containerWidthSV,
  children,
}: {
  role: PagerSlotRole;
  currentSlotSV: SharedValue<number>;
  prevSlotSV: SharedValue<number>;
  nextSlotSV: SharedValue<number>;
  containerWidthSV: SharedValue<number>;
  children: React.ReactNode;
}) {
  const slotAnimStyle = useAnimatedStyle(() => {
    const width = containerWidthSV.value || 300;
    if (role === "next") {
      return { transform: [{ translateX: nextSlotSV.value }] };
    }
    if (role === "current") {
      const translateX = currentSlotSV.value;
      const rotation = translateX < -0.5
        ? -(Math.min(1, -translateX / width) * SLOT_MAX_ROTATE_DEG)
        : 0;
      return {
        transform: [{ translateX }, { rotateZ: `${rotation}deg` }],
      };
    }
    const translateX = prevSlotSV.value;
    const slideIn = translateX + width;
    const rotation = (slideIn / width - 1) * SLOT_MAX_ROTATE_DEG;
    return {
      transform: [{ translateX }, { rotateZ: `${rotation}deg` }],
    };
  }, [containerWidthSV, currentSlotSV, nextSlotSV, prevSlotSV, role]);

  const shadowAnimStyle = useAnimatedStyle(() => {
    const width = containerWidthSV.value || 300;
    if (role === "next") return { opacity: 1 };
    if (role === "current") {
      return { opacity: Math.min(1, Math.max(0, -currentSlotSV.value / width)) };
    }
    return {
      opacity: Math.min(1, Math.max(0, 1 - (prevSlotSV.value + width) / width)),
    };
  }, [containerWidthSV, currentSlotSV, prevSlotSV, role]);

  return (
    <Animated.View
      style={[styles.slot, slotAnimStyle]}
      pointerEvents="auto"
    >
      <Animated.View style={[styles.shadow, shadowAnimStyle]} />
      {children != null && <View style={styles.content}>{children}</View>}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    position: "relative",
  },
  slot: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  shadow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: ReaderTokens.bodyBg,
    ...Shadows.previewPage,
  },
  content: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: ReaderTokens.bodyBg,
  },
});