import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Alert, Share, TextInput } from "react-native";
import { useToast } from "@/contexts/ToastContext";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import {
  useGetTeamCollection,
  useUpdateTeamCollection,
  useDeleteTeamCollection,
  useListTeamMembers,
  useListTeamArticles,
  useAddTeamArticle,
  useRemoveTeamArticle,
  useRemoveTeamMember,
  useAddTeamMember,
  useListArticles,
  useListInbox,
  useCreateNeighborRequest,
  getListTeamArticlesQueryKey,
  getGetTeamCollectionQueryKey,
  getListTeamMembersQueryKey,
} from "@workspace/api-client-react";
import type {
  TeamMemberWithUser,
  TeamCollectionArticleWithDetails,
  InboxItem,
} from "@workspace/api-client-react";
import { MyArticlesPickerBottomSheet } from "@/components/MyArticlesPickerBottomSheet/MyArticlesPickerBottomSheet";
import BottomSheet from "@/components/BottomSheet/BottomSheet";

type DetailTab = "articles" | "members";

export default function TeamCollectionDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<DetailTab>("articles");
  const [showPicker, setShowPicker] = useState(false);
  const [editSheetVisible, setEditSheetVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [inviteSheetVisible, setInviteSheetVisible] = useState(false);
  const [inviteUserId, setInviteUserId] = useState("");
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [articleActionTarget, setArticleActionTarget] = useState<TeamCollectionArticleWithDetails | null>(null);
  const [showDeleteHint, setShowDeleteHint] = useState(false);
  const [memberTarget, setMemberTarget] = useState<{ id: string; nickname: string } | null>(null);
  const [kickTarget, setKickTarget] = useState<{ id: string; nickname: string } | null>(null);

  const collectionQuery = useGetTeamCollection(id ?? "");
  const collection = collectionQuery.data;

  const membersQuery = useListTeamMembers(id ?? "");
  const members = (membersQuery.data ?? []) as TeamMemberWithUser[];

  const articlesQuery = useListTeamArticles(id ?? "");
  const articles = (articlesQuery.data ?? []) as TeamCollectionArticleWithDetails[];

  const myArticlesQuery = useListArticles({ authorId: userId, status: "LETTER" as const });
  const myArticles = (myArticlesQuery.data ?? []) as Array<{ id: string; title: string; status: string; content?: string }>;

  const updateCollection = useUpdateTeamCollection();
  const deleteCollection = useDeleteTeamCollection();
  const inboxQuery = useListInbox({ recipientId: userId });
  const inboxItems = (inboxQuery.data ?? []) as InboxItem[];

  const addArticle = useAddTeamArticle();
  const removeArticle = useRemoveTeamArticle();
  const removeMember = useRemoveTeamMember();
  const addMember = useAddTeamMember();
  const createNeighborRequest = useCreateNeighborRequest();

  const isOwner = members.some((m) => m.userId === userId && m.role === "OWNER");
  const isMember = members.some((m) => m.userId === userId);

  const handleMemberPress = useCallback((item: TeamMemberWithUser) => {
    if (item.userId === userId) return;
    setMemberTarget({
      id: item.userId,
      nickname: item.user?.nickname ?? "이름 없음",
    });
  }, [userId]);

  const handleSendNeighborRequest = useCallback(async () => {
    if (!memberTarget) return;
    try {
      await createNeighborRequest.mutateAsync({
        data: { requesterId: userId, recipientId: memberTarget.id },
      });
      setMemberTarget(null);
      Alert.alert("완료", "이웃 요청을 보냈어요!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "요청에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [memberTarget, userId, createNeighborRequest]);

  const handleKickConfirm = useCallback(async () => {
    if (!id || !kickTarget) return;
    const target = kickTarget;
    setKickTarget(null);
    try {
      await removeMember.mutateAsync({ teamId: id, userId: target.id });
      await queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey(id) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "추방에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, kickTarget, removeMember, queryClient]);

  const handleOpenEdit = useCallback(() => {
    if (!collection) return;
    setEditName(collection.name);
    setEditDescription(collection.description ?? "");
    setEditSheetVisible(true);
  }, [collection]);

  const handleSaveEdit = useCallback(async () => {
    if (!id || !editName.trim()) {
      Alert.alert("오류", "이름을 입력해주세요.");
      return;
    }
    try {
      await updateCollection.mutateAsync({
        id,
        data: { name: editName.trim(), description: editDescription.trim() || undefined },
      });
      setEditSheetVisible(false);
      collectionQuery.refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "수정에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, editName, editDescription, updateCollection, collectionQuery]);

  const handleDeleteCollection = useCallback(async () => {
    if (!id) return;
    try {
      await deleteCollection.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["/api/team-collections"] });
      router.back();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, deleteCollection, router, queryClient]);

  const handleShareInvite = useCallback(async () => {
    if (!id || !collection) return;
    try {
      await Share.share({
        message: `"${collection.name}" 단체 모음에 참여하세요! 초대 코드: ${id}`,
      });
    } catch {
    }
  }, [id, collection]);

  const handleInviteMember = useCallback(async () => {
    if (!id || !inviteUserId.trim()) {
      Alert.alert("오류", "사용자 ID를 입력해주세요.");
      return;
    }
    try {
      await addMember.mutateAsync({ id, data: { userId: inviteUserId.trim() } });
      setInviteSheetVisible(false);
      setInviteUserId("");
      membersQuery.refetch();
      Alert.alert("완료", "멤버가 추가되었습니다.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "멤버 추가에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, inviteUserId, addMember, membersQuery]);

  const handleAddArticles = useCallback(
    async (articleIds: string[]) => {
      if (!id || articleIds.length === 0) return;
      try {
        for (const articleId of articleIds) {
          await addArticle.mutateAsync({ id, data: { articleId, addedBy: userId } });
        }
        await queryClient.invalidateQueries({ queryKey: getListTeamArticlesQueryKey(id) });
        await queryClient.invalidateQueries({ queryKey: getGetTeamCollectionQueryKey(id) });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "글 추가에 실패했습니다.";
        Alert.alert("오류", msg);
      }
    },
    [id, userId, addArticle, queryClient],
  );

  const handleRemoveArticle = useCallback(
    async (articleId: string) => {
      if (!id) return;
      try {
        await removeArticle.mutateAsync({ teamId: id, articleId });
        articlesQuery.refetch();
        showToast({ message: "글을 제거했어요.", type: "success" });
      } catch {
        showToast({ message: "글 제거에 실패했습니다.", type: "error" });
      }
    },
    [id, removeArticle, articlesQuery, showToast],
  );

  const handleArticleActionRead = useCallback(() => {
    if (!articleActionTarget) return;
    const item = articleActionTarget;
    setArticleActionTarget(null);
    const unreadInboxItem = inboxItems.find(
      (inbox) => inbox.articleId === item.articleId && !inbox.isRead,
    );
    if (unreadInboxItem) {
      router.push({
        pathname: "/read",
        params: { articleId: item.articleId, inboxId: unreadInboxItem.id, mode: "basic" },
      });
    } else {
      router.push({
        pathname: "/read",
        params: { articleId: item.articleId, mode: "re_read" },
      });
    }
  }, [articleActionTarget, router, inboxItems]);

  const canDeleteTarget = articleActionTarget
    ? isOwner || articleActionTarget.article?.authorId === userId
    : false;

  const handleArticleActionDelete = useCallback(async () => {
    if (!articleActionTarget) return;
    if (!canDeleteTarget) {
      setShowDeleteHint(true);
      return;
    }
    const item = articleActionTarget;
    setArticleActionTarget(null);
    setShowDeleteHint(false);
    await handleRemoveArticle(item.articleId);
  }, [articleActionTarget, canDeleteTarget, handleRemoveArticle]);

  const alreadyAddedIds = articles.map((a) => a.articleId);

  const pickerArticles = myArticles.map((a) => ({
    id: a.id,
    title: a.title ?? "제목 없음",
    status: a.status,
    excerpt: a.content?.substring(0, 60),
  }));

  const renderArticleItem = ({ item }: { item: TeamCollectionArticleWithDetails }) => {
    return (
      <Pressable
        style={styles.articleItem}
        onPress={() => { setArticleActionTarget(item); setShowDeleteHint(false); }}
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
  };

  const renderMemberItem = ({ item }: { item: TeamMemberWithUser }) => {
    const isSelf = item.userId === userId;
    return (
      <Pressable
        style={styles.memberItem}
        onPress={() => handleMemberPress(item)}
        disabled={isSelf}
      >
        <View style={styles.memberAvatar}>
          <Text style={styles.memberAvatarText}>
            {(item.user?.nickname ?? item.userId).charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.memberInfo}>
          <Text style={styles.memberName} numberOfLines={1}>
            {item.user?.nickname ?? item.userId}
            {isSelf ? "  (나)" : ""}
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
        {!isSelf && <Feather name="chevron-right" size={16} color={Colors.zinc300} />}
      </Pressable>
    );
  };

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
            const options: Array<{ text: string; onPress?: () => void; style?: "destructive" | "cancel" | "default" }> = [];
            if (isOwner) {
              options.push({ text: "이름/설명 수정", onPress: handleOpenEdit });
              options.push({ text: "초대 링크 공유", onPress: handleShareInvite });
              options.push({ text: "삭제", style: "destructive", onPress: () => setDeleteConfirmVisible(true) });
            } else {
              options.push({ text: "초대 링크 공유", onPress: handleShareInvite });
            }
            options.push({ text: "닫기", style: "cancel" });
            Alert.alert("단체 모음 관리", undefined, options);
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
          {isMember && (
            <View style={styles.articleActions}>
              <Pressable style={styles.addButton} onPress={() => setShowPicker(true)}>
                <Feather name="plus" size={16} color={Colors.zinc600} />
                <Text style={styles.addButtonText}>내 글 추가</Text>
              </Pressable>
            </View>
          )}
          {articlesQuery.isError ? (
            <View style={styles.emptyContainer}>
              <Feather name="alert-circle" size={36} color={Colors.zinc300} />
              <Text style={styles.emptyTitle}>글 목록을 불러오지 못했어요</Text>
              <Pressable style={styles.retryButton} onPress={() => articlesQuery.refetch()}>
                <Text style={styles.retryButtonText}>다시 시도</Text>
              </Pressable>
            </View>
          ) : articles.length === 0 ? (
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
                onPress={() => { setInviteUserId(""); setInviteSheetVisible(true); }}
              >
                <Feather name="user-plus" size={16} color={Colors.zinc600} />
                <Text style={styles.addButtonText}>멤버 초대</Text>
              </Pressable>
              <Pressable
                style={[styles.addButton, { marginLeft: 8 }]}
                onPress={handleShareInvite}
              >
                <Feather name="share-2" size={16} color={Colors.zinc600} />
                <Text style={styles.addButtonText}>초대 링크</Text>
              </Pressable>
            </View>
          )}
          {membersQuery.isError ? (
            <View style={styles.emptyContainer}>
              <Feather name="alert-circle" size={36} color={Colors.zinc300} />
              <Text style={styles.emptyTitle}>멤버 목록을 불러오지 못했어요</Text>
              <Pressable style={styles.retryButton} onPress={() => membersQuery.refetch()}>
                <Text style={styles.retryButtonText}>다시 시도</Text>
              </Pressable>
            </View>
          ) : members.length === 0 ? (
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

      <BottomSheet
        visible={editSheetVisible}
        onClose={() => setEditSheetVisible(false)}
        title="모음 수정"
        snapPoints={[0.45]}
      >
        <View style={styles.formContent}>
          <TextInput
            style={styles.formInput}
            placeholder="모음 이름"
            placeholderTextColor={Colors.zinc400}
            value={editName}
            onChangeText={setEditName}
            autoFocus
          />
          <TextInput
            style={[styles.formInput, styles.formInputMulti]}
            placeholder="설명 (선택사항)"
            placeholderTextColor={Colors.zinc400}
            value={editDescription}
            onChangeText={setEditDescription}
            multiline
            textAlignVertical="top"
          />
          <Pressable
            style={[styles.formButton, !editName.trim() && styles.formButtonDisabled]}
            onPress={handleSaveEdit}
            disabled={!editName.trim()}
          >
            <Text style={styles.formButtonText}>저장</Text>
          </Pressable>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={inviteSheetVisible}
        onClose={() => setInviteSheetVisible(false)}
        title="멤버 초대"
        snapPoints={[0.35]}
      >
        <View style={styles.formContent}>
          <TextInput
            style={styles.formInput}
            placeholder="초대할 사용자 ID"
            placeholderTextColor={Colors.zinc400}
            value={inviteUserId}
            onChangeText={setInviteUserId}
            autoFocus
          />
          <Pressable
            style={[styles.formButton, !inviteUserId.trim() && styles.formButtonDisabled]}
            onPress={handleInviteMember}
            disabled={!inviteUserId.trim()}
          >
            <Text style={styles.formButtonText}>초대</Text>
          </Pressable>
        </View>
      </BottomSheet>

      <ConfirmModal
        visible={deleteConfirmVisible}
        title="단체 모음 삭제"
        description={`'${collection?.name ?? ""}'을(를) 삭제하시겠어요?`}
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={() => {
          setDeleteConfirmVisible(false);
          handleDeleteCollection();
        }}
        onCancel={() => setDeleteConfirmVisible(false)}
      />

      <ConfirmModal
        visible={articleActionTarget !== null}
        title={articleActionTarget?.article?.title ?? "제목 없음"}
        onCancel={() => { setArticleActionTarget(null); setShowDeleteHint(false); }}
        actionButton={{
          emoji: "📖",
          label: "읽기",
          onPress: handleArticleActionRead,
        }}
        deleteButton={{
          onPress: handleArticleActionDelete,
          disabled: !canDeleteTarget,
        }}
        hint={showDeleteHint ? "모음장과 작성자만 글을 삭제할 수 있습니다" : undefined}
      />

      <BottomSheet
        visible={memberTarget !== null}
        onClose={() => setMemberTarget(null)}
        title="멤버 프로필"
        snapPoints={[isOwner ? 0.46 : 0.38]}
      >
        {memberTarget && (
          <View style={styles.profileContent}>
            <View style={styles.profileAvatar}>
              <Text style={styles.profileAvatarText}>
                {memberTarget.nickname.charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.profileName}>{memberTarget.nickname}</Text>

            <View style={styles.profileActions}>
              <Pressable
                style={styles.profileActionButton}
                onPress={handleSendNeighborRequest}
                disabled={createNeighborRequest.isPending}
              >
                <Feather name="user-plus" size={16} color={Colors.zinc700} />
                <Text style={styles.profileActionText}>이웃 신청하기</Text>
              </Pressable>

              {isOwner && (
                <Pressable
                  style={[styles.profileActionButton, styles.profileKickButton]}
                  onPress={() => {
                    setMemberTarget(null);
                    setKickTarget({ id: memberTarget.id, nickname: memberTarget.nickname });
                  }}
                >
                  <Feather name="user-x" size={16} color="#DC2626" />
                  <Text style={[styles.profileActionText, styles.profileKickText]}>추방하기</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </BottomSheet>

      <ConfirmModal
        visible={kickTarget !== null}
        title={`'${kickTarget?.nickname ?? ""}'을(를) 추방하시겠어요?`}
        description="추방된 멤버는 이 모음에서 제거됩니다."
        confirmLabel="추방"
        cancelLabel="취소"
        destructive
        onConfirm={handleKickConfirm}
        onCancel={() => setKickTarget(null)}
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
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.zinc900,
    borderRadius: 10,
  },
  retryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  formContent: {
    paddingVertical: 12,
    gap: 12,
  },
  formInput: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc900,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  formInputMulti: {
    minHeight: 80,
    lineHeight: 22,
  },
  formButton: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  formButtonDisabled: {
    backgroundColor: Colors.zinc300,
  },
  formButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  profileContent: {
    alignItems: "center",
    paddingVertical: 8,
    gap: 6,
  },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  profileAvatarText: {
    ...Typography.bodySemiBold,
    fontSize: 24,
    color: Colors.zinc600,
  },
  profileName: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
  },
  profileEmail: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  profileActions: {
    width: "100%",
    marginTop: 16,
    gap: 10,
  },
  profileActionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.zinc100,
  },
  profileActionText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc700,
  },
  profileKickButton: {
    backgroundColor: "#FEE2E2",
  },
  profileKickText: {
    color: "#DC2626",
  },
});
