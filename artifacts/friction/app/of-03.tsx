import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Alert, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import {
  useListStoredSentences,
  useDeleteStoredSentence,
  useToggleStoredSentenceFavorite,
} from "@workspace/api-client-react";
import type { StoredSentence } from "@workspace/api-client-react";

type FilterMode = "all" | "favorites";

export default function SentenceCollectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();
  const [filter, setFilter] = useState<FilterMode>("all");

  const sentencesQuery = useListStoredSentences({
    userId,
    ...(filter === "favorites" ? { favorite: true } : {}),
  });
  const sentences = (sentencesQuery.data ?? []) as StoredSentence[];
  const deleteSentence = useDeleteStoredSentence();
  const toggleFavorite = useToggleStoredSentenceFavorite();

  const handleToggleFavorite = useCallback(
    async (id: string, currentFav: boolean) => {
      try {
        await toggleFavorite.mutateAsync({
          id,
          data: { isFavorite: !currentFav },
        });
        sentencesQuery.refetch();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "즐겨찾기 변경에 실패했습니다.";
        Alert.alert("오류", msg);
      }
    },
    [toggleFavorite, sentencesQuery],
  );

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert("문장 삭제", "이 문장을 삭제하시겠어요?", [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteSentence.mutateAsync({ id });
              sentencesQuery.refetch();
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
              Alert.alert("오류", msg);
            }
          },
        },
      ]);
    },
    [deleteSentence, sentencesQuery],
  );

  const renderItem = ({ item }: { item: StoredSentence }) => (
    <Pressable
      style={styles.sentenceItem}
      onLongPress={() => handleDelete(item.id)}
    >
      <View style={styles.sentenceContent}>
        <Text style={styles.sentenceText}>
          &ldquo;{item.text}&rdquo;
        </Text>
        <View style={styles.sentenceMeta}>
          <Text style={styles.sentenceDate}>
            {new Date(item.createdAt).toLocaleDateString("ko-KR")}
          </Text>
          {item.position && typeof item.position === "object" && "page" in item.position && (
            <Text style={styles.sentencePage}>
              {(item.position as { page: number }).page + 1}페이지
            </Text>
          )}
        </View>
      </View>
      <Pressable
        style={styles.favoriteButton}
        onPress={() => handleToggleFavorite(item.id, item.isFavorite)}
        hitSlop={8}
      >
        <Feather
          name={item.isFavorite ? "star" : "star"}
          size={18}
          color={item.isFavorite ? "#F59E0B" : Colors.zinc300}
        />
      </Pressable>
    </Pressable>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>문장 모음</Text>
        <View style={{ width: 20 }} />
      </View>

      <View style={styles.filterBar}>
        <Pressable
          style={[styles.filterChip, filter === "all" && styles.filterChipActive]}
          onPress={() => setFilter("all")}
        >
          <Text style={[styles.filterChipText, filter === "all" && styles.filterChipTextActive]}>
            전체 ({sentences.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.filterChip, filter === "favorites" && styles.filterChipActive]}
          onPress={() => setFilter("favorites")}
        >
          <Feather
            name="star"
            size={12}
            color={filter === "favorites" ? Colors.white : Colors.zinc500}
          />
          <Text
            style={[styles.filterChipText, filter === "favorites" && styles.filterChipTextActive]}
          >
            즐겨찾기
          </Text>
        </Pressable>
      </View>

      {sentencesQuery.isLoading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      ) : sentencesQuery.isError ? (
        <View style={styles.emptyContainer}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기에 실패했어요</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => sentencesQuery.refetch()}
          >
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : sentences.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Feather name="bookmark" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>
            {filter === "favorites" ? "즐겨찾기한 문장이 없어요" : "수집한 문장이 없어요"}
          </Text>
          <Text style={styles.emptySubtitle}>
            {filter === "favorites"
              ? "별표를 눌러 즐겨찾기에 추가해보세요"
              : "읽기 화면에서 마음에 드는 문장을\n길게 눌러 수집해보세요"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={sentences}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={sentencesQuery.isRefetching}
              onRefresh={() => sentencesQuery.refetch()}
              tintColor={Colors.zinc400}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
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
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  filterBar: {
    flexDirection: "row",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
    marginBottom: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.zinc50,
  },
  filterChipActive: {
    backgroundColor: Colors.zinc900,
  },
  filterChipText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
  },
  filterChipTextActive: {
    color: Colors.white,
    fontWeight: "600",
  },
  listContent: {
    paddingBottom: 40,
  },
  sentenceItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 16,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 12,
  },
  sentenceContent: {
    flex: 1,
    gap: 6,
  },
  sentenceText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc700,
    fontStyle: "italic",
    lineHeight: 24,
  },
  sentenceMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sentenceDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  sentencePage: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  favoriteButton: {
    paddingTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
    marginTop: 12,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 22,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
  },
  retryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
});
