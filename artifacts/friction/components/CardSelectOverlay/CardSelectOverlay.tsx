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
} from "react-native";
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
const CAROUSEL_SNAP_THRESHOLD = CARD_W * 0.28;
const CAROUSEL_FLING_VX = 0.45;

export interface OriginLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AdjacentMeta {
  authorName?: string | null;
  collectionName?: string | null;
  collectionId?: string | null;
  date?: string | Date | null;
  isNotice?: boolean;
}

function formatDate(visibleAt: string | Date): string {
  const utcMs = new Date(visibleAt).getTime();
  const kstDate = new Date(utcMs + KST_OFFSET_MS);
  const month = kstDate.getUTCMonth() + 1;
  const day = kstDate.getUTCDate();
  return `${month}월 ${day}일`;
}

interface CardSelectOverlayProps {
  article: Article | null;
  authorName?: string | null;
  collectionName?: string | null;
  collectionId?: string | null;
  date?: string | Date | null;
  isNotice?: boolean;
  onNavigateToCollection?: (id: string) => void;
  originLayout: OriginLayout | null;
  onClose: () => void;
  onRead: () => void;
  adjacentArticle?: Article | null;
  adjacentMeta?: AdjacentMeta;
  adjacentPosition?: "left" | "right";
  onReadAdjacent?: () => void;
}

