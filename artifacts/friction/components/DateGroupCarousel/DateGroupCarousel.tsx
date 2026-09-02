import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import DotIndicator from "@/components/DotIndicator/DotIndicator";
import { Colors, Sizing, Spacing, Typography } from "@/constants/tokens";
import {
  clampCarouselIndex,
  getCarouselNextIndex,
  resolveCarouselIndex,
} from "@/lib/dateGroupCarousel";

export interface CarouselOriginLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DateGroupCarouselItemContext {
  index: number;
  isActive: boolean;
  shouldIgnorePress: () => boolean;
  measureOrigin: (callback: (layout: CarouselOriginLayout) => void) => void;
}

interface DateGroupCarouselProps<T> {
  dateLabel: string;
  countLabel: string;
  items: readonly T[];
  itemKey: (item: T) => string;
  cardWidth: number;
  cardHeight: number;
  /** Reset to the first card only when the parent starts a new browse session. */
  resetKey?: string | number;
  renderCard: (item: T, context: DateGroupCarouselItemContext) => React.ReactNode;
  shouldIgnoreVerticalPress?: () => boolean;
}

const SWIPE_THRESHOLD = Sizing.swipeThreshold;
const FLING_VELOCITY = 0.5;

/**
 * A date header plus centered horizontal cards. The platform split is kept in
 * one place: PanResponder/Animated on web and a snapping ScrollView on native.
 */
