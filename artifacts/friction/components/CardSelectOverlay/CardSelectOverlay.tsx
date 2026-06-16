import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  PanResponder,
  ScrollView,
  Dimensions,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import ScalePressable from "@/components/shared/ScalePressable";
import { useGetArticle, getGetArticleQueryKey } from "@workspace/api-client-react";
import type { InboxItem } from "@workspace/api-client-react";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const CARD_W = Sizing.cardSlotW;
const CARD_H = Sizing.cardH;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const THREAD_CARD_W = Math.floor((SCREEN_W - Spacing.screenPx * 2 - Spacing.cardGap) / 2);
const THREAD_CARD_H = 100;
const THREAD_SNAP = THREAD_CARD_W + Spacing.cardGap;

export interface OriginLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

function formatDate(visibleAt: string | Date): string {
  const utcMs = new Date(visibleAt).getTime();
  const kstDate = new Date(utcMs + KST_OFFSET_MS);
  const month = kstDate.getUTCMonth() + 1;
  const day = kstDate.getUTCDate();
  return `${month}월 ${day}일`;
}

interface CardSelectOverlayProps {
  item: InboxItem | null;
  originLayout: OriginLayout | null;
  onClose: () => void;
  onRead: () => void;
  onReadSource: (articleId: string, inboxId?: string) => void;
  inboxData?: InboxItem[];
  onNavigateToCollection?: (collectionId: string) => void;
}

