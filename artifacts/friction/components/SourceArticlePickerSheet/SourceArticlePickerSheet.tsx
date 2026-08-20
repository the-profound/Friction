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
import {
  useListArticles,
  useListInbox,
  useGetUser,
  useGetArticle,
  getGetUserQueryKey,
  getGetArticleQueryKey,
  getListInboxQueryKey,
  getListArticlesQueryKey,
} from "@workspace/api-client-react";
import { LIST_PERF_PRESET } from "@/lib/listPerf";
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

type TabKey = "inbox" | "myArticles";

export default function SourceArticlePickerSheet({
  visible,
  onClose,
  userId,
  currentSourceArticleId,
  currentSourceArticleTitle,
  onSelect,
  onUnlink,
}: SourceArticlePickerSheetProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("inbox");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    if (!visible) {
      setSearchQuery("");
      setDebouncedQuery("");
      setActiveTab("inbox");
    }
  }, [visible]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const userQuery = useGetUser(userId, {
    query: { queryKey: getGetUserQueryKey(userId), enabled: visible && activeTab === "myArticles" },
  });
  const userNickname = userQuery.data?.nickname ?? userQuery.data?.email ?? "나";

  // 호출부가 제목을 모를 때(예: 초기 진입) 현재 연결된 원글 제목을 직접 조회한다.
  const currentSourceArticleQuery = useGetArticle(currentSourceArticleId ?? "", {
    query: {
      queryKey: getGetArticleQueryKey(currentSourceArticleId ?? ""),
      enabled: visible && !!currentSourceArticleId && !currentSourceArticleTitle,
    },
  });
  const resolvedCurrentTitle =
    currentSourceArticleTitle ?? currentSourceArticleQuery.data?.title ?? null;

  const inboxParams = {
    recipientId: userId,
    ...(debouncedQuery ? { titleQuery: debouncedQuery } : {}),
  };
  const inboxQuery = useListInbox(
    inboxParams,
    { query: { queryKey: getListInboxQueryKey(inboxParams), enabled: visible && activeTab === "inbox" } },
  );

  const myArticlesParams = {
    authorId: userId,
    status: "LETTER" as const,
    ...(debouncedQuery ? { titleQuery: debouncedQuery } : {}),
  };
  const myArticlesQuery = useListArticles(
    myArticlesParams,
    { query: { queryKey: getListArticlesQueryKey(myArticlesParams), enabled: visible && activeTab === "myArticles" } },
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
  const inboxItems: InboxItem[] = inboxQuery.data
    ? [...inboxQuery.data]
        // Guard: only show items that are actually visible (visibleAt <= now).
        // The server already applies this filter, but we re-apply client-side
        // to protect against edge cases with cached/stale data.
        .filter((item) => new Date(item.visibleAt) <= now)
        .sort(
          (a, b) => new Date(b.visibleAt).getTime() - new Date(a.visibleAt).getTime(),
        )
    : [];

  const myArticleItems: Article[] = myArticlesQuery.data
    ? [...myArticlesQuery.data].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
    : [];

  const isLoading =
    (activeTab === "inbox" && inboxQuery.isLoading) ||
    (activeTab === "myArticles" && myArticlesQuery.isLoading);

  const renderInboxItem = useCallback(
    ({ item }: { item: InboxItem }) => {
      const title = item.article?.title ?? "(제목 없음)";
      const senderName =
        item.senderDisplayName ?? item.sender?.nickname ?? item.sender?.email ?? "참여자";
      const isSelected = item.article?.id === currentSourceArticleId;
      return (
        <ScalePressable
          style={styles.listItem}
          onPress={() => handleSelect(item.article?.id ?? item.articleId, title)}
          contentStyle={[styles.listItemRow, isSelected && styles.listItemSelected]}
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

  const renderMyArticleItem = useCallback(
    ({ item }: { item: Article }) => {
      const isSelected = item.id === currentSourceArticleId;
      return (
        <ScalePressable
          style={styles.listItem}
          onPress={() => handleSelect(item.id, item.title)}
          contentStyle={[styles.listItemRow, isSelected && styles.listItemSelected]}
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
      title="답장 대상 편지 설정"
      closeButton
      snapPoints={[0.75]}
      keyboardAware
    >
      <View style={styles.container}>
        {currentSourceArticleId ? (
          <View style={styles.currentCard}>
            <View style={styles.currentCardLeft}>
              <Text style={styles.currentCardLabel}>현재 연결됨</Text>
              <Text style={styles.currentCardTitle} numberOfLines={1}>
                {resolvedCurrentTitle ?? "(제목 없음)"}
              </Text>
            </View>
            <ScalePressable contentStyle={styles.unlinkButtonContent} onPress={handleUnlink}>
              <Text style={styles.unlinkButtonText}>연결 해제</Text>
            </ScalePressable>
          </View>
        ) : null}

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
            onPress={() => setActiveTab("inbox")}
            contentStyle={[styles.tabContent, activeTab === "inbox" && styles.tabActive]}
          >
            <Text
              style={[styles.tabText, activeTab === "inbox" && styles.tabTextActive]}
            >
              수신한 편지
            </Text>
          </ScalePressable>
          <ScalePressable
            onPress={() => setActiveTab("myArticles")}
            contentStyle={[styles.tabContent, activeTab === "myArticles" && styles.tabActive]}
          >
            <Text
              style={[styles.tabText, activeTab === "myArticles" && styles.tabTextActive]}
            >
              내가 쓴 편지
            </Text>
          </ScalePressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={Colors.zinc400} />
          </View>
        ) : activeTab === "inbox" ? (
          inboxItems.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>수신한 편지가 없습니다.</Text>
            </View>
          ) : (
            <FlatList
              {...LIST_PERF_PRESET}
              data={inboxItems}
              keyExtractor={(item) => item.id}
              renderItem={renderInboxItem}
              style={styles.list}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          )
        ) : myArticleItems.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>작성한 편지가 없습니다.</Text>
          </View>
        ) : (
          <FlatList
            {...LIST_PERF_PRESET}
            data={myArticleItems}
            keyExtractor={(item) => item.id}
            renderItem={renderMyArticleItem}
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
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  currentCardTitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc800,
  },
  unlinkButtonContent: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.white,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
  },
  unlinkButtonText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc700,
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
    ...Typography.searchInput,
    flex: 1,
    color: Colors.zinc900,
    padding: 0,
  },
  tabRow: {
    flexDirection: "row",
    gap: 4,
  },
  tabContent: {
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 0,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.zinc100,
  },
  tabActive: {
    backgroundColor: Colors.zinc900,
  },
  tabText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  tabTextActive: {
    color: Colors.white,
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
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  list: {
    flex: 1,
  },
  listItem: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  listItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  listItemSelected: {
    backgroundColor: Colors.zinc50,
  },
  listItemContent: {
    flex: 1,
    gap: 2,
  },
  listItemTitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc900,
  },
  listItemSub: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
});