export function DateGroupCarousel<T>({
  dateLabel,
  countLabel,
  items,
  itemKey,
  cardWidth,
  cardHeight,
  resetKey,
  renderCard,
  shouldIgnoreVerticalPress,
}: DateGroupCarouselProps<T>) {
  const { width: windowWidth } = useWindowDimensions();
  const itemCount = items.length;
  const contentHeight = cardHeight;
  const snapInterval = cardWidth + Spacing.cardGap;
  const itemKeys = useMemo(() => items.map(itemKey), [items, itemKey]);
  const itemSignature = itemKeys.join("|");
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const activeItemKeyRef = useRef<string | null>(itemKeys[0] ?? null);
  const resetKeyRef = useRef(resetKey);
  const itemCountRef = useRef(itemCount);
  const geometryRef = useRef({ cardWidth, windowWidth, snapInterval });
  const slotRefs = useRef<(View | null)[]>([]);
  const nativeScrollRef = useRef<ScrollView>(null);
  const translateX = useRef(new Animated.Value(0)).current;
  const swipedRef = useRef(false);
  const snapToRef = useRef((_index: number) => {});

  itemCountRef.current = itemCount;
  geometryRef.current = { cardWidth, windowWidth, snapInterval };

  const getBaseX = useCallback((index: number) => {
    const geometry = geometryRef.current;
    return -(index * geometry.snapInterval) + (geometry.windowWidth - geometry.cardWidth) / 2;
  }, []);

  snapToRef.current = (index: number) => {
    const nextIndex = clampCarouselIndex(index, itemCountRef.current);
    activeIndexRef.current = nextIndex;
    activeItemKeyRef.current = itemKeys[nextIndex] ?? null;
    setActiveIndex((current) => current === nextIndex ? current : nextIndex);
    Animated.spring(translateX, {
      toValue: getBaseX(nextIndex),
      useNativeDriver: false,
      overshootClamping: true,
      tension: 100,
      friction: 20,
    }).start();
  };

  useEffect(() => {
    // Keep the selected entity after data refreshes and edits; only a missing
    // entity falls back to the nearest valid slot.
    const shouldReset = resetKeyRef.current !== resetKey;
    resetKeyRef.current = resetKey;
    const nextIndex = resolveCarouselIndex(
      activeItemKeyRef.current,
      activeIndexRef.current,
      itemKeys,
      shouldReset,
    );
    activeIndexRef.current = nextIndex;
    activeItemKeyRef.current = itemKeys[nextIndex] ?? null;
    setActiveIndex((current) => current === nextIndex ? current : nextIndex);
    if (shouldReset) {
      snapToRef.current(nextIndex);
      nativeScrollRef.current?.scrollTo({ x: nextIndex * snapInterval, animated: false });
    } else {
      translateX.setValue(getBaseX(nextIndex));
      nativeScrollRef.current?.scrollTo({ x: nextIndex * snapInterval, animated: false });
    }
  }, [cardWidth, getBaseX, itemCount, itemKeys, itemSignature, resetKey, snapInterval, translateX, windowWidth]);

  const releaseToNearestSlot = useCallback((distanceX: number, velocityX: number) => {
    snapToRef.current(getCarouselNextIndex(
      activeIndexRef.current,
      itemCountRef.current,
      distanceX,
      velocityX,
      SWIPE_THRESHOLD,
      FLING_VELOCITY,
    ));
    setTimeout(() => { swipedRef.current = false; }, 100);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        swipedRef.current = false;
        return false;
      },
      onMoveShouldSetPanResponder: (_, gesture) =>
        itemCountRef.current > 1
        && Math.abs(gesture.dx) > Math.abs(gesture.dy)
        && Math.abs(gesture.dx) > 5,
      onPanResponderGrant: () => {
        translateX.setValue(getBaseX(activeIndexRef.current));
      },
      onPanResponderMove: (_, gesture) => {
        if (Math.abs(gesture.dx) > 15) swipedRef.current = true;
        const raw = getBaseX(activeIndexRef.current) + gesture.dx;
        const maximum = getBaseX(0);
        const minimum = getBaseX(itemCountRef.current - 1);
        translateX.setValue(
          raw > maximum
            ? maximum + (raw - maximum) * 0.3
            : raw < minimum
              ? minimum + (raw - minimum) * 0.3
              : raw,
        );
      },
      onPanResponderRelease: (_, gesture) => releaseToNearestSlot(gesture.dx, gesture.vx),
      onPanResponderTerminate: (_, gesture) => releaseToNearestSlot(gesture.dx, gesture.vx),
    }),
  ).current;

  const onNativeScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = clampCarouselIndex(
      Math.round(event.nativeEvent.contentOffset.x / snapInterval),
      itemCount,
    );
    activeIndexRef.current = nextIndex;
    activeItemKeyRef.current = itemKeys[nextIndex] ?? null;
    setActiveIndex((current) => current === nextIndex ? current : nextIndex);
  }, [itemCount, itemKeys, snapInterval]);

  const markNativeSwipe = useCallback(() => {
    swipedRef.current = true;
  }, []);
  const clearNativeSwipe = useCallback(() => {
    setTimeout(() => { swipedRef.current = false; }, 100);
  }, []);

  const slots = items.map((item, index) => {
    const key = itemKeys[index];
    const measureOrigin = (callback: (layout: CarouselOriginLayout) => void) => {
      const slot = slotRefs.current[index];
      if (slot) {
        slot.measureInWindow((x, y, width, height) => callback({ x, y, width, height }));
      } else {
        callback({ x: 0, y: 0, width: cardWidth, height: cardHeight });
      }
    };

    return (
      <View
        key={key}
        ref={(ref) => { slotRefs.current[index] = ref; }}
        style={[
          styles.cardSlot,
          { width: cardWidth, height: contentHeight },
          index < itemCount - 1 && { marginRight: Spacing.cardGap },
        ]}
      >
        {renderCard(item, {
          index,
          isActive: index === activeIndex,
          shouldIgnorePress: () => swipedRef.current || Boolean(shouldIgnoreVerticalPress?.()),
          measureOrigin,
        })}
      </View>
    );
  });

  const viewportHeight = contentHeight + Sizing.carouselShadowInsetTop + Sizing.carouselShadowInsetBottom;

  return (
    <View style={styles.group}>
      <View style={styles.dateHeader}>
        <Text style={styles.dateHeaderText}>{dateLabel}</Text>
        <Text style={styles.dateHeaderCount}>{countLabel}</Text>
      </View>
      {Platform.OS === "web" ? (
        <View
          style={[styles.carouselWindow, { width: windowWidth, height: viewportHeight, userSelect: "none", cursor: "grab" } as object]}
          {...panResponder.panHandlers}
        >
          <Animated.View
            style={[
              styles.carouselTrack,
              {
                height: viewportHeight,
                paddingTop: Sizing.carouselShadowInsetTop,
                paddingBottom: Sizing.carouselShadowInsetBottom,
                transform: [{ translateX }],
              },
            ]}
          >
            {slots}
          </Animated.View>
        </View>
      ) : (
        <ScrollView
          ref={nativeScrollRef}
          horizontal
          nestedScrollEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          snapToInterval={snapInterval}
          snapToAlignment="start"
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={onNativeScroll}
          onScrollBeginDrag={markNativeSwipe}
          onScrollEndDrag={clearNativeSwipe}
          onMomentumScrollEnd={clearNativeSwipe}
          contentContainerStyle={[
            styles.carouselContent,
            {
              paddingHorizontal: (windowWidth - cardWidth) / 2,
              paddingTop: Sizing.carouselShadowInsetTop,
              paddingBottom: Sizing.carouselShadowInsetBottom,
            },
          ]}
          style={[styles.carouselScroll, { height: viewportHeight }]}
        >
          {slots}
        </ScrollView>
      )}
      <DotIndicator total={itemCount} activeIndex={activeIndex} />
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    paddingBottom: Spacing.carouselGroupBottom,
  },
  dateHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: Sizing.dateHeaderH,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: Spacing.dateHeaderPt,
    paddingBottom: Spacing.dateHeaderPb,
  },
  dateHeaderText: {
    ...Typography.dateHeader,
    color: Colors.zinc600,
  },
  dateHeaderCount: {
    ...Typography.caption,
    color: Colors.zinc500,
  },
  // The clip only owns horizontal paging. The padded track leaves enough
  // vertical room for the short carousel shadow before the clip boundary.
  carouselWindow: {
    overflow: "hidden",
  },
  carouselTrack: {
    flexDirection: "row",
  },
  carouselScroll: {},
  carouselContent: {},
  cardSlot: {},
});