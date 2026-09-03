import React, { useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ScalePressable from "@/components/shared/ScalePressable";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import CanonicalCardSlot from "@/components/ArticleCardItem/CanonicalCardSlot";
import { useLetterSelectionOverlay } from "@/hooks/useLetterSelectionOverlay";
import { Colors, Spacing, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useUser } from "@/contexts/UserContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  useListArticles,
  SpaceLetterVisibility,
  type Article,
} from "@workspace/api-client-react";

const GRID_COLS = 3;
const GRID_PAD = Spacing.screenPx;
const GRID_GAP = 4;

type Row = Article[];

export default function RecipientOnlyLettersScreen() {
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId } = useUser();
  const { isLoading: authIsLoading } = useAuth();
  const { width: windowWidth } = useWindowDimensions();

  const cellWidth =
    (windowWidth - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const cellHeight = cellWidth * Sizing.cardRatio;

  const articlesQuery = useListArticles(
    { authorId: userId },
    { query: { enabled: !authIsLoading } },
  );

  const {
    isSourceHidden,
    openLetterOverlay,
    renderLetterOverlay,
    spaceLetterByArticleId,
  } = useLetterSelectionOverlay(userId);

  // Re-fetch on focus so visibility changes made elsewhere are reflected immediately.
  const refetchArticles = articlesQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      refetchArticles();
    }, [refetchArticles]),
  );

  // Only RECIPIENT_ONLY letters (must be in spaceLetterByArticleId map to confirm status).
  const recipientOnlyLetters = useMemo<Article[]>(() => {
    return ((articlesQuery.data ?? []) as Article[]).filter((a) => {
      if (a.status !== "LETTER") return false;
      const sl = spaceLetterByArticleId.get(a.id);
      return sl?.visibility === SpaceLetterVisibility.RECIPIENT_ONLY;
    });
  }, [articlesQuery.data, spaceLetterByArticleId]);

  // Chunk into rows of GRID_COLS so we can use a simple FlatList without numColumns.
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    for (let i = 0; i < recipientOnlyLetters.length; i += GRID_COLS) {
      result.push(recipientOnlyLetters.slice(i, i + GRID_COLS));
    }
    return result;
  }, [recipientOnlyLetters]);

  // Ref map for overlay origin measurement per article.
  const cardSlotRefs = useRef<Map<string, View | null>>(new Map());

  const handleLetterPress = useCallback(
    (article: Article) => {
      const slotRef = cardSlotRefs.current.get(article.id);
      openLetterOverlay(article, {
        measureRef: slotRef
          ? (slotRef as unknown as { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void })
          : null,
        fallbackOrigin: { x: 0, y: 0, width: cellWidth, height: cellHeight },
      });
    },
    [openLetterOverlay, cellWidth, cellHeight],
  );

  const renderRow = useCallback(
    ({ item: rowItems }: { item: Row }) => (
      <View style={styles.gridRow}>
        {rowItems.map((article) => {
          const hidden = isSourceHidden(article.id);
          return (
            <View
              key={article.id}
              ref={(ref) => {
                cardSlotRefs.current.set(article.id, ref);
              }}
              style={[
                styles.gridCell,
                { width: cellWidth, opacity: hidden ? 0 : 1 },
              ]}
            >
              <CanonicalCardSlot width={cellWidth} height={cellHeight}>
                <ArticleCardItem
                  title={article.title || "제목 없음"}
                  authorName={article.authorNickname ?? undefined}
                  collectionName={null}
                  cover={article.cover}
                  visibility="RECIPIENT_ONLY"
                  isActive
                  onPress={() => handleLetterPress(article)}
                />
              </CanonicalCardSlot>
            </View>
          );
        })}
        {/* Filler cells to keep the last row left-aligned */}
        {Array.from({ length: GRID_COLS - rowItems.length }).map((_, i) => (
          <View key={`fill-${i}`} style={{ width: cellWidth }} />
        ))}
      </View>
    ),
    [isSourceHidden, cellWidth, cellHeight, handleLetterPress],
  );

  const isLoading =
    authIsLoading || (articlesQuery.isLoading && !articlesQuery.data);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <Text style={styles.headerTitle}>수신자 공개 편지</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(_, i) => `row-${i}`}
        renderItem={renderRow}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>불러오는 중...</Text>
            </View>
          ) : articlesQuery.isError ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>편지를 불러오지 못했어요</Text>
              <ScalePressable
                style={styles.retryButton}
                contentStyle={styles.retryButtonContent}
                onPress={() => articlesQuery.refetch()}
                accessibilityRole="button"
                accessibilityLabel="다시 시도"
              >
                <Text style={styles.retryButtonText}>다시 시도</Text>
              </ScalePressable>
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Feather name="eye-off" size={40} color={Colors.zinc300} />
              <Text style={styles.emptyTitle}>
                수신자 공개 처리한 편지가 없어요
              </Text>
              <Text style={styles.emptyText}>
                공간에서 보낸 편지를 수신자 공개로 설정하면{"\n"}여기에 표시됩니다.
              </Text>
            </View>
          )
        }
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: navBottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      />

      {renderLetterOverlay()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.zinc900,
    letterSpacing: -0.3,
  },
  headerSpacer: {
    width: 20,
  },
  listContent: {
    paddingHorizontal: GRID_PAD,
    paddingTop: 8,
    flexGrow: 1,
  },
  gridRow: {
    flexDirection: "row",
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  gridCell: {
    overflow: "hidden",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.zinc600,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 13,
    color: Colors.zinc400,
    textAlign: "center",
    lineHeight: 18,
  },
  retryButton: {
    marginTop: 4,
    height: 36,
    borderRadius: 10,
  },
  retryButtonContent: {
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 20,
  },
  retryButtonText: {
    fontSize: 14,
    color: Colors.zinc600,
    letterSpacing: -0.2,
  },
});
