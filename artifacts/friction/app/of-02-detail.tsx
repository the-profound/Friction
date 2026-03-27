import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import {
  useGetTeamCollection,
  useDeleteTeamCollection,
  useListTeamMembers,
  useListTeamArticles,
  useAddTeamArticle,
  useRemoveTeamArticle,
  useListArticles,
} from "@workspace/api-client-react";
import type {
  TeamMemberWithUser,
  TeamCollectionArticleWithDetails,
} from "@workspace/api-client-react";
import { MyArticlesPickerBottomSheet } from "@/components/MyArticlesPickerBottomSheet/MyArticlesPickerBottomSheet";

type DetailTab = "articles" | "members";

export default function TeamCollectionDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<DetailTab>("articles");
  const [showPicker, setShowPicker] = useState(false);

  const collectionQuery = useGetTeamCollection(id ?? "");
  const collection = collectionQuery.data;

  const membersQuery = useListTeamMembers(id ?? "");
  const members = (membersQuery.data ?? []) as TeamMemberWithUser[];

  const articlesQuery = useListTeamArticles(id ?? "");
  const articles = (articlesQuery.data ?? []) as TeamCollectionArticleWithDetails[];

  const myArticlesQuery = useListArticles({ authorId: userId, status: "LETTER" as const });
  const myArticles = (myArticlesQuery.data ?? []) as Array<{ id: string; title: string; status: string; content?: string }>;

  const deleteCollection = useDeleteTeamCollection();
  const addArticle = useAddTeamArticle();
  const removeArticle = useRemoveTeamArticle();

  const isOwner = members.some((m) => m.userId === userId && m.role === "OWNER");

  const handleDeleteCollection = useCallback(() => {
    if (!id || !collection) return;
    Alert.alert("단체 모음 삭제", `'${collection.name}'을(를) 삭제하시겠어요?`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteCollection.mutateAsync({ id });
            router.back();
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
            Alert.alert("오류", msg);
          }
        },
      },
    ]);
  }, [id, collection, deleteCollection, router]);

  const handleAddArticles = useCallback(
    async (articleIds: string[]) => {
      if (!id) return;
      try {
        for (const articleId of articleIds) {
          await addArticle.mutateAsync({ id, data: { articleId, addedBy: userId } });
        }
        articlesQuery.refetch();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "글 추가에 실패했습니다.";
        Alert.alert("오류", msg);
      }
    },
    [id, addArticle, articlesQuery],
  );

  const handleRemoveArticle = useCallback(
    (articleId: string, title: string) => {
      if (!id) return;
      Alert.alert("글 제거", `'${title}'을(를) 이 모음에서 제거하시겠어요?`, [
        { text: "취소", style: "cancel" },
        {
          text: "제거",
          style: "destructive",
          onPress: async () => {
            try {
              await removeArticle.mutateAsync({ teamId: id, articleId });
              articlesQuery.refetch();
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : "글 제거에 실패했습니다.";
              Alert.alert("오류", msg);
            }
          },
        },
      ]);
    },
    [id, removeArticle, articlesQuery],
  );

  const alreadyAddedIds = articles.map((a) => a.articleId);

  const pickerArticles = myArticles.map((a) => ({
    id: a.id,
    title: a.title ?? "제목 없음",
    status: a.status,
    excerpt: a.content?.substring(0, 60),
  }));

  const renderArticleItem = ({ item }: { item: TeamCollectionArticleWithDetails }) => (
    <Pressable
      style={styles.articleItem}
      onPress={() =>
        router.push({
          pathname: "/read",
          params: { articleId: item.articleId, mode: "re_read" },
        })
      }
      onLongPress={() =>
        isOwner || item.addedBy === userId
          ? handleRemoveArticle(item.articleId, item.article?.title ?? "제목 없음")
          : undefined
      }
    >
      <View style={styles.articleInfo}>
        <Text style={styles.articleTitle} numberOfLines={1}>
          {item.article?.title ?? "제목 없음"}
        </Text>
        <Text style={styles.articleDate}>
          {new Date(item.addedAt).toLocaleDateString("ko-KR")}에 추가
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={Colors.zinc300} />
    </Pressable>
  );

  const renderMemberItem = ({ item }: { item: TeamMemberWithUser }) => (
    <View style={styles.memberItem}>
      <View style={styles.memberAvatar}>
        <Text style={styles.memberAvatarText}>
          {(item.user?.nickname ?? item.userId).charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName} numberOfLines={1}>
          {item.user?.nickname ?? item.userId}
        </Text>
        <Text style={styles.memberDate}>
          {new Date(item.joinedAt).toLocaleDateString("ko-KR")}에 참여
        </Text>
      </View>
      <View style={styles.roleBadge}>
        <Text style={styles.roleBadgeText}>
          {item.role === "OWNER" ? "소유자" : "멤버"}
        </Text>
      </View>
    </View>
  );

  if (!id) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>모음을 찾을 수 없어요</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {collection?.name ?? "단체 모음"}
        </Text>
        <Pressable
          hitSlop={12}
          onPress={() => {
            if (isOwner) {
              Alert.alert("단체 모음 관리", undefined, [
                { text: "삭제", style: "destructive", onPress: handleDeleteCollection },
                { text: "닫기", style: "cancel" },
              ]);
            } else {
              Alert.alert("정보", `소유자: ${members.find((m) => m.role === "OWNER")?.user?.nickname ?? "알 수 없음"}`);
            }
          }}
        >
          <Feather name="more-horizontal" size={20} color={Colors.zinc600} />
        </Pressable>
      </View>

      {collection?.description ? (
        <View style={styles.descSection}>
          <Text style={styles.descText}>{collection.description}</Text>
        </View>
      ) : null}

      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tab, activeTab === "articles" && styles.tabActive]}
          onPress={() => setActiveTab("articles")}
        >
          <Text style={[styles.tabText, activeTab === "articles" && styles.tabTextActive]}>
            글 목록 ({articles.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === "members" && styles.tabActive]}
          onPress={() => setActiveTab("members")}
        >
          <Text style={[styles.tabText, activeTab === "members" && styles.tabTextActive]}>
            멤버 ({members.length})
          </Text>
        </Pressable>
      </View>

      {activeTab === "articles" ? (
        <View style={styles.contentArea}>
          <View style={styles.articleActions}>
            <Pressable style={styles.addButton} onPress={() => setShowPicker(true)}>
              <Feather name="plus" size={16} color={Colors.zinc600} />
              <Text style={styles.addButtonText}>내 글 추가</Text>
            </Pressable>
          </View>
          {articles.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Feather name="file-text" size={36} color={Colors.zinc300} />
              <Text style={styles.emptyTitle}>아직 추가된 글이 없어요</Text>
              <Text style={styles.emptySubtitle}>멤버들이 글을 추가하면 여기에 표시됩니다</Text>
            </View>
          ) : (
            <FlatList
              data={articles}
              keyExtractor={(item) => item.id}
              renderItem={renderArticleItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      ) : (
        <View style={styles.contentArea}>
          {isOwner && (
            <View style={styles.articleActions}>
              <Pressable
                style={styles.addButton}
                onPress={() => Alert.alert("멤버 초대", "멤버 초대 기능은 준비 중입니다.")}
              >
                <Feather name="user-plus" size={16} color={Colors.zinc600} />
                <Text style={styles.addButtonText}>멤버 초대</Text>
              </Pressable>
            </View>
          )}
          {members.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Feather name="users" size={36} color={Colors.zinc300} />
              <Text style={styles.emptyTitle}>멤버가 없어요</Text>
              <Text style={styles.emptySubtitle}>초대 링크를 공유하여 멤버를 추가하세요</Text>
            </View>
          ) : (
            <FlatList
              data={members}
              keyExtractor={(item) => item.id}
              renderItem={renderMemberItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      )}

      <MyArticlesPickerBottomSheet
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handleAddArticles}
        articles={pickerArticles}
        alreadyAdded={alreadyAddedIds}
      />
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
    flex: 1,
    textAlign: "center",
    marginHorizontal: 8,
  },
  descSection: {
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 12,
  },
  descText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    lineHeight: 20,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
    marginBottom: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.zinc50,
  },
  tabActive: {
    backgroundColor: Colors.zinc900,
  },
  tabText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
  },
  tabTextActive: {
    color: Colors.white,
    fontWeight: "600",
  },
  contentArea: {
    flex: 1,
  },
  articleActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 8,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.zinc50,
    borderRadius: 8,
  },
  addButtonText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc600,
    fontWeight: "600",
  },
  listContent: {
    paddingBottom: 40,
  },
  articleItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  articleInfo: {
    flex: 1,
    gap: 2,
  },
  articleTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  articleDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 12,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc600,
  },
  memberInfo: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  memberDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: Colors.zinc100,
  },
  roleBadgeText: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc600,
    fontWeight: "600",
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
    fontSize: 16,
    color: Colors.zinc900,
    marginTop: 8,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
  },
});
