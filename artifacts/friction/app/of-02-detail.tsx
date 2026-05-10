import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { View, Text, StyleSheet, FlatList, Alert, Share, TextInput, ActivityIndicator, ScrollView, Platform } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { NavBar } from "@/components/NavBar/NavBar";
import SwipeableRow, { SwipeableRowHandle } from "@/components/SwipeableRow/SwipeableRow";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import { LIST_PERF_PRESET } from "@/lib/listPerf";
import {
  useGetTeamCollection,
  useUpdateTeamCollection,
  useDeleteTeamCollection,
  useListTeamMembers,
  useListTeamArticles,
  useRemoveTeamArticle,
  useRemoveTeamMember,
  useAddTeamMember,
  useListInbox,
  ApiError,
  useCreateNeighborRequest,
  useListNeighbors,
  useListNeighborRequests,
  useSearchUsersByNickname,
  getListTeamArticlesQueryKey,
  getListTeamMembersQueryKey,
  getGetTeamCollectionQueryKey,
  getListInboxQueryKey,
} from "@workspace/api-client-react";
import { invalidateTeamCollections } from "@/lib/queryInvalidation";
import type {
  TeamMemberWithUser,
  TeamCollectionArticleWithDetails,
  InboxItem,
  UserSearchResult,
} from "@workspace/api-client-react";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import {
  INCOMING_FALLBACK_POLL_INTERVAL_MS,
  useFocusPollingOptions,
  isQueryStale,
} from "@/lib/useScreenFocused";
import { useRealtimeChannel } from "@/lib/useRealtimeChannel";
import { buildTeamArticleRows, type TeamArticleListRow } from "@/lib/teamCollectionUtils";

type DetailTab = "articles" | "members";