export default function CardSelectOverlay({
  article,
  authorName,
  collectionName,
  collectionId,
  date,
  isNotice,
  onNavigateToCollection,
  originLayout,
  onClose,
  onRead,
  adjacentArticle,
  adjacentMeta,
  adjacentPosition,
  onReadAdjacent,
}: CardSelectOverlayProps) {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const isOpen = !!article;
  const hasAdjacent = !!adjacentArticle;

  // mainCardIndex: which slot in the 2-card track holds the tapped (main) card
  // adjacentPosition='left'  → adjacent is slot 0, main is slot 1
  // adjacentPosition='right' → main is slot 0, adjacent is slot 1
  const mainCardIndex = adjacentPosition === "left" ? 1 : 0;
  const adjacentCardIndex = adjacentPosition === "left" ? 0 : 1;

  // ── Frozen refs (keep last non-null values for close animation) ──────────
  const frozenArticle = useRef(article ?? null);
  if (article) frozenArticle.current = article;
  const displayArticle = frozenArticle.current;

  const frozenOrigin = useRef(originLayout);
  if (originLayout) frozenOrigin.current = originLayout;
  const displayOrigin = frozenOrigin.current;

  const frozenAdjacent = useRef(adjacentArticle ?? null);
  if (adjacentArticle) frozenAdjacent.current = adjacentArticle;
  const displayAdjacent = frozenAdjacent.current;

  const frozenAdjacentMeta = useRef<AdjacentMeta | undefined>(adjacentMeta);
  if (adjacentMeta) frozenAdjacentMeta.current = adjacentMeta;
  const displayAdjacentMeta = frozenAdjacentMeta.current;

  // ── Geometry ─────────────────────────────────────────────────────────────
  const reservedBelow = 64;
  const cardTopVisual = topInset + 28;
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
    displayOrigin && displayOrigin.width ? displayOrigin.width / CARD_W : 1;
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
  const [activeCardIsMain, setActiveCardIsMain] = useState(true);
  const carouselIndexRef = useRef(mainCardIndex);
  const mainCardIndexRef = useRef(mainCardIndex);
  const hasAdjacentRef = useRef(hasAdjacent);
  const gestureDirRef = useRef<null | "h" | "v">(null);

  // Keep refs up to date each render
  mainCardIndexRef.current = mainCardIndex;
  hasAdjacentRef.current = hasAdjacent;

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

  // ── Mount / entrance / exit ───────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      const initIdx = adjacentPosition === "left" ? 1 : 0;
      carouselIndexRef.current = initIdx;
      carouselX.setValue(-initIdx * CARD_W);
      detailsFade.setValue(1);
      setActiveCardIsMain(true);
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
    } else if (rendered && !closingRef.current) {
      setRendered(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, adjacentPosition]);

  // ── Close animation ───────────────────────────────────────────────────────
  const runCloseRef = useRef(() => {});
  runCloseRef.current = () => {
    if (closingRef.current) return;
    closingRef.current = true;

    // If carousel is on adjacent card, snap back to main instantly before closing
    if (hasAdjacentRef.current && carouselIndexRef.current !== mainCardIndexRef.current) {
      carouselX.setValue(-mainCardIndexRef.current * CARD_W);
      carouselIndexRef.current = mainCardIndexRef.current;
    }

    Animated.parallel([
      Animated.timing(progress, {
        toValue: 0,
        duration: 240,
        useNativeDriver: false,
      }),
      Animated.timing(swipeY, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start(() => {
      setRendered(false);
      closingRef.current = false;
      onClose();
    });
  };
  const requestClose = useCallback(() => runCloseRef.current(), []);

  // ── Combined pan responder (card area: horizontal carousel + vertical dismiss) ──
  const cardPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => {
        if (
          hasAdjacentRef.current &&
          Math.abs(g.dx) > 6 &&
          Math.abs(g.dx) >= Math.abs(g.dy)
        ) {
          return true;
        }
        if (g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx)) {
          return true;
        }
        return false;
      },
      onPanResponderGrant: () => {
        gestureDirRef.current = null;
      },
      onPanResponderMove: (_, g) => {
        if (!gestureDirRef.current) {
          if (
            hasAdjacentRef.current &&
            Math.abs(g.dx) > Math.abs(g.dy) &&
            Math.abs(g.dx) > 4
          ) {
            gestureDirRef.current = "h";
            Animated.timing(detailsFade, {
              toValue: 0,
              duration: 120,
              useNativeDriver: false,
            }).start();
          } else if (Math.abs(g.dy) > 4) {
            gestureDirRef.current = "v";
          }
        }

        if (gestureDirRef.current === "h") {
          const baseX = -carouselIndexRef.current * CARD_W;
          const raw = baseX + g.dx;
          const maxX = 0;
          const minX = -CARD_W;
          const rubber =
            raw > maxX
              ? maxX + (raw - maxX) * 0.3
              : raw < minX
                ? minX + (raw - minX) * 0.3
                : raw;
          carouselX.setValue(rubber);
        } else if (gestureDirRef.current === "v") {
          if (g.dy > 0) swipeY.setValue(g.dy);
        }
      },
      onPanResponderRelease: (_, g) => {
        if (gestureDirRef.current === "h") {
          const { dx, vx } = g;
          let newIdx = carouselIndexRef.current;
          if (Math.abs(vx) > CAROUSEL_FLING_VX) {
            newIdx = vx < 0 ? 1 : 0;
          } else if (Math.abs(dx) >= CAROUSEL_SNAP_THRESHOLD) {
            newIdx = dx < 0 ? 1 : 0;
          }
          newIdx = Math.max(0, Math.min(1, newIdx));
          const changed = newIdx !== carouselIndexRef.current;
          carouselIndexRef.current = newIdx;

          Animated.spring(carouselX, {
            toValue: -newIdx * CARD_W,
            useNativeDriver: false,
            tension: 100,
            friction: 20,
            overshootClamping: true,
          }).start(() => {
            if (changed) {
              setActiveCardIsMain(newIdx === mainCardIndexRef.current);
            }
            Animated.timing(detailsFade, {
              toValue: 1,
              duration: 150,
              useNativeDriver: false,
            }).start();
          });
        } else if (gestureDirRef.current === "v") {
          if (g.dy > 80 || g.vy > 0.8) {
            runCloseRef.current();
          } else {
            Animated.spring(swipeY, {
              toValue: 0,
              useNativeDriver: false,
              tension: 200,
              friction: 20,
            }).start();
          }
        } else {
          Animated.spring(swipeY, {
            toValue: 0,
            useNativeDriver: false,
            tension: 200,
            friction: 20,
          }).start();
        }
        gestureDirRef.current = null;
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeY, {
          toValue: 0,
          useNativeDriver: false,
          tension: 200,
          friction: 20,
        }).start();
        Animated.spring(carouselX, {
          toValue: -carouselIndexRef.current * CARD_W,
          useNativeDriver: false,
          tension: 100,
          friction: 20,
        }).start();
        Animated.timing(detailsFade, {
          toValue: 1,
          duration: 150,
          useNativeDriver: false,
        }).start();
        gestureDirRef.current = null;
      },
    }),
  ).current;

  // ── Vertical-only pan responder for details / CTA (dismiss only) ──────────
  const detailsPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) swipeY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.8) {
          runCloseRef.current();
        } else {
          Animated.spring(swipeY, {
            toValue: 0,
            useNativeDriver: false,
            tension: 200,
            friction: 20,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeY, {
          toValue: 0,
          useNativeDriver: false,
          tension: 200,
          friction: 20,
        }).start();
      },
    }),
  ).current;

  // ── Active card info (switches on carousel snap) ──────────────────────────
  const activeAuthorName = activeCardIsMain
    ? authorName
    : displayAdjacentMeta?.authorName;
  const activeCollectionName = activeCardIsMain
    ? collectionName
    : displayAdjacentMeta?.collectionName;
  const activeCollectionId = activeCardIsMain
    ? collectionId
    : displayAdjacentMeta?.collectionId;
  const activeDate = activeCardIsMain ? date : displayAdjacentMeta?.date;
  const activeIsNotice = activeCardIsMain
    ? isNotice
    : displayAdjacentMeta?.isNotice;

  const dateLabel = activeDate ? formatDate(activeDate) : "";
  const canTapCollection = !!(activeCollectionId && onNavigateToCollection);

  const handleRead = activeCardIsMain ? onRead : (onReadAdjacent ?? onRead);

  // ── Build carousel cards ──────────────────────────────────────────────────
  // Slot 0 is the LEFT card, slot 1 is the RIGHT card.
  const card0Article = adjacentCardIndex === 0 ? displayAdjacent : displayArticle;
  const card0Author = adjacentCardIndex === 0
    ? displayAdjacentMeta?.authorName
    : authorName;
  const card0Collection = adjacentCardIndex === 0
    ? displayAdjacentMeta?.collectionName
    : collectionName;

  const card1Article = adjacentCardIndex === 1 ? displayAdjacent : displayArticle;
  const card1Author = adjacentCardIndex === 1
    ? displayAdjacentMeta?.authorName
    : authorName;
  const card1Collection = adjacentCardIndex === 1
    ? displayAdjacentMeta?.collectionName
    : collectionName;

  return (
    <Modal
      transparent
      visible={rendered}
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      {/* ── Dark backdrop ──────────────────────────────────────────────── */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />
      </Animated.View>

      {/* ── Card container (zooms from list slot, hosts carousel track) ── */}
      <Animated.View
        style={[
          styles.cardContainer,
          {
            left: boxLeft,
            top: boxTop,
            overflow: "hidden",
            transform: [
              { translateX: cardTranslateX },
              { translateY: cardTranslateY },
              { scale },
            ],
          },
        ]}
        {...cardPanResponder.panHandlers}
      >
        {hasAdjacent ? (
          <Animated.View
            style={[
              styles.carouselTrack,
              { transform: [{ translateX: carouselX }] },
            ]}
          >
            {/* Slot 0 */}
            <View style={styles.carouselSlot}>
              <ArticleCardItem
                title={card0Article?.title ?? "제목 없음"}
                authorName={card0Author ?? undefined}
                collectionName={card0Collection ?? undefined}
                cover={card0Article?.cover}
                isRead={false}
                isActive
                onPress={handleRead}
              />
            </View>
            {/* Slot 1 */}
            <View style={styles.carouselSlot}>
              <ArticleCardItem
                title={card1Article?.title ?? "제목 없음"}
                authorName={card1Author ?? undefined}
                collectionName={card1Collection ?? undefined}
                cover={card1Article?.cover}
                isRead={false}
                isActive
                onPress={handleRead}
              />
            </View>
          </Animated.View>
        ) : (
          <ArticleCardItem
            title={displayArticle?.title ?? "제목 없음"}
            authorName={authorName ?? undefined}
            collectionName={collectionName ?? undefined}
            cover={displayArticle?.cover}
            isRead={false}
            isActive
            onPress={onRead}
          />
        )}
      </Animated.View>

      {/* ── Details (info bar) ─────────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.detailsContainer,
          {
            top: detailsTop,
            opacity: finalDetailsOpacity,
            transform: [{ translateY: swipeY }],
          },
        ]}
        pointerEvents={rendered ? "auto" : "none"}
        {...detailsPanResponder.panHandlers}
      >
        {dateLabel ? (
          <View style={styles.infoBar}>
            <View style={styles.infoRow}>
              <Text style={styles.infoText} numberOfLines={1}>
                {dateLabel}
              </Text>
              {activeAuthorName ? (
                <>
                  <Text style={styles.infoSep}>·</Text>
                  <Text style={styles.infoText} numberOfLines={1}>
                    {activeAuthorName}
                  </Text>
                </>
              ) : null}
              {activeCollectionName ? (
                <>
                  <Text style={styles.infoSep}>·</Text>
                  {canTapCollection ? (
                    <Pressable
                      onPress={() => {
                        requestClose();
                        onNavigateToCollection!(activeCollectionId!);
                      }}
                      hitSlop={6}
                      style={styles.infoTappableRow}
                    >
                      <Text
                        style={[styles.infoText, styles.infoTextTappable]}
                        numberOfLines={1}
                      >
                        {activeCollectionName}
                      </Text>
                      <Feather
                        name="chevron-right"
                        size={12}
                        color={Colors.zinc500}
                      />
                    </Pressable>
                  ) : (
                    <Text style={styles.infoText} numberOfLines={1}>
                      {activeCollectionName}
                    </Text>
                  )}
                </>
              ) : null}
              {activeIsNotice ? (
                <>
                  <Text style={styles.infoSep}>·</Text>
                  <Text
                    style={[styles.infoText, styles.infoTextNotice]}
                    numberOfLines={1}
                  >
                    오늘의 인사
                  </Text>
                </>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Dot indicator for carousel */}
        {hasAdjacent ? (
          <View style={styles.dotsRow}>
            {[0, 1].map((slot) => {
              const activeSlot = activeCardIsMain ? mainCardIndex : adjacentCardIndex;
              return (
                <View
                  key={slot}
                  style={[
                    styles.dot,
                    slot === activeSlot ? styles.dotActive : styles.dotInactive,
                  ]}
                />
              );
            })}
          </View>
        ) : null}
      </Animated.View>

      {/* ── CTA button (fixed at safe-area bottom, tracks swipe) ──────── */}
      <Animated.View
        style={[
          styles.ctaWrapper,
          {
            bottom: bottomInset + 16,
            opacity: finalDetailsOpacity,
            transform: [{ translateY: swipeY }],
          },
        ]}
        pointerEvents={rendered ? "auto" : "none"}
      >
        <ScalePressable
          style={styles.ctaButton}
          contentStyle={styles.ctaButtonContent}
          onPress={handleRead}
        >
          <Text style={styles.ctaLabel} numberOfLines={1}>
            읽기
          </Text>
        </ScalePressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  cardContainer: {
    position: "absolute",
    width: CARD_W,
    height: CARD_H,
  },
  carouselTrack: {
    flexDirection: "row",
    width: CARD_W * 2,
    height: CARD_H,
  },
  carouselSlot: {
    width: CARD_W,
    height: CARD_H,
  },
  detailsContainer: {
    position: "absolute",
    left: Spacing.screenPx,
    right: Spacing.screenPx,
  },
  infoBar: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
  },
  infoText: {
    ...Typography.caption,
    fontSize: 13,
    fontWeight: "600",
    color: Colors.zinc500,
    textAlign: "left",
  },
  infoSep: {
    ...Typography.caption,
    fontSize: 13,
    fontWeight: "600",
    color: Colors.zinc400,
  },
  infoTextTappable: {
    color: Colors.zinc700,
  },
  infoTappableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  infoTextNotice: {
    color: Colors.noticeAccent,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginBottom: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    backgroundColor: Colors.zinc700,
  },
  dotInactive: {
    backgroundColor: Colors.zinc300,
  },
  ctaWrapper: {
    position: "absolute",
    left: Spacing.screenPx,
    right: Spacing.screenPx,
  },
  ctaButton: {
    width: "100%",
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.noticeAccent,
  },
  ctaButtonContent: {
    justifyContent: "center",
    alignItems: "center",
    flex: 1,
  },
  ctaLabel: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    letterSpacing: 0.5,
    color: Colors.white,
    textAlign: "center",
  },
});
