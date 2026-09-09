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
import HeaderButton from "@/components/shared/HeaderButton";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import CanonicalCardSlot from "@/components/ArticleCardItem/CanonicalCardSlot";
import { useLetterSelectionOverlay } from "@/hooks/useLetterSelectionOverlay";
import { profileArticleToViewModel } from "@/hooks/useProfileLetterCards";
import { Colors, Spacing, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useUser } from "@/contexts/UserContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  useListArticles,
  useListSendRecords,
  getListArticlesQueryKey,
  getListSendRecordsQueryKey,
  SpaceLetterVisibility,
  type Article,
  type SendRecordWithDetails,
} from "@workspace/api-client-react";
import {
  buildSentLetterSourceMetadataByArticleId,
  isSpaceSendRecord,
} from "@/lib/sentLetterVisibility";

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
    {
      query: {
        queryKey: getListArticlesQueryKey({ authorId: userId }),
        enabled: !authIsLoading,
      },
    },
  );
  const sendRecordsQuery = useListSendRecords(
    { senderId: userId ?? "" },
    {
      query: {
        queryKey: getListSendRecordsQueryKey({ senderId: userId ?? "" }),
        enabled: !authIsLoading,
      },
    },
  );

  const {
    isSourceHidden,
    openLetterOverlay,
    renderLetterOverlay,
    spaceLetterByArticleId,
  } = useLetterSelectionOverlay(userId);

  // Re-fetch on focus so visibility changes made elsewhere are reflected immediately.
  const refetchArticles = articlesQuery.refetch;
  const refetchSendRecords = sendRecordsQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      refetchArticles();
      refetchSendRecords();
    }, [refetchArticles, refetchSendRecords]),
  );

  // Source-name lookup shared with 편지 tab / 프로필 — resolves the label
  // (space name or personal collection name) for each sent article.
  const sendRecordByArticleId = useMemo(
    () =>
      buildSentLetterSourceMetadataByArticleId(
        (sendRecordsQuery.data ?? []) as SendRecordWithDetails[],
      ),
    [sendRecordsQuery.data],
  );

  // Personal/reply sends never have a space_letter row and are always
  // recipient-only (there is no visibility toggle for them).
  const personalSentArticleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const record of (sendRecordsQuery.data ?? []) as SendRecordWithDetails[]) {
      if (!isSpaceSendRecord(record)) ids.add(record.articleId);
    }
    return ids;
  }, [sendRecordsQuery.data]);

  // Every letter that only the recipient(s) can read: space-sent letters
  // explicitly set to RECIPIENT_ONLY, plus personal/reply sends. A letter
  // that is PUBLIC through any other route (e.g. a public space) is excluded
  // — "PUBLIC wins" is preserved via spaceLetterByArticleId.
  const recipientOnlyLetters = useMemo<Article[]>(() => {
    return ((articlesQuery.data ?? []) as Article[]).filter((a) => {
      if (a.status !== "LETTER") return false;
      const sl = spaceLetterByArticleId.get(a.id);
      if (sl?.visibility === SpaceLetterVisibility.PUBLIC) return false;
      const isSpaceRecipientOnly =
        sl?.visibility === SpaceLetterVisibility.RECIPIENT_ONLY;
      return isSpaceRecipientOnly || personalSentArticleIds.has(a.id);
    });
  }, [articlesQuery.data, spaceLetterByArticleId, personalSentArticleIds]);

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
      const rec = sendRecordByArticleId[article.id];
      const slotRef = cardSlotRefs.current.get(article.id);
      openLetterOverlay(article, {
        meta: {
          collectionName: rec?.name ?? null,
          collectionId: rec?.collectionId ?? null,
          spaceId: rec?.spaceId ?? null,
          date: rec?.deliverySlot ?? null,
        },
        measureRef: slotRef
          ? (slotRef as unknown as { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void })
          : null,
        fallbackOrigin: { x: 0, y: 0, width: cellWidth, height: cellHeight },
        currentAuthorId: userId,
      });
    },
    [openLetterOverlay, cellWidth, cellHeight, sendRecordByArticleId, userId],
  );

  const renderRow = useCallback(
    ({ item: rowItems }: { item: Row }) => (
      <View style={styles.gridRow}>
        {rowItems.map((article) => {
          const hidden = isSourceHidden(article.id);
          // ViewModel extracts spaceName when the API embeds it on the article.
          const vm = profileArticleToViewModel(article);
          // Send-record name takes priority so personal sends show their
          // collection label instead of an empty collectionName.
          const collectionName = sendRecordByArticleId[article.id]?.name ?? vm.collectionName;
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
                  title={vm.article?.title ?? "제목 없음"}
                  authorName={vm.authorName ?? undefined}
                  collectionName={collectionName}
                  spaceName={vm.spaceName}
                  cover={vm.cover ?? undefined}
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
    [isSourceHidden, cellWidth, cellHeight, handleLetterPress, sendRecordByArticleId],
  );

  const isLoading =
    authIsLoading || (articlesQuery.isLoading && !articlesQuery.data);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <HeaderButton
          variant="back"
          onPress={() => router.back()}
          accessibilityLabel="수신자만 볼 수 있는 편지에서 돌아가기"
        />
        <Text style={styles.headerTitle}>수신자만 볼 수 있는 편지</Text>
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
                수신자만 볼 수 있는 편지가 없어요
              </Text>
              <Text style={styles.emptyText}>
                개인에게 보낸 편지와, 공간에서 수신자 공개로{"\n"}설정한 편지가 여기에 모여요.
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
    width: 44,
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
