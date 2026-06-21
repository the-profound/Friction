import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  PanResponder,
  Dimensions,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import ScalePressable from "@/components/shared/ScalePressable";
import type { Article } from "@workspace/api-client-react";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const CARD_W = Sizing.cardSlotW;
const CARD_H = Sizing.cardH;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// Gap between adjacent cards — creates the side-peek effect
const OVERLAY_GAP = 16;
const SLOT_W = CARD_W + OVERLAY_GAP;

const CAROUSEL_SNAP_THRESHOLD = CARD_W * 0.28;
const CAROUSEL_FLING_VX = 0.45;

export interface OriginLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChainArticleMeta {
  authorName?: string | null;
  authorId?: string | null;
  collectionName?: string | null;
  collectionId?: string | null;
  date?: string | Date | null;
  isNotice?: boolean;
}

/** @deprecated Use ChainArticleMeta */
export type AdjacentMeta = ChainArticleMeta;

function formatDate(visibleAt: string | Date): string {
  const utcMs = new Date(visibleAt).getTime();
  const kstDate = new Date(utcMs + KST_OFFSET_MS);
  const month = kstDate.getUTCMonth() + 1;
  const day = kstDate.getUTCDate();
  return `${month}월 ${day}일`;
}

interface CardSelectOverlayProps {
  /**
   * Full article chain, sorted oldest→newest.
   * A null entry represents a slot that is still loading — rendered as a skeleton.
   */
  articles: (Article | null)[];
  /** Per-slot metadata, same length as articles. */
  metas: ChainArticleMeta[];
  /** Index of the originally-tapped article within articles[]. */
  initialIndex: number;
  originLayout: OriginLayout | null;
  onClose: () => void;
  /** Called with the active carousel index when the user taps 읽기. */
  onRead: (index: number) => void;
  onNavigateToCollection?: (id: string) => void;
  /** Called with the author's user id when the user taps the author name. */
  onNavigateToAuthor?: (authorId: string) => void;
}