export default function TeamCollectionDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<DetailTab>("articles");
  const [editSheetVisible, setEditSheetVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [inviteSheetVisible, setInviteSheetVisible] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [debouncedInviteQuery, setDebouncedInviteQuery] = useState("");
  const inviteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deleteArticleTarget, setDeleteArticleTarget] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [manageSheetVisible, setManageSheetVisible] = useState(false);
  const [manageSnapPoint, setManageSnapPoint] = useState(0.28);
  const [memberTarget, setMemberTarget] = useState<{ id: string; nickname: string } | null>(null);
  const [kickTarget, setKickTarget] = useState<{ id: string; nickname: string } | null>(null);
  const openRowRef = useRef<SwipeableRowHandle | null>(null);
  const rowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());
  const isNavigatingRef = useRef(false);

  useEffect(() => {
    if (inviteDebounceRef.current) clearTimeout(inviteDebounceRef.current);
    inviteDebounceRef.current = setTimeout(() => {
      setDebouncedInviteQuery(inviteQuery);
    }, 300);
    return () => {
      if (inviteDebounceRef.current) clearTimeout(inviteDebounceRef.current);
    };
  }, [inviteQuery]);

  const inviteSearchResults = useSearchUsersByNickname(debouncedInviteQuery, userId, {
    excludeTeamId: id,
  });

  // Realtime subscriptions push membership + article changes within sub-
  // second latency; the slower focus-gated poll (60s) stays as a safety net
  // for environments where the realtime channel is unavailable.
  const pollOpts = useFocusPollingOptions(INCOMING_FALLBACK_POLL_INTERVAL_MS);
  const collectionQuery = useGetTeamCollection(id ?? "");
  const collection = collectionQuery.data;

  const membersQuery = useListTeamMembers(id ?? "", pollOpts);
  const members = (membersQuery.data ?? []) as TeamMemberWithUser[];

  const articlesQuery = useListTeamArticles(id ?? "", { userId }, pollOpts);
  const articles = (articlesQuery.data ?? []) as TeamCollectionArticleWithDetails[];

  const updateCollection = useUpdateTeamCollection();
  const deleteCollection = useDeleteTeamCollection();
  const inboxQuery = useListInbox({ recipientId: userId }, pollOpts);
  const inboxItems = (inboxQuery.data ?? []) as InboxItem[];

  useRealtimeChannel(
    id ? `team-collection:${id}` : null,
    [
      {
        table: "team_collection_memberships",
        filter: `team_collection_id=eq.${id}`,
      },
      {
        table: "team_collection_articles",
        filter: `team_collection_id=eq.${id}`,
      },
    ],
    () => {
      membersQuery.refetch();
      articlesQuery.refetch();
    },
  );

  useRealtimeChannel(
    userId ? `team-detail-inbox:${userId}` : null,
    [{ table: "inbox", filter: `recipient_id=eq.${userId}` }],
    () => {
      inboxQuery.refetch();
    },
  );

  const removeArticle = useRemoveTeamArticle();
  const removeMember = useRemoveTeamMember();
  const addMember = useAddTeamMember();
  const createNeighborRequest = useCreateNeighborRequest();
  const neighborsQuery = useListNeighbors({ userId });
  const sentRequestsQuery = useListNeighborRequests({ requesterId: userId });
  const [optimisticPendingIds, setOptimisticPendingIds] = useState<Set<string>>(new Set());

  const { showToast } = useToast();

  // Refetch on focus ONLY if cached data is stale. Realtime channels handle
  // live updates while the screen is active; polling covers the background
  // interval. The stale check prevents redundant round-trips when navigating
  // back from a sub-sheet within 30 s.
  const refetchCollection = collectionQuery.refetch;
  const refetchMembers = membersQuery.refetch;
  const refetchArticles = articlesQuery.refetch;
  const refetchInbox = inboxQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      isNavigatingRef.current = false;
      if (id && isQueryStale(queryClient, getGetTeamCollectionQueryKey(id))) {
        refetchCollection();
      }
      if (id && isQueryStale(queryClient, getListTeamMembersQueryKey(id))) {
        refetchMembers();
      }
      if (id && isQueryStale(queryClient, getListTeamArticlesQueryKey(id))) {
        refetchArticles();
      }
      if (isQueryStale(queryClient, getListInboxQueryKey({ recipientId: userId }))) {
        refetchInbox();
      }
    }, [refetchCollection, refetchMembers, refetchArticles, refetchInbox, queryClient, id, userId]),
  );

  const prevInviteError = useRef(false);
  useEffect(() => {
    if (inviteSearchResults.isError && !prevInviteError.current) {
      showToast({ message: "검색에 실패했습니다. 잠시 후 다시 시도해주세요.", type: "error" });
    }
    prevInviteError.current = inviteSearchResults.isError;
  }, [inviteSearchResults.isError, showToast]);

  const isOwner = members.some((m) => m.userId === userId && m.role === "OWNER");
  const isMember = members.some((m) => m.userId === userId);

  const neighborSet = useMemo(() => {
    const set = new Set<string>();
    for (const n of (neighborsQuery.data ?? []) as Array<{ neighborUserId: string }>) {
      set.add(n.neighborUserId);
    }
    return set;
  }, [neighborsQuery.data]);

  const pendingRequestSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of (sentRequestsQuery.data ?? []) as Array<{ recipientId: string }>) {
      set.add(r.recipientId);
    }
    return set;
  }, [sentRequestsQuery.data]);

  useEffect(() => {
    if (optimisticPendingIds.size === 0) return;
    setOptimisticPendingIds((prev) => {
      const next = new Set<string>();
      for (const mid of prev) {
        if (!pendingRequestSet.has(mid) && !neighborSet.has(mid)) {
          next.add(mid);
        }
      }
      return next.size === prev.size ? prev : next;
    });
  }, [pendingRequestSet, neighborSet]);

  const getMemberNeighborStatus = useCallback((memberId: string): "neighbor" | "pending" | "none" => {
    if (neighborSet.has(memberId)) return "neighbor";
    if (pendingRequestSet.has(memberId) || optimisticPendingIds.has(memberId)) return "pending";
    return "none";
  }, [neighborSet, pendingRequestSet, optimisticPendingIds]);

  const handleMemberPress = useCallback((item: TeamMemberWithUser) => {
    if (item.userId === userId) return;
    setMemberTarget({
      id: item.userId,
      nickname: item.user?.nickname ?? "이름 없음",
    });
  }, [userId]);

  const handleSendNeighborRequest = useCallback(async () => {
    if (!memberTarget || createNeighborRequest.isPending) return;
    const targetId = memberTarget.id;
    setOptimisticPendingIds((prev) => new Set(prev).add(targetId));
    try {
      await createNeighborRequest.mutateAsync({
        data: { requesterId: userId, recipientId: targetId },
      });
      sentRequestsQuery.refetch();
      setMemberTarget(null);
      Alert.alert("완료", "이웃 요청을 보냈어요!");
    } catch (e: unknown) {
      const isDuplicate =
        e instanceof ApiError &&
        typeof e.data === "object" &&
        e.data !== null &&
        "error" in e.data &&
        ((e.data as { error?: string }).error === "Already neighbors" ||
          (e.data as { error?: string }).error === "Request already exists");
      if (isDuplicate) {
        sentRequestsQuery.refetch();
        neighborsQuery.refetch();
        setMemberTarget(null);
      } else {
        setOptimisticPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
        const msg = e instanceof Error ? e.message : "요청에 실패했습니다.";
        Alert.alert("오류", msg);
      }
    }
  }, [memberTarget, userId, createNeighborRequest, sentRequestsQuery, neighborsQuery]);

  const handleKickConfirm = useCallback(async () => {
    if (!id || !kickTarget || removeMember.isPending) return;
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
    if (!id || !editName.trim() || updateCollection.isPending) {
      if (!editName.trim()) Alert.alert("오류", "이름을 입력해주세요.");
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
    if (!id || deleteCollection.isPending) return;
    try {
      await deleteCollection.mutateAsync({ id });
      invalidateTeamCollections(queryClient);
      router.back();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, deleteCollection, router, queryClient]);

  const handleShareInvite = useCallback(async () => {
    if (!id || !collection) return;
    const message = `"${collection.name}" 단체 모음에 참여하세요! 초대 코드: ${id}`;
    if (Platform.OS === "web") {
      try {
        if (typeof navigator !== "undefined" && navigator.share) {
          await navigator.share({ text: message });
        } else {
          await navigator.clipboard.writeText(id);
          Alert.alert("완료", "초대 코드가 클립보드에 복사되었어요");
        }
      } catch {
        try {
          await navigator.clipboard.writeText(id);
          Alert.alert("완료", "초대 코드가 클립보드에 복사되었어요");
        } catch {
          Alert.alert("오류", "공유에 실패했어요");
        }
      }
    } else {
      try {
        await Share.share({ message });
      } catch {
        Alert.alert("오류", "공유에 실패했어요");
      }
    }
  }, [id, collection]);

  const handleInviteUserTap = useCallback(async (user: UserSearchResult) => {
    if (!id || addMember.isPending) return;
    try {
      await addMember.mutateAsync({ id, data: { userId: user.id } });
      setInviteSheetVisible(false);
      setInviteQuery("");
      setDebouncedInviteQuery("");
      await membersQuery.refetch();
      showToast({ message: `${user.nickname}님이 멤버로 추가되었습니다.`, type: "success" });
    } catch (e: unknown) {
      // Surface the server's error message (e.g. "User is already a member")
      // instead of swallowing it with a generic toast — this is what made
      // failed invites look "silent" to operators during cross-testing.
      const serverMessage =
        e && typeof e === "object" && "data" in e && e.data && typeof e.data === "object"
          ? (e.data as { error?: unknown }).error
          : undefined;
      const fallback = e instanceof Error ? e.message : "멤버 추가에 실패했습니다.";
      const message = typeof serverMessage === "string" && serverMessage.length > 0
        ? serverMessage
        : fallback;
      showToast({ message, type: "error" });
    }
  }, [id, addMember, membersQuery, showToast]);

  const handleRemoveArticle = useCallback(
    async (articleId: string) => {
      if (!id || removeArticle.isPending) return;
      try {
        await removeArticle.mutateAsync({ teamId: id, articleId });
        articlesQuery.refetch();
        Alert.alert("완료", "글을 제거했어요.");
      } catch {
        Alert.alert("오류", "글 제거에 실패했습니다.");
      }
    },
    [id, removeArticle, articlesQuery],
  );

  const closeOpenRow = useCallback(() => {
    if (openRowRef.current) {
      openRowRef.current.close();
      openRowRef.current = null;
    }
  }, []);

  const handleSwipeOpen = useCallback((articleId: string) => {
    const currentOpen = openRowRef.current;
    const newRef = rowRefs.current.get(articleId) ?? null;
    if (currentOpen && currentOpen !== newRef) {
      currentOpen.close();
    }
    openRowRef.current = newRef;
  }, []);

  const handleArticleNavigate = useCallback((item: TeamCollectionArticleWithDetails) => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    closeOpenRow();
    const isOwnArticle = item.article?.authorId === userId;
    const hasReadBefore = item.completedAt != null;

    if (isOwnArticle || hasReadBefore) {
      router.push({
        pathname: "/read",
        params: { articleId: item.articleId, mode: "re_read", teamCollectionId: id },
      });
      return;
    }

    const unreadInboxItem = inboxItems.find(
      (inbox) => inbox.articleId === item.articleId && !inbox.isRead,
    );
    router.push({
      pathname: "/read",
      params: unreadInboxItem
        ? { articleId: item.articleId, inboxId: unreadInboxItem.id, mode: "basic", entrySource: "list", teamCollectionId: id }
        : { articleId: item.articleId, mode: "basic", entrySource: "list", teamCollectionId: id },
    });
  }, [router, inboxItems, closeOpenRow, userId, id]);

  const handleArticleDeletePress = useCallback((item: TeamCollectionArticleWithDetails) => {
    const canDelete = isOwner || item.article?.authorId === userId;
    if (!canDelete) {
      closeOpenRow();
      showToast({ message: "모음장과 작성자만 글을 삭제할 수 있습니다.", type: "info" });
      return;
    }
    setDeleteArticleTarget(item.articleId);
  }, [isOwner, userId, closeOpenRow, showToast]);

  const handleArticleDeleteConfirm = useCallback(async () => {
    if (!deleteArticleTarget) return;
    const articleId = deleteArticleTarget;
    setDeleteArticleTarget(null);
    closeOpenRow();
    await handleRemoveArticle(articleId);
  }, [deleteArticleTarget, closeOpenRow, handleRemoveArticle]);

  const articleRows = useMemo(() => buildTeamArticleRows(articles), [articles]);

  const memberNicknameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      if (m.user?.nickname) map.set(m.userId, m.user.nickname);
    }
    return map;
  }, [members]);

  const isUnread = useCallback((item: TeamCollectionArticleWithDetails): boolean => {
    return !item.completedAt;
  }, []);

  const renderArticleRow = useCallback(
    (item: TeamCollectionArticleWithDetails, indent: boolean, isNoticeOfDay: boolean) => {
      if (item.isDeletedPlaceholder) {
        return (
          <View
            key={`placeholder-${item.id}`}
            style={[
              styles.articleItem,
              indent && styles.articleItemIndent,
              styles.deletedPlaceholder,
            ]}
          >
            <Text style={styles.deletedPlaceholderText}>(삭제된 글입니다.)</Text>
          </View>
        );
      }

      const authorId = item.article?.authorId ?? item.addedBy;
      const isMyArticle = !!authorId && authorId === userId;
      const showUnread = !isMyArticle && isUnread(item);
      const rowBg = isNoticeOfDay ? Colors.noticeAccentSoft : undefined;
      const authorNickname = authorId ? memberNicknameMap.get(authorId) : undefined;

      return (
        <SwipeableRow
          key={item.id}
          ref={(r) => {
            if (r) {
              rowRefs.current.set(item.id, r);
            } else {
              rowRefs.current.delete(item.id);
            }
          }}
          onDeletePress={() => handleArticleDeletePress(item)}
          onSwipeOpen={() => handleSwipeOpen(item.id)}
          onScrollLock={(locked) => setScrollEnabled(!locked)}
        >
          <ScalePressable
            style={[
              styles.articleItem,
              indent && styles.articleItemIndent,
              rowBg ? { backgroundColor: rowBg } : undefined,
            ]}
            onPress={() => handleArticleNavigate(item)}
          >
            <View style={styles.articleInfo}>
              <View style={styles.articleTitleRow}>
                <Text style={styles.articleTitle} numberOfLines={1}>
                  {item.article?.title ?? "제목 없음"}
                </Text>
                {isNoticeOfDay && (
                  <View style={styles.noticeOfDayBadge}>
                    <Text style={styles.noticeOfDayBadgeText}>오늘의 인사</Text>
                  </View>
                )}
                {isMyArticle && (
                  <View style={styles.myArticleBadge}>
                    <Text style={styles.myArticleBadgeText}>내 글</Text>
                  </View>
                )}
                {showUnread && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>새 글</Text>
                  </View>
                )}
              </View>
              <Text style={styles.articleDate}>
                {new Date(item.addedAt).toLocaleDateString("ko-KR")} {new Date(item.addedAt).getHours() < 12 ? "오전" : "오후"}에 수신
                {authorNickname ? `  ·  ${authorNickname}` : ""}
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color={Colors.zinc300} />
          </ScalePressable>
        </SwipeableRow>
      );
    },
    [handleArticleDeletePress, handleSwipeOpen, handleArticleNavigate, isUnread, memberNicknameMap, userId],
  );

  const renderRow = useCallback(
    ({ item }: { item: TeamArticleListRow }) => {
      if (item.type === "header") {
        return (
          <View style={styles.dateHeader}>
            <Text style={styles.dateHeaderText}>{item.label}</Text>
          </View>
        );
      }
      return renderArticleRow(item.item, item.indent, item.isNoticeOfDay);
    },
    [renderArticleRow],
  );

  const renderMemberItem = ({ item }: { item: TeamMemberWithUser }) => {
    const isSelf = item.userId === userId;
    return (
      <ScalePressable
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
      </ScalePressable>
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
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {collection?.name ?? "단체 모음"}
        </Text>
        <ScalePressable
          hitSlop={12}
          onPress={() => {
            if (manageSheetVisible) return;
            setManageSnapPoint(isOwner ? 0.38 : 0.28);
            setManageSheetVisible(true);
          }}
        >
          <Feather name="more-horizontal" size={20} color={Colors.zinc600} />
        </ScalePressable>
      </View>

      {collection?.description ? (
        <View style={styles.descSection}>
          <Text style={styles.descText}>{collection.description}</Text>
        </View>
      ) : null}

      <View style={styles.tabBar}>
        <ScalePressable
          style={[styles.tab, activeTab === "articles" && styles.tabActive]}
          onPress={() => setActiveTab("articles")}
        >
          <Text style={[styles.tabText, activeTab === "articles" && styles.tabTextActive]}>
            글 목록 ({articles.filter((a) => !a.isDeletedPlaceholder).length})
          </Text>
        </ScalePressable>
        <ScalePressable
          style={[styles.tab, activeTab === "members" && styles.tabActive]}
          onPress={() => setActiveTab("members")}
        >
          <Text style={[styles.tabText, activeTab === "members" && styles.tabTextActive]}>
            멤버 ({members.length})
          </Text>
        </ScalePressable>
      </View>

      {activeTab === "articles" ? (
        <View style={styles.contentArea}>
          {isMember && (
            <View style={styles.articleActions}>
              <ScalePressable
                style={styles.addButton}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/to",
                    params: {
                      subTab: "send",
                      targetGroup: id,
                      targetGroupName: collection?.name ?? "",
                      returnToId: id,
                    },
                  })
                }
              >
                <Feather name="send" size={16} color={Colors.zinc600} />
                <Text style={styles.addButtonText}>내 글 보내기</Text>
              </ScalePressable>
            </View>
          )}
          {articlesQuery.isError ? (
            <View style={[styles.emptyContainer, { paddingBottom: Spacing.navBarPaddingBottom + insets.bottom }]}>
              <Feather name="alert-circle" size={36} color={Colors.zinc300} />
              <Text style={styles.emptyTitle}>글 목록을 불러오지 못했어요</Text>
              <ScalePressable style={styles.retryButton} onPress={() => articlesQuery.refetch()}>
                <Text style={styles.retryButtonText}>다시 시도</Text>
              </ScalePressable>
            </View>
          ) : articlesQuery.isLoading ? (
            <View style={[styles.emptyContainer, { paddingBottom: Spacing.navBarPaddingBottom + insets.bottom }]}>
              <ActivityIndicator size="large" color={Colors.zinc300} />
            </View>
          ) : articleRows.length === 0 ? (
            <View style={[styles.emptyContainer, { paddingBottom: Spacing.navBarPaddingBottom + insets.bottom }]}>
              <Feather name="file-text" size={36} color={Colors.zinc300} />
              <Text style={styles.emptyTitle}>아직 추가된 글이 없어요</Text>
              <Text style={styles.emptySubtitle}>멤버들이 글을 추가하면 여기에 표시됩니다</Text>
            </View>
          ) : (
            <FlatList
              {...LIST_PERF_PRESET}
              data={articleRows}
              keyExtractor={(item) =>
                item.type === "header" ? `header-${item.dateKey}` : item.item.id
              }
              renderItem={renderRow}
              contentContainerStyle={[styles.listContent, { paddingBottom: Spacing.navBarPaddingBottom + insets.bottom }]}
              showsVerticalScrollIndicator={false}
              scrollEnabled={scrollEnabled}
            />
          )}
        </View>
      ) : (
        <View style={styles.contentArea}>
          {isOwner && (
            <View style={styles.articleActions}>
              <ScalePressable
                style={styles.addButton}
                onPress={() => { setInviteQuery(""); setDebouncedInviteQuery(""); setInviteSheetVisible(true); }}
              >
                <Feather name="user-plus" size={16} color={Colors.zinc600} />
                <Text style={styles.addButtonText}>멤버 초대</Text>
              </ScalePressable>
              <ScalePressable
                style={[styles.addButton, { marginLeft: 8 }]}
                onPress={handleShareInvite}
              >
                <Feather name="share-2" size={16} color={Colors.zinc600} />
                <Text style={styles.addButtonText}>초대 링크</Text>
              </ScalePressable>
            </View>
          )}
          {membersQuery.isError ? (
            <View style={[styles.emptyContainer, { paddingBottom: Spacing.navBarPaddingBottom + insets.bottom }]}>
              <Feather name="alert-circle" size={36} color={Colors.zinc300} />
              <Text style={styles.emptyTitle}>멤버 목록을 불러오지 못했어요</Text>
              <ScalePressable style={styles.retryButton} onPress={() => membersQuery.refetch()}>
                <Text style={styles.retryButtonText}>다시 시도</Text>
              </ScalePressable>
            </View>
          ) : membersQuery.isLoading ? (
            <View style={[styles.emptyContainer, { paddingBottom: Spacing.navBarPaddingBottom + insets.bottom }]}>
              <ActivityIndicator size="large" color={Colors.zinc300} />
            </View>
          ) : members.length === 0 ? (
            <View style={[styles.emptyContainer, { paddingBottom: Spacing.navBarPaddingBottom + insets.bottom }]}>
              <Feather name="users" size={36} color={Colors.zinc300} />
              <Text style={styles.emptyTitle}>멤버가 없어요</Text>
              <Text style={styles.emptySubtitle}>초대 링크를 공유하여 멤버를 추가하세요</Text>
            </View>
          ) : (
            <FlatList
              {...LIST_PERF_PRESET}
              data={members}
              keyExtractor={(item) => item.id}
              renderItem={renderMemberItem}
              contentContainerStyle={[styles.listContent, { paddingBottom: Spacing.navBarPaddingBottom + insets.bottom }]}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      )}

      <BottomSheet
        visible={manageSheetVisible}
        onClose={() => setManageSheetVisible(false)}
        snapPoints={[manageSnapPoint]}
      >
        <View style={styles.manageSheetContent}>
          {isOwner && (
            <ScalePressable
              style={styles.manageSheetRow}
              onPress={() => { setManageSheetVisible(false); handleOpenEdit(); }}
            >
              <Feather name="edit-2" size={18} color={Colors.zinc700} />
              <Text style={styles.manageSheetLabel}>이름/설명 수정</Text>
            </ScalePressable>
          )}
          <ScalePressable
            style={styles.manageSheetRow}
            onPress={() => { setManageSheetVisible(false); handleShareInvite(); }}
          >
            <Feather name="share-2" size={18} color={Colors.zinc700} />
            <Text style={styles.manageSheetLabel}>초대 링크 공유</Text>
          </ScalePressable>
          {isOwner && (
            <ScalePressable
              style={styles.manageSheetRow}
              onPress={() => { setManageSheetVisible(false); setDeleteConfirmVisible(true); }}
            >
              <Feather name="trash-2" size={18} color="#DC2626" />
              <Text style={[styles.manageSheetLabel, { color: "#DC2626" }]}>모음 삭제</Text>
            </ScalePressable>
          )}
        </View>
      </BottomSheet>

      <BottomSheet
        visible={editSheetVisible}
        onClose={() => setEditSheetVisible(false)}
        title="모음 수정"
        snapPoints={[0.55, 0.95]}
        keyboardAware
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
          <ScalePressable
            style={[styles.formButton, (!editName.trim() || updateCollection.isPending) && styles.formButtonDisabled]}
            onPress={handleSaveEdit}
            disabled={!editName.trim() || updateCollection.isPending}
          >
            <Text style={styles.formButtonText}>{updateCollection.isPending ? "저장 중..." : "저장"}</Text>
          </ScalePressable>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={inviteSheetVisible}
        onClose={() => {
          setInviteSheetVisible(false);
          setInviteQuery("");
          setDebouncedInviteQuery("");
        }}
        title="멤버 초대"
        snapPoints={[0.55]}
        keyboardAware
      >
        <View style={styles.inviteContent}>
          <TextInput
            style={styles.formInput}
            placeholder="닉네임 또는 이메일로 검색"
            placeholderTextColor={Colors.zinc400}
            value={inviteQuery}
            onChangeText={setInviteQuery}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
          />
          {inviteQuery.trim().length === 0 ? (
            <View style={styles.inviteEmptyState}>
              <Text style={styles.inviteEmptyText}>닉네임 또는 이메일을 입력해 주세요</Text>
            </View>
          ) : inviteSearchResults.isLoading ? (
            <View style={styles.inviteEmptyState}>
              <ActivityIndicator size="small" color={Colors.zinc400} />
            </View>
          ) : inviteSearchResults.isError ? (
            <View style={styles.inviteEmptyState}>
              <Text style={styles.inviteEmptyText}>검색 결과를 불러올 수 없습니다.</Text>
            </View>
          ) : (inviteSearchResults.data ?? []).length === 0 ? (
            <View style={styles.inviteEmptyState}>
              <Text style={styles.inviteEmptyText}>일치하는 사용자가 없습니다</Text>
            </View>
          ) : (
            <ScrollView style={styles.inviteResultList} keyboardShouldPersistTaps="handled">
              {(inviteSearchResults.data ?? []).map((user) => (
                <ScalePressable
                  key={user.id}
                  style={[styles.inviteResultItem, addMember.isPending && { opacity: 0.5 }]}
                  onPress={() => handleInviteUserTap(user)}
                  disabled={addMember.isPending}
                >
                  <View style={styles.inviteAvatar}>
                    <Text style={styles.inviteAvatarText}>
                      {user.nickname.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.inviteUserInfo}>
                    <Text style={styles.inviteNickname} numberOfLines={1}>{user.nickname}</Text>
                    <Text style={styles.inviteEmail} numberOfLines={1}>{user.email}</Text>
                  </View>
                  <Feather name="user-plus" size={18} color={Colors.zinc400} />
                </ScalePressable>
              ))}
            </ScrollView>
          )}
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
        visible={deleteArticleTarget !== null}
        title="글 삭제"
        description="이 글을 단체 모음에서 제거하시겠어요?"
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleArticleDeleteConfirm}
        onCancel={() => { setDeleteArticleTarget(null); closeOpenRow(); }}
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
              {getMemberNeighborStatus(memberTarget.id) === "neighbor" ? (
                <View style={styles.profileActionButton}>
                  <Feather name="check" size={16} color={Colors.zinc500} />
                  <Text style={[styles.profileActionText, { color: Colors.zinc500 }]}>이웃입니다</Text>
                </View>
              ) : getMemberNeighborStatus(memberTarget.id) === "pending" ? (
                <View style={styles.profileActionButton}>
                  <Feather name="clock" size={16} color={Colors.zinc500} />
                  <Text style={[styles.profileActionText, { color: Colors.zinc500 }]}>이웃 신청 중입니다</Text>
                </View>
              ) : (
                <ScalePressable
                  style={styles.profileActionButton}
                  onPress={handleSendNeighborRequest}
                  disabled={createNeighborRequest.isPending}
                >
                  {createNeighborRequest.isPending ? (
                    <ActivityIndicator size="small" color={Colors.zinc400} />
                  ) : (
                    <Feather name="user-plus" size={16} color={Colors.zinc700} />
                  )}
                  <Text style={styles.profileActionText}>이웃 신청하기</Text>
                </ScalePressable>
              )}

              {isOwner && (
                <ScalePressable
                  style={[styles.profileActionButton, styles.profileKickButton]}
                  onPress={() => {
                    setMemberTarget(null);
                    setKickTarget({ id: memberTarget.id, nickname: memberTarget.nickname });
                  }}
                >
                  <Feather name="user-x" size={16} color="#DC2626" />
                  <Text style={[styles.profileActionText, styles.profileKickText]}>추방하기</Text>
                </ScalePressable>
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

      <NavBar />
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
  dateHeader: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 8,
  },
  dateHeaderText: {
    ...Typography.dateHeader,
    fontSize: 15,
    color: Colors.noticeAccent,
  },
  articleItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    backgroundColor: Colors.white,
  },
  articleItemIndent: {
    paddingLeft: Spacing.screenPx + 20,
  },
  articleInfo: {
    flex: 1,
    gap: 2,
  },
  articleTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  articleTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
    flex: 1,
  },
  noticeOfDayBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: Colors.noticeAccentSoft,
  },
  noticeOfDayBadgeText: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "600" as const,
    color: Colors.noticeAccent,
  },
  unreadBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: Colors.noticeAccentSoft,
  },
  unreadBadgeText: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "700" as const,
    color: Colors.noticeAccent,
  },
  myArticleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: Colors.zinc200,
  },
  myArticleBadgeText: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "600" as const,
    color: Colors.zinc500,
  },
  articleDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  deletedPlaceholder: {
    backgroundColor: Colors.zinc50,
  },
  deletedPlaceholderText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
    fontStyle: "italic",
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
  manageSheetContent: {
    paddingVertical: 8,
  },
  manageSheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 4,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  manageSheetLabel: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc800,
  },
  inviteContent: {
    paddingVertical: 12,
    flex: 1,
    gap: 12,
  },
  inviteEmptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
  },
  inviteEmptyText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
    textAlign: "center",
  },
  inviteResultList: {
    flex: 1,
  },
  inviteResultItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 12,
  },
  inviteAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteAvatarText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc600,
  },
  inviteUserInfo: {
    flex: 1,
    gap: 2,
  },
  inviteNickname: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  inviteEmail: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
});