export default function CardSelectOverlay({
  item,
  originLayout,
  onClose,
  onRead,
  onReadSource,
  inboxData,
  onNavigateToCollection,
}: CardSelectOverlayProps) {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  // Freeze last real item/origin so card + geometry don't flash during the
  // exit (return-to-origin) animation, which runs after `item` becomes null.
  const frozenItem = useRef(item);
  if (item) frozenItem.current = item;
  const displayItem = frozenItem.current;

  const frozenOrigin = useRef(originLayout);
  if (originLayout) frozenOrigin.current = originLayout;
  const displayOrigin = frozenOrigin.current;

  const hasThread = !!(displayItem?.replyToArticleId);

  // ── Geometry: the SAME card zooms from its list slot into selection mode ──
  // Reserve vertical room below the card for info bar (+ thread carousel).
  const reservedBelow = hasThread ? 176 : 64;
  const cardTopVisual = topInset + (hasThread ? 16 : 28);
  const buttonBlock = 56 + 16 + bottomInset + 16;
  const availableH = SCREEN_H - cardTopVisual - buttonBlock - reservedBelow;
  const maxScaleH = availableH / CARD_H;
  const maxScaleW = (SCREEN_W - 48) / CARD_W;
  const finalScale = Math.max(1.0, Math.min(1.18, maxScaleW, maxScaleH));

  const scaledH = CARD_H * finalScale;
  const finalCenterX = SCREEN_W / 2;
  const finalCenterY = cardTopVisual + scaledH / 2;
  // Resting (scale=1 reference) box so that, after scaling around the box
  // center, the visual top lands exactly at `cardTopVisual`.
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

  // --- Animated values ---
  // `progress` drives the shared-element zoom: 0 = exactly over the list slot,
  // 1 = enlarged in selection position.
  const progress = useRef(new Animated.Value(0)).current;
  const swipeY = useRef(new Animated.Value(0)).current;

  const [rendered, setRendered] = useState(false);
  const closingRef = useRef(false);

  // Thread carousel: 0 = source, 1 = current letter
  const [threadFocus, setThreadFocus] = useState(1);
  const threadFocusRef = useRef(1);
  const threadScrollRef = useRef<ScrollView>(null);

  const sourceArticleId =
    (displayItem as { replyToArticleId?: string | null } | null)?.replyToArticleId ?? "";
  const { data: sourceArticle } = useGetArticle(sourceArticleId, {
    query: {
      queryKey: getGetArticleQueryKey(sourceArticleId),
      enabled: !!sourceArticleId,
    },
  });

  // Reset carousel to current letter whenever a new item opens
  useEffect(() => {
    if (item) {
      threadFocusRef.current = 1;
      setThreadFocus(1);
      setTimeout(() => {
        threadScrollRef.current?.scrollTo({ x: THREAD_SNAP, animated: false });
      }, 0);
    }
  }, [item?.id]);

  // Drive mount + entrance / exit
  useEffect(() => {
    if (item) {
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
      // `item` was cleared externally (e.g. read navigation) — hide at once.
      setRendered(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!item]);

  // Animate the card back to its original slot, then notify the parent.
  const runCloseRef = useRef(() => {});
  runCloseRef.current = () => {
    if (closingRef.current) return;
    closingRef.current = true;
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

  // Swipe-down to dismiss (returns the card to its slot)
  const panResponder = useRef(
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

  const handleReadPress = useCallback(() => {
    if (!displayItem) return;
    if (hasThread && threadFocusRef.current === 0 && displayItem.replyToArticleId) {
      const sourceInboxId = inboxData?.find(
        (it) => it.articleId === displayItem.replyToArticleId,
      )?.id;
      onReadSource(displayItem.replyToArticleId, sourceInboxId);
    } else {
      onRead();
    }
  }, [displayItem, hasThread, onRead, onReadSource, inboxData]);

  const handleThreadScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const idx = Math.round(e.nativeEvent.contentOffset.x / THREAD_SNAP);
      const clamped = Math.max(0, Math.min(idx, 1));
      threadFocusRef.current = clamped;
      setThreadFocus(clamped);
    },
    [],
  );

  // --- Derived animated styles ---
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
  const detailsOpacity = progress.interpolate({
    inputRange: [0, 0.55, 1],
    outputRange: [0, 0, 1],
  });

  const dateLabel = displayItem ? formatDate(displayItem.visibleAt) : "";
  const collectionName = displayItem?.collectionName ?? null;
  const sourceTeamCollectionId = displayItem?.sourceTeamCollectionId ?? null;
  const readButtonLabel = hasThread && threadFocus === 0 ? "원래 편지 읽기" : "읽기";

  return (
    <Modal
      transparent
      visible={rendered}
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      {/* ── Dark backdrop ─────────────────────────────────────────────── */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />
      </Animated.View>

      {/* ── The selected card itself, zooming from its list slot ──────── */}
      <Animated.View
        style={[
          styles.cardContainer,
          {
            left: boxLeft,
            top: boxTop,
            transform: [
              { translateX: cardTranslateX },
              { translateY: cardTranslateY },
              { scale },
            ],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <ArticleCardItem
          title={displayItem?.article?.title ?? "제목 없음"}
          authorName={displayItem?.sender?.nickname ?? displayItem?.sender?.id}
          collectionName={null}
          cover={displayItem?.article?.cover}
          isRead={displayItem?.isRead ?? false}
          isActive
          onPress={handleReadPress}
          noticeDate={
            displayItem?.article?.isNotice === true &&
            typeof displayItem?.article?.noticeDate === "string"
              ? displayItem.article.noticeDate
              : null
          }
          isReply={displayItem?.isReplyToMe === true}
        />
      </Animated.View>

      {/* ── Details (info bar + thread carousel) ──────────────────────── */}
      <Animated.View
        style={[
          styles.detailsContainer,
          {
            top: detailsTop,
            opacity: detailsOpacity,
            transform: [{ translateY: swipeY }],
          },
        ]}
        pointerEvents={rendered ? "auto" : "none"}
        {...panResponder.panHandlers}
      >
        {dateLabel ? (
          <View style={styles.infoBar}>
            <Text style={styles.infoText} numberOfLines={1}>
              {dateLabel}
            </Text>
            {collectionName ? (
              sourceTeamCollectionId && onNavigateToCollection ? (
                <Pressable
                  onPress={() => {
                    requestClose();
                    onNavigateToCollection(sourceTeamCollectionId);
                  }}
                  hitSlop={6}
                >
                  <Text style={[styles.infoText, styles.infoTextTappable]} numberOfLines={1}>
                    {collectionName}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.infoText} numberOfLines={1}>
                  {collectionName}
                </Text>
              )
            ) : null}
          </View>
        ) : null}

        {hasThread ? (
          <View style={styles.threadSection}>
            <Text style={styles.threadLabel}>편지 흐름</Text>
            <ScrollView
              ref={threadScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={THREAD_SNAP}
              snapToAlignment="start"
              decelerationRate="fast"
              scrollEventThrottle={16}
              onScroll={handleThreadScroll}
              contentContainerStyle={styles.threadTrack}
            >
              {/* Source article */}
              <View style={[styles.threadSlot, { marginRight: Spacing.cardGap }]}>
                {sourceArticle ? (
                  <ScalePressable
                    style={[
                      styles.threadCard,
                      threadFocus === 0 && styles.threadCardFocused,
                    ]}
                    onPress={() => {
                      threadFocusRef.current = 0;
                      setThreadFocus(0);
                      threadScrollRef.current?.scrollTo({ x: 0, animated: true });
                    }}
                  >
                    <View
                      style={[
                        styles.threadCardInner,
                        {
                          backgroundColor:
                            sourceArticle.cover?.type === "color" &&
                            sourceArticle.cover?.bgColor
                              ? sourceArticle.cover.bgColor
                              : Colors.zinc100,
                        },
                      ]}
                    >
                      <Text style={styles.threadCardTitle} numberOfLines={3}>
                        {sourceArticle.title}
                      </Text>
                      {displayItem?.hasReadSourceArticle === false && (
                        <View style={styles.lockOverlay} pointerEvents="none">
                          <Feather name="lock" size={18} color={Colors.zinc500} />
                        </View>
                      )}
                    </View>
                    <Text style={styles.threadCardRole} numberOfLines={1}>
                      원래 편지
                    </Text>
                  </ScalePressable>
                ) : (
                  <View style={styles.threadCard}>
                    <View style={[styles.threadCardInner, styles.threadCardPlaceholder]}>
                      <Feather name="file-text" size={22} color={Colors.zinc300} />
                    </View>
                  </View>
                )}
              </View>

              {/* Current letter */}
              <View style={styles.threadSlot}>
                <ScalePressable
                  style={[
                    styles.threadCard,
                    threadFocus === 1 && styles.threadCardFocused,
                  ]}
                  onPress={() => {
                    threadFocusRef.current = 1;
                    setThreadFocus(1);
                    threadScrollRef.current?.scrollTo({
                      x: THREAD_SNAP,
                      animated: true,
                    });
                  }}
                >
                  <View
                    style={[
                      styles.threadCardInner,
                      {
                        backgroundColor:
                          displayItem?.article?.cover?.type === "color" &&
                          displayItem?.article?.cover?.bgColor
                            ? displayItem.article.cover.bgColor
                            : Colors.zinc50,
                      },
                    ]}
                  >
                    <Text style={styles.threadCardTitle} numberOfLines={3}>
                      {displayItem?.article?.title ?? "제목 없음"}
                    </Text>
                  </View>
                  <Text style={styles.threadCardRole} numberOfLines={1}>
                    이 편지
                  </Text>
                </ScalePressable>
              </View>
            </ScrollView>
          </View>
        ) : null}
      </Animated.View>

      {/* ── CTA button (fixed at safe-area bottom, tracks swipe) ──────── */}
      <Animated.View
        style={[
          styles.ctaWrapper,
          {
            bottom: bottomInset + 16,
            opacity: detailsOpacity,
            transform: [{ translateY: swipeY }],
          },
        ]}
        pointerEvents={rendered ? "auto" : "none"}
      >
        <ScalePressable
          style={styles.ctaButton}
          contentStyle={styles.ctaButtonContent}
          onPress={handleReadPress}
        >
          <Text style={styles.ctaLabel} numberOfLines={1}>
            {readButtonLabel}
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
    gap: 2,
  },
  infoText: {
    ...Typography.caption,
    fontSize: 13,
    fontWeight: "600",
    color: Colors.zinc500,
    textAlign: "left",
  },
  infoTextTappable: {
    color: Colors.zinc700,
    textDecorationLine: "underline",
  },
  threadSection: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 12,
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 14,
  },
  threadLabel: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
    marginBottom: 10,
  },
  threadTrack: {
    flexDirection: "row",
  },
  threadSlot: {
    width: THREAD_CARD_W,
  },
  threadCard: {
    width: THREAD_CARD_W,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: Colors.transparent,
  },
  threadCardFocused: {
    borderColor: Colors.noticeAccent,
  },
  threadCardInner: {
    width: THREAD_CARD_W,
    height: THREAD_CARD_H,
    justifyContent: "center",
    alignItems: "center",
    padding: 10,
  },
  threadCardPlaceholder: {
    backgroundColor: Colors.zinc100,
  },
  threadCardTitle: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc700,
    textAlign: "center",
    lineHeight: 16,
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  threadCardRole: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
    textAlign: "center",
    marginTop: 6,
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
