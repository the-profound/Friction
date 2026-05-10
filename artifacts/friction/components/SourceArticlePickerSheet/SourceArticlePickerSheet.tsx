import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  ActivityIndicator,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { Feather } from "@expo/vector-icons";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useListArticles, useListInbox, useGetUser, useGetArticle } from "@workspace/api-client-react";
import type { Article, InboxItem } from "@workspace/api-client-react";

interface SourceArticlePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  currentSourceArticleId?: string | null;
  currentSourceArticleTitle?: string | null;
  onSelect: (articleId: string, articleTitle: string) => void;
  onUnlink: () => void;
}

type TabKey = "received" | "written";

export default function SourceArticlePickerSheet({
  visible,
  onClose,
  userId,
  currentSourceArticleId,
  currentSourceArticleTitle,
  onSelect,
  onUnlink,
}: SourceArticlePickerSheetProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("received");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    if (!visible) {
      setSearchQuery("");
      setDebouncedQuery("");
      setActiveTab("received");
    }
  }, [visible]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const userQuery = useGetUser(userId, {
    query: { enabled: visible && activeTab === "written" },
  });
  const userNickname = userQuery.data?.nickname ?? userQuery.data?.email ?? "나";

  // 호출부가 제목을 모를 때(예: 초기 진입) 현재 연결된 원글 제목을 직접 조회한다.
  const currentSourceArticleQuery = useGetArticle(currentSourceArticleId ?? "", {
    query: { enabled: visible && !!currentSourceArticleId && !currentSourceArticleTitle },
  });
  const resolvedCurrentTitle =
    currentSourceArticleTitle ?? currentSourceArticleQuery.data?.title ?? null;

  const inboxQuery = useListInbox(
    {
      recipientId: userId,
      ...(debouncedQuery ? { titleQuery: debouncedQuery } : {}),
    },
    { query: { enabled: visible && activeTab === "received" } },
  );

  const myArticlesQuery = useListArticles(
    {
      authorId: userId,
      status: "LETTER",
      ...(debouncedQuery ? { titleQuery: debouncedQuery } : {}),
    },
    { query: { enabled: visible && activeTab === "written" } },
  );

  const handleSelect = useCallback(
    (articleId: string, articleTitle: string) => {
      onSelect(articleId, articleTitle);
      onClose();
    },
    [onSelect, onClose],
  );

  const handleUnlink = useCallback(() => {
    onUnlink();
    onClose();
  }, [onUnlink, onClose]);

  const now = new Date();
  const receivedItems: InboxItem[] = inboxQuery.data
    ? [...inboxQuery.data]
        // Guard: only show items that are actually visible (visibleAt <= now).
        // The server already applies this filter, but we re-apply client-side
        // to protect against edge cases with cached/stale data.
        .filter((item) => new Date(item.visibleAt) <= now)
        .sort(
          (a, b) => new Date(b.visibleAt).getTime() - new Date(a.visibleAt).getTime(),
        )
    : [];

  const writtenItems: Article[] = myArticlesQuery.data
    ? [...myArticlesQuery.data].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
    : [];

  const isLoading =
    (activeTab === "received" && inboxQuery.isLoading) ||
    (activeTab === "written" && myArticlesQuery.isLoading);

  const renderReceivedItem = useCallback(
    ({ item }: { item: InboxItem }) => {
      const title = item.article?.title ?? "(제목 없음)";
      const senderName = item.sender?.nickname ?? item.sender?.email ?? "알 수 없음";
      const isSelected = item.article?.id === currentSourceArticleId;
      return (
        <ScalePressable
          style={[styles.listItem, isSelected && styles.listItemSelected]}
          onPress={() => handleSelect(item.article?.id ?? item.articleId, title)}
        >
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.listItemSub} numberOfLines={1}>
              {senderName}
            </Text>
          </View>
          {isSelected && (
            <Feather name="check" size={16} color={Colors.zinc700} />
          )}
        </ScalePressable>
      );
    },
    [currentSourceArticleId, handleSelect],
  );

  const renderWrittenItem = useCallback(
    ({ item }: { item: Article }) => {
      const isSelected = item.id === currentSourceArticleId;
      return (
        <ScalePressable
          style={[styles.listItem, isSelected && styles.listItemSelected]}
          onPress={() => handleSelect(item.id, item.title)}
        >
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle} numberOfLines={1}>
              {item.title || "(제목 없음)"}
            </Text>
            <Text style={styles.listItemSub} numberOfLines={1}>
              {userNickname}
            </Text>
          </View>
          {isSelected && (
            <Feather name="check" size={16} color={Colors.zinc700} />
          )}
        </ScalePressable>
      );
    },
    [currentSourceArticleId, handleSelect, userNickname],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="원글 연결 설정"
      closeButton
      snapPoints={[0.75]}
      keyboardAware
    >
      <View style={styles.container}>
        {currentSourceArticleId && (
          <View style={styles.currentCard}>
            <View style={styles.currentCardLeft}>
              <Text style={styles.currentCardLabel}>현재 연결됨</Text>
              <Text style={styles.currentCardTitle} numberOfLines={1}>
                {resolvedCurrentTitle ?? "(제목 없음)"}
              </Text>
            </View>
            <ScalePressable style={styles.unlinkButton} onPress={handleUnlink}>
              <Text style={styles.unlinkButtonText}>연결 해제</Text>
            </ScalePressable>
          </View>
        )}

        <View style={styles.searchRow}>
          <Feather name="search" size={14} color={Colors.zinc400} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="제목으로 검색..."
            placeholderTextColor={Colors.zinc400}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        <View style={styles.tabRow}>
          <ScalePressable
            style={[styles.tab, activeTab === "received" && styles.tabActive]}
            onPress={() => setActiveTab("received")}
          >
            <Text
              style={[styles.tabText, activeTab === "received" && styles.tabTextActive]}
            >
              수신한 글
            </Text>
          </ScalePressable>
          <ScalePressable
            style={[styles.tab, activeTab === "written" && styles.tabActive]}
            onPress={() => setActiveTab("written")}
          >
            <Text
              style={[styles.tabText, activeTab === "written" && styles.tabTextActive]}
            >
              내가 쓴 글
            </Text>
          </ScalePressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={Colors.zinc400} />
          </View>
        ) : activeTab === "received" ? (
          receivedItems.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>수신한 글이 없습니다.</Text>
            </View>
          ) : (
            <FlatList
              data={receivedItems}
              keyExtractor={(item) => item.id}
              renderItem={renderReceivedItem}
              style={styles.list}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          )
        ) : writtenItems.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>작성한 글이 없습니다.</Text>
          </View>
        ) : (
          <FlatList
            data={writtenItems}
            keyExtractor={(item) => item.id}
            renderItem={renderWrittenItem}
            style={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 12,
  },
  currentCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.zinc100,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  currentCardLeft: {
    flex: 1,
    gap: 2,
  },
  currentCardLabel: {
    fontSize: 11,
    color: Colors.zinc500,
    fontFamily: "Pretendard",
  },
  currentCardTitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc800,
  },
  unlinkButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.white,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
  },
  unlinkButtonText: {
    fontSize: 13,
    color: Colors.zinc700,
    fontFamily: "Pretendard",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.zinc100,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  searchIcon: {
    marginRight: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.zinc900,
    fontFamily: "Pretendard",
    padding: 0,
  },
  tabRow: {
    flexDirection: "row",
    gap: 4,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.zinc100,
  },
  tabActive: {
    backgroundColor: Colors.zinc900,
  },
  tabText: {
    fontSize: 13,
    color: Colors.zinc500,
    fontFamily: "Pretendard",
  },
  tabTextActive: {
    color: Colors.white,
    fontFamily: "Pretendard",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 24,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 24,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.zinc400,
    fontFamily: "Pretendard",
  },
  list: {
    flex: 1,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 8,
  },
  listItemSelected: {
    backgroundColor: Colors.zinc50,
  },
  listItemContent: {
    flex: 1,
    gap: 2,
  },
  listItemTitle: {
    fontSize: 14,
    color: Colors.zinc900,
    fontFamily: "Pretendard",
  },
  listItemSub: {
    fontSize: 12,
    color: Colors.zinc400,
    fontFamily: "Pretendard",
  },
});