export default function CardSelectOverlay({
  articles,
  metas,
  initialIndex,
  originLayout,
  onClose,
  onRead,
  onNavigateToCollection,
  onNavigateToAuthor,
}: CardSelectOverlayProps) {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const count = articles.length;
  const isOpen = count > 0;

  // ── Frozen refs for close animation ───────────────────────────────────────
  const frozenArticles = useRef<(Article | null)[]>(articles);
  const frozenMetas = useRef<ChainArticleMeta[]>(metas);
  if (isOpen) {
    frozenArticles.current = articles;
    frozenMetas.current = metas;
  }
  const displayArticles = frozenArticles.current;
  const displayMetas = frozenMetas.current;

  const frozenOrigin = useRef(originLayout);
  if (originLayout) frozenOrigin.current = originLayout;
  const displayOrigin = frozenOrigin.current;

  // ── Info bar scroll state ─────────────────────────────────────────────────
  const [infoBarOverflowing, setInfoBarOverflowing] = useState(false);
  const [infoBarAtEnd, setInfoBarAtEnd] = useState(false);
  const infoScrollX = useRef(0);
  const infoContentW = useRef(0);
  const infoViewW = useRef(0);

  const handleInfoContentSizeChange = useCallback((contentW: number) => {
    infoContentW.current = contentW;
    const overflows = contentW > infoViewW.current + 1;
    setInfoBarOverflowing(overflows);
    if (!overflows) setInfoBarAtEnd(false);
    else setInfoBarAtEnd(infoScrollX.current + infoViewW.current >= contentW - 1);
  }, []);

  const handleInfoLayout = useCallback((viewW: number) => {
    infoViewW.current = viewW;
    const overflows = infoContentW.current > viewW + 1;
    setInfoBarOverflowing(overflows);
    if (!overflows) setInfoBarAtEnd(false);
    else setInfoBarAtEnd(infoScrollX.current + viewW >= infoContentW.current - 1);
  }, []);

  const handleInfoScroll = useCallback((x: number) => {
    infoScrollX.current = x;
    setInfoBarAtEnd(x + infoViewW.current >= infoContentW.current - 1);
  }, []);

  const showGradient = infoBarOverflowing && !infoBarAtEnd;

  // ── Geometry ─────────────────────────────────────────────────────────────
  const reservedBelow = 64;
  const cardTopVisual = topInset + 8;
  const buttonBlock = 56 + 16 + bottomInset + 16;
  const availableH = SCREEN_H - cardTopVisual - buttonBlock - reservedBelow;
  const maxScaleH = availableH / CARD_H;
  const maxScaleW = (SCREEN_W - 48) / CARD_W;
  const finalScale = Math.max(1.0, Math.min(1.18, maxScaleW, maxScaleH));

  const scaledH = CARD_H * finalScale;
  const finalCenterX = SCREEN_W / 2;
  const finalCenterY = cardTopVisual + scaledH / 2;
  const boxLeft = finalCenterX - CARD_W / 2;
  const boxTop = finalCenterY - CARD_H / 2;

  const originScale =
    displayOrigin?.width ? displayOrigin.width / CARD_W : 1;
  const originCenterX = displayOrigin
    ? displayOrigin.x + displayOrigin.width / 2
    : finalCenterX;
  const originCenterY = displayOrigin
    ? displayOrigin.y + displayOrigin.height / 2
    : finalCenterY;
  const startTx = originCenterX - finalCenterX;
  const startTy = originCenterY - finalCenterY;

  const detailsTop = cardTopVisual + scaledH + 14;

  // ── Animated values ───────────────────────────────────────────────────────
  const progress = useRef(new Animated.Value(0)).current;
  const swipeY = useRef(new Animated.Value(0)).current;
  const carouselX = useRef(new Animated.Value(0)).current;
  const detailsFade = useRef(new Animated.Value(1)).current;

  // ── Carousel state ────────────────────────────────────────────────────────
  const [rendered, setRendered] = useState(false);
  const closingRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const countRef = useRef(count);
  const gestureDirRef = useRef<null | "h" | "v">(null);

  countRef.current = displayArticles.length;

  // ── Derived animated styles ───────────────────────────────────────────────
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [originScale, finalScale],
  });
  const cardTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [startTx, 0],
  });
  const cardTranslateY = Animated.add(
    progress.interpolate({ inputRange: [0, 1], outputRange: [startTy, 0] }),
    swipeY,
  );
  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const progressDetailsOpacity = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 0.55, 1],
        outputRange: [0, 0, 1],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const finalDetailsOpacity = useMemo(
    () => Animated.multiply(progressDetailsOpacity, detailsFade),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Open / close lifecycle ────────────────────────────────────────────────
  const openedRef = useRef(false); // true while overlay is visible and not closing

  useEffect(() => {
    if (isOpen) {
      openedRef.current = true;
      activeIndexRef.current = initialIndex;
      carouselX.setValue(-initialIndex * SLOT_W);
      detailsFade.setValue(1);
      setActiveIndex(initialIndex);
      setRendered(true);
      closingRef.current = false;
      swipeY.setValue(0);
      progress.setValue(0);
      Animated.spring(progress, {
        toValue: 1,
        tension: 70,
        friction: 12,
        useNativeDriver: false,
      }).start();
    } else {
      openedRef.current = false;
      if (rendered && !closingRef.current) {
        setRendered(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Adjust carousel position when ancestors are prepended during loading ──
  // When a new ancestor loads and is prepended to the articles array,
  // initialIndex increases by 1. We silently shift carouselX so the user
  // stays on the same card they were viewing.
  const prevInitialIndexRef = useRef(initialIndex);
  useEffect(() => {
    const prev = prevInitialIndexRef.current;
    prevInitialIndexRef.current = initialIndex;
    if (!openedRef.current || !rendered || closingRef.current) return;
    const delta = initialIndex - prev;
    if (delta !== 0) {
      const newActive = activeIndexRef.current + delta;
      activeIndexRef.current = newActive;
      carouselX.setValue(-newActive * SLOT_W);
      setActiveIndex(newActive);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIndex]);

  // ── Close animation ───────────────────────────────────────────────────────
  const runCloseRef = useRef(() => {});
  runCloseRef.current = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    openedRef.current = false;
    const initIdx = prevInitialIndexRef.current;

    const runCloseParallel = () => {
      Animated.parallel([
        Animated.timing(progress, { toValue: 0, duration: 240, useNativeDriver: false }),
        Animated.timing(swipeY, { toValue: 0, duration: 200, useNativeDriver: false }),
      ]).start(() => {
        setRendered(false);
        closingRef.current = false;
        onClose();
      });
    };

    if (activeIndexRef.current !== initIdx) {
      Animated.timing(carouselX, {
        toValue: -initIdx * SLOT_W,
        duration: 180,
        useNativeDriver: false,
      }).start(() => {
        activeIndexRef.current = initIdx;
        runCloseParallel();
      });
    } else {
      runCloseParallel();
    }
  };
  const requestClose = useCallback(() => runCloseRef.current(), []);

  // ── Pan responder (horizontal carousel + vertical dismiss) ────────────────
  const cardPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => {
        if (countRef.current > 1 && Math.abs(g.dx) > 6 && Math.abs(g.dx) >= Math.abs(g.dy)) return true;
        if (g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx)) return true;
        return false;
      },
      onPanResponderGrant: () => { gestureDirRef.current = null; },
      onPanResponderMove: (_, g) => {
        if (!gestureDirRef.current) {
          if (countRef.current > 1 && Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 4) {
            gestureDirRef.current = "h";
            Animated.timing(detailsFade, { toValue: 0, duration: 120, useNativeDriver: false }).start();
          } else if (Math.abs(g.dy) > 4) {
            gestureDirRef.current = "v";
          }
        }
        if (gestureDirRef.current === "h") {
          const baseX = -activeIndexRef.current * SLOT_W;
          const raw = baseX + g.dx;
          const maxX = 0;
          const minX = -(countRef.current - 1) * SLOT_W;
          const rubber = raw > maxX ? maxX + (raw - maxX) * 0.3 : raw < minX ? minX + (raw - minX) * 0.3 : raw;
          carouselX.setValue(rubber);
        } else if (gestureDirRef.current === "v") {
          if (g.dy > 0) swipeY.setValue(g.dy);
        }
      },
      onPanResponderRelease: (_, g) => {
        if (gestureDirRef.current === "h") {
          const { dx, vx } = g;
          const cur = activeIndexRef.current;
          const n = countRef.current;
          let newIdx = cur;
          if (Math.abs(vx) > CAROUSEL_FLING_VX) newIdx = vx < 0 ? cur + 1 : cur - 1;
          else if (Math.abs(dx) >= CAROUSEL_SNAP_THRESHOLD) newIdx = dx < 0 ? cur + 1 : cur - 1;
          newIdx = Math.max(0, Math.min(n - 1, newIdx));
          const changed = newIdx !== activeIndexRef.current;
          activeIndexRef.current = newIdx;
          if (changed) setActiveIndex(newIdx);
          Animated.spring(carouselX, { toValue: -newIdx * SLOT_W, useNativeDriver: false, tension: 100, friction: 20, overshootClamping: true }).start();
          setTimeout(() => {
            Animated.timing(detailsFade, { toValue: 1, duration: 120, useNativeDriver: false }).start();
          }, 80);
        } else if (gestureDirRef.current === "v") {
          if (g.dy > 80 || g.vy > 0.8) runCloseRef.current();
          else Animated.spring(swipeY, { toValue: 0, useNativeDriver: false, tension: 200, friction: 20 }).start();
        } else {
          Animated.spring(swipeY, { toValue: 0, useNativeDriver: false, tension: 200, friction: 20 }).start();
        }
        gestureDirRef.current = null;
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeY, { toValue: 0, useNativeDriver: false, tension: 200, friction: 20 }).start();
        Animated.spring(carouselX, { toValue: -activeIndexRef.current * SLOT_W, useNativeDriver: false, tension: 100, friction: 20 }).start();
        Animated.timing(detailsFade, { toValue: 1, duration: 120, useNativeDriver: false }).start();
        gestureDirRef.current = null;
      },
    }),
  ).current;

  // ── Vertical-only pan for details area ───────────────────────────────────
  const detailsPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { if (g.dy > 0) swipeY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.8) runCloseRef.current();
        else Animated.spring(swipeY, { toValue: 0, useNativeDriver: false, tension: 200, friction: 20 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeY, { toValue: 0, useNativeDriver: false, tension: 200, friction: 20 }).start();
      },
    }),
  ).current;

  // ── Active card info ──────────────────────────────────────────────────────
  const activeMeta = displayMetas[activeIndex] ?? {};
  const { authorName, authorId, collectionName, collectionId, date, isNotice } = activeMeta;
  const dateLabel = date ? formatDate(date) : "";
  const canTapCollection = !!(collectionId && onNavigateToCollection);
  const canTapAuthor = !!(authorId && onNavigateToAuthor);
  const handleRead = useCallback(() => onRead(activeIndexRef.current), [onRead]);

  // ── Skeleton card (for loading slots) ────────────────────────────────────
  const SkeletonCard = () => (
    <View style={styles.skeletonCard}>
      <ActivityIndicator size="small" color={Colors.zinc300} />
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const trackW = SLOT_W * displayArticles.length;

  return (
    <Modal transparent visible={rendered} animationType="none" statusBarTranslucent onRequestClose={requestClose}>
      {/* Dark backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />
      </Animated.View>

      {/*
        Card container: CARD_W wide, overflow:visible so adjacent card edges
        peek into view on either side (side-peek effect). The zoom-from-origin
        animation anchors to the tapped card's slot.
      */}
      <Animated.View
        style={[
          styles.cardContainer,
          {
            left: boxLeft,
            top: boxTop,
            transform: [{ translateX: cardTranslateX }, { translateY: cardTranslateY }, { scale }],
          },
        ]}
        {...cardPanResponder.panHandlers}
      >
        {displayArticles.length > 1 ? (
          <Animated.View style={[styles.carouselTrack, { width: trackW, transform: [{ translateX: carouselX }] }]}>
            {displayArticles.map((art, i) => {
              const meta = displayMetas[i] ?? {};
              const slotOpacity = i === initialIndex ? 1 : progressDetailsOpacity;
              return (
                <Animated.View
                  key={art?.id ?? `loading-${i}`}
                  style={[styles.carouselSlot, i < displayArticles.length - 1 && { marginRight: OVERLAY_GAP }, { opacity: slotOpacity }]}
                >
                  {art == null ? (
                    <SkeletonCard />
                  ) : (
                    <ArticleCardItem
                      title={art.title ?? "제목 없음"}
                      authorName={meta.authorName ?? undefined}
                      collectionName={meta.collectionName ?? undefined}
                      cover={art.cover}
                      isRead={false}
                      isActive
                      onPress={handleRead}
                    />
                  )}
                </Animated.View>
              );
            })}
          </Animated.View>
        ) : displayArticles[0] == null ? (
          <SkeletonCard />
        ) : (
          <ArticleCardItem
            title={displayArticles[0].title ?? "제목 없음"}
            authorName={displayMetas[0]?.authorName ?? undefined}
            collectionName={displayMetas[0]?.collectionName ?? undefined}
            cover={displayArticles[0].cover}
            isRead={false}
            isActive
            onPress={handleRead}
          />
        )}
      </Animated.View>

      {/* Details (info bar) */}
      <Animated.View
        style={[styles.detailsContainer, { top: detailsTop, opacity: finalDetailsOpacity, transform: [{ translateY: swipeY }] }]}
        pointerEvents={rendered ? "auto" : "none"}
        {...detailsPanResponder.panHandlers}
      >
        {dateLabel ? (
          <View style={styles.infoBar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              onLayout={(e) => handleInfoLayout(e.nativeEvent.layout.width)}
              onContentSizeChange={(w) => handleInfoContentSizeChange(w)}
              onScroll={(e) => handleInfoScroll(e.nativeEvent.contentOffset.x)}
              scrollEventThrottle={16}
            >
              <View style={styles.infoRow}>
                <Text style={styles.infoText}>{dateLabel}</Text>
                {isNotice ? (
                  <Text style={[styles.infoText, styles.infoTextNotice]}> 오늘의 인사</Text>
                ) : null}
                {authorName ? (
                  <>
                    <Text style={styles.infoSep}>·</Text>
                    {canTapAuthor ? (
                      <Pressable onPress={() => { requestClose(); onNavigateToAuthor!(authorId!); }} hitSlop={6} style={styles.infoTappableRow}>
                        <Text style={styles.infoText}>{authorName}</Text>
                        <Feather name="chevron-right" size={12} color={Colors.zinc700} />
                      </Pressable>
                    ) : (
                      <Text style={styles.infoText}>{authorName}</Text>
                    )}
                  </>
                ) : null}
                {collectionName ? (
                  <>
                    <Text style={styles.infoSep}>·</Text>
                    {canTapCollection ? (
                      <Pressable onPress={() => { requestClose(); onNavigateToCollection!(collectionId!); }} hitSlop={6} style={styles.infoTappableRow}>
                        <Text style={styles.infoText}>{collectionName}</Text>
                        <Feather name="chevron-right" size={12} color={Colors.zinc700} />
                      </Pressable>
                    ) : (
                      <Text style={styles.infoText}>{collectionName}</Text>
                    )}
                  </>
                ) : null}
              </View>
            </ScrollView>
            {showGradient ? (
              <LinearGradient
                colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.92)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.infoBarGradient}
                pointerEvents="none"
              />
            ) : null}
          </View>
        ) : null}

        {displayArticles.length > 1 ? (
          <View style={styles.dotsRow}>
            {displayArticles.map((_, i) => (
              <View key={i} style={[styles.dot, i === activeIndex ? styles.dotActive : styles.dotInactive]} />
            ))}
          </View>
        ) : null}
      </Animated.View>

      {/* CTA button */}
      <Animated.View
        style={[styles.ctaWrapper, { bottom: bottomInset + 16, opacity: finalDetailsOpacity, transform: [{ translateY: swipeY }] }]}
        pointerEvents={rendered ? "auto" : "none"}
      >
        <ScalePressable style={styles.ctaButton} contentStyle={styles.ctaButtonContent} onPress={handleRead}>
          <Text style={styles.ctaLabel} numberOfLines={1}>읽기</Text>
        </ScalePressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.62)" },
  cardContainer: {
    position: "absolute",
    width: CARD_W,
    height: CARD_H,
    overflow: "visible",
  },
  carouselTrack: { flexDirection: "row", height: CARD_H },
  carouselSlot: { width: CARD_W, height: CARD_H },
  skeletonCard: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 16,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  detailsContainer: { position: "absolute", left: Spacing.screenPx, right: Spacing.screenPx },
  infoBar: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 10,
    overflow: "hidden",
  },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  infoBarGradient: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 48,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },
  infoText: { ...Typography.caption, fontSize: 13, fontWeight: "600", color: Colors.zinc700 },
  infoSep: { ...Typography.caption, fontSize: 13, fontWeight: "600", color: Colors.zinc500, marginHorizontal: 4 },
  infoTappableRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  infoTextNotice: { color: Colors.noticeAccent },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotActive: { backgroundColor: Colors.zinc700 },
  dotInactive: { backgroundColor: Colors.zinc300 },
  ctaWrapper: { position: "absolute", left: Spacing.screenPx, right: Spacing.screenPx },
  ctaButton: { width: "100%", height: 56, borderRadius: 18, backgroundColor: Colors.noticeAccent },
  ctaButtonContent: { justifyContent: "center", alignItems: "center", flex: 1 },
  ctaLabel: { ...Typography.bodySemiBold, fontSize: 17, letterSpacing: 0.5, color: Colors.white, textAlign: "center" },
});
