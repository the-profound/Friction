import React, { useEffect, useRef, useState, useCallback } from "react";
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
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import ScalePressable from "@/components/shared/ScalePressable";
import type { Article } from "@workspace/api-client-react";
import type { OriginLayout } from "@/components/CardSelectOverlay/CardSelectOverlay";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const CARD_W = Sizing.cardSlotW;
const CARD_H = Sizing.cardH;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function formatDate(updatedAt: string | Date): string {
  const utcMs = new Date(updatedAt).getTime();
  const kstDate = new Date(utcMs + KST_OFFSET_MS);
  const month = kstDate.getUTCMonth() + 1;
  const day = kstDate.getUTCDate();
  return `${month}월 ${day}일`;
}

interface MyLetterSelectOverlayProps {
  article: Article | null;
  originLayout: OriginLayout | null;
  onClose: () => void;
  onRead: () => void;
  authorName?: string | null;
  collectionName?: string | null;
}

export default function MyLetterSelectOverlay({
  article,
  originLayout,
  onClose,
  onRead,
  authorName,
  collectionName,
}: MyLetterSelectOverlayProps) {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const frozenArticle = useRef(article);
  if (article) frozenArticle.current = article;
  const displayArticle = frozenArticle.current;

  const frozenOrigin = useRef(originLayout);
  if (originLayout) frozenOrigin.current = originLayout;
  const displayOrigin = frozenOrigin.current;

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

  const progress = useRef(new Animated.Value(0)).current;
  const swipeY = useRef(new Animated.Value(0)).current;

  const [rendered, setRendered] = useState(false);
  const closingRef = useRef(false);

  useEffect(() => {
    if (article) {
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
  }, [!!article]);

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
    onRead();
  }, [onRead]);

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

  const dateLabel = displayArticle ? formatDate(displayArticle.updatedAt) : "";

  return (
    <Modal
      transparent
      visible={rendered}
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />
      </Animated.View>

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
          title={displayArticle?.title ?? "제목 없음"}
          authorName={authorName ?? displayArticle?.authorNickname ?? undefined}
          collectionName={collectionName}
          cover={displayArticle?.cover}
          isActive
          onPress={handleReadPress}
        />
      </Animated.View>

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
            <View style={styles.infoRow}>
              <Text style={styles.infoText} numberOfLines={1}>
                {dateLabel}
              </Text>
              {(authorName ?? displayArticle?.authorNickname) ? (
                <>
                  <Text style={styles.infoSep}>·</Text>
                  <Text style={styles.infoText} numberOfLines={1}>
                    {authorName ?? displayArticle?.authorNickname}
                  </Text>
                </>
              ) : null}
              {collectionName ? (
                <>
                  <Text style={styles.infoSep}>·</Text>
                  <Text style={styles.infoText} numberOfLines={1}>
                    {collectionName}
                  </Text>
                </>
              ) : null}
            </View>
          </View>
        ) : null}
      </Animated.View>

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
