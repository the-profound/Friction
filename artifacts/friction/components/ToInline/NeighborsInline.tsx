import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { Colors, Sizing, Spacing, Typography } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useUser } from "@/contexts/UserContext";
import {
  INCOMING_FALLBACK_POLL_INTERVAL_MS,
  useFocusPollingOptions,
  isQueryStale,
} from "@/lib/useScreenFocused";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "@/lib/useRealtimeChannel";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import {
  ApiError,
  useAcceptNeighborRequest,
  useCreateNeighborRequest,
  useDeleteNeighborRequest,
  useListNeighborRequests,
  useListNeighbors,
  useRejectNeighborRequest,
  useRemoveNeighbor,
  useSearchUsersByNickname,
  getListNeighborsQueryKey,
  getListNeighborRequestsQueryKey,
} from "@workspace/api-client-react";
import type {
  NeighborRequestWithUser,
  NeighborWithUser,
  UserSearchResult,
} from "@workspace/api-client-react";

/**
 * Surface server-side validation messages from ApiError when present, falling
 * back to the generic Error message and finally a caller-provided default.
 */
function describeApiError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const data = e.data as { error?: string; message?: string } | null;
    if (data?.error) return data.error;
    if (data?.message) return data.message;
    if (e.message) return e.message;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

type SectionKey = "neighbors" | "requests" | "sent";

interface ProfileTarget {
  nickname: string;
  email: string;
  id: string;
  joinedAt?: string;
}

interface NeighborsInlineProps {
  initialSection?: SectionKey;
  /** Bumps when an external trigger (e.g. parent screen) wants to focus the requests section. */
  focusRequestsSignal?: number;
}

export function NeighborsInline({
  initialSection = "neighbors",
  focusRequestsSignal,
}: NeighborsInlineProps) {
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<SectionKey>(initialSection);
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [rejectTarget, setRejectTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);
  const [sendingToUserId, setSendingToUserId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (focusRequestsSignal !== undefined) {
      setActiveSection("requests");
    }
  }, [focusRequestsSignal]);

  // Realtime subscriptions push neighbor + request updates within sub-second
  // latency; the slower focus-gated poll (60s) stays as a safety net for
  // environments where the realtime channel is unavailable.
  const pollOpts = useFocusPollingOptions(INCOMING_FALLBACK_POLL_INTERVAL_MS);
  const neighborsQuery = useListNeighbors({ userId }, pollOpts);
  const neighbors = (neighborsQuery.data ?? []) as NeighborWithUser[];
  const requestsQuery = useListNeighborRequests({ recipientId: userId }, pollOpts);
  const pendingRequests = (requestsQuery.data ?? []) as NeighborRequestWithUser[];
  const sentRequestsQuery = useListNeighborRequests({ requesterId: userId }, pollOpts);
  const sentRequests = (sentRequestsQuery.data ?? []) as NeighborRequestWithUser[];

  // Watch the neighbors table for both pair orderings (user_a / user_b) so
  // any new accepted neighbor relationship surfaces immediately regardless of
  // which side the row was inserted from.
  useRealtimeChannel(
    userId ? `neighbors:${userId}` : null,
    [
      { table: "neighbors", filter: `user_a_id=eq.${userId}` },
      { table: "neighbors", filter: `user_b_id=eq.${userId}` },
      { table: "neighbor_requests", filter: `recipient_id=eq.${userId}` },
      { table: "neighbor_requests", filter: `requester_id=eq.${userId}` },
    ],
    () => {
      neighborsQuery.refetch();
      requestsQuery.refetch();
      sentRequestsQuery.refetch();
    },
  );

  const acceptRequest = useAcceptNeighborRequest();
  const rejectRequest = useRejectNeighborRequest();
  const createRequest = useCreateNeighborRequest();
  const removeNeighbor = useRemoveNeighbor();
  const deleteNeighborRequest = useDeleteNeighborRequest();

  const searchResults = useSearchUsersByNickname(debouncedQuery, userId);

  // Refetch on focus ONLY if cached data is stale. Realtime subscriptions
  // handle near-instant updates; the stale check prevents loading spinners
  // and scroll jumps on quick tab switches.
  const refetchNeighbors = neighborsQuery.refetch;
  const refetchRequests = requestsQuery.refetch;
  const refetchSentRequests = sentRequestsQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      if (isQueryStale(queryClient, getListNeighborsQueryKey({ userId }))) {
        refetchNeighbors();
      }
      if (isQueryStale(queryClient, getListNeighborRequestsQueryKey({ recipientId: userId }))) {
        refetchRequests();
      }
      if (isQueryStale(queryClient, getListNeighborRequestsQueryKey({ requesterId: userId }))) {
        refetchSentRequests();
      }
    }, [refetchNeighbors, refetchRequests, refetchSentRequests, queryClient, userId]),
  );

  const handleAccept = useCallback(
    async (requestId: string) => {
      try {
        await acceptRequest.mutateAsync({ id: requestId });
        requestsQuery.refetch();
        neighborsQuery.refetch();
      } catch (e: unknown) {
        Alert.alert("오류", describeApiError(e, "수락에 실패했습니다."));
      }
    },
    [acceptRequest, requestsQuery, neighborsQuery],
  );

  const handleReject = useCallback(
    async (requestId: string) => {
      try {
        await rejectRequest.mutateAsync({ id: requestId });
        requestsQuery.refetch();
      } catch (e: unknown) {
        Alert.alert("오류", describeApiError(e, "거절에 실패했습니다."));
      }
    },
    [rejectRequest, requestsQuery],
  );

  const handleSendRequestToUser = useCallback(
    async (targetUser: UserSearchResult) => {
      if (targetUser.status !== "none") return;
      setSendingToUserId(targetUser.id);
      try {
        await createRequest.mutateAsync({
          data: { requesterId: userId, recipientId: targetUser.id },
        });
        searchResults.refetch();
        sentRequestsQuery.refetch();
        Alert.alert("완료", `${targetUser.nickname}님께 이웃 요청을 보냈어요!`);
      } catch (e: unknown) {
        const isDuplicate =
          e instanceof ApiError &&
          typeof e.data === "object" &&
          e.data !== null &&
          "error" in e.data &&
          ((e.data as { error?: string }).error === "Already neighbors" ||
            (e.data as { error?: string }).error === "Request already exists");
        if (isDuplicate) {
          searchResults.refetch();
          sentRequestsQuery.refetch();
        } else {
          Alert.alert("오류", describeApiError(e, "요청에 실패했습니다."));
        }
      } finally {
        setSendingToUserId(null);
      }
    },
    [userId, createRequest, searchResults, sentRequestsQuery],
  );

  const handleCancelRequest = useCallback(
    async (requestId: string) => {
      if (deleteNeighborRequest.isPending) return;
      try {
        await deleteNeighborRequest.mutateAsync({ id: requestId });
        searchResults.refetch();
        sentRequestsQuery.refetch();
      } catch (e: unknown) {
        Alert.alert("오류", describeApiError(e, "요청 취소에 실패했습니다."));
      } finally {
        setCancelTarget(null);
      }
    },
    [deleteNeighborRequest, searchResults, sentRequestsQuery],
  );

  const handleNeighborPress = useCallback((item: NeighborWithUser) => {
    setProfileTarget({
      nickname: item.user?.nickname ?? "이름 없음",
      email: item.user?.email ?? "",
      id: item.neighborUserId,
      joinedAt: item.acceptedAt ? new Date(item.acceptedAt).toLocaleDateString("ko-KR") : undefined,
    });
  }, []);

  const handleDeleteNeighborConfirm = useCallback(async () => {
    if (!deleteTarget || removeNeighbor.isPending) return;
    try {
      await removeNeighbor.mutateAsync({ id: deleteTarget.id });
      neighborsQuery.refetch();
    } catch (e: unknown) {
      Alert.alert("오류", describeApiError(e, "삭제에 실패했습니다."));
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, removeNeighbor, neighborsQuery]);

  const handleAddSheetClose = useCallback(() => {
    setAddSheetVisible(false);
    setSearchQuery("");
    setDebouncedQuery("");
  }, []);

  const renderNeighborItem = ({ item }: { item: NeighborWithUser }) => (
    <Pressable style={styles.neighborItem} onPress={() => handleNeighborPress(item)}>
      <View style={styles.avatarCircle}>
        <Feather name="user" size={18} color={Colors.zinc500} />
      </View>
      <View style={styles.neighborInfo}>
        <Text style={styles.neighborName}>{item.user?.nickname ?? "이름 없음"}</Text>
        <Text style={styles.neighborSub}>{item.user?.email ?? ""}</Text>
      </View>
      <Pressable
        style={styles.deleteButton}
        onPress={(e) => {
          e.stopPropagation?.();
          setDeleteTarget({ id: item.id, name: item.user?.nickname ?? "이름 없음" });
        }}
        hitSlop={8}
      >
        <Feather name="trash-2" size={16} color="#ef4444" />
      </Pressable>
    </Pressable>
  );

  const renderRequestItem = ({ item }: { item: NeighborRequestWithUser }) => (
    <View style={styles.requestItem}>
      <View style={styles.avatarCircle}>
        <Feather name="user" size={18} color={Colors.zinc500} />
      </View>
      <View style={styles.neighborInfo}>
        <Text style={styles.neighborName}>{item.requester?.nickname ?? "알 수 없음"}</Text>
        <Text style={styles.neighborSub}>이웃 요청</Text>
      </View>
      <View style={styles.requestActions}>
        <SubmitButton
          style={styles.acceptButton}
          disabledStyle={styles.buttonDisabled}
          textStyle={styles.acceptText}
          onPress={() => handleAccept(item.id)}
          pending={acceptRequest.isPending}
          disabled={rejectRequest.isPending}
          label="수락"
          pendingLabel="처리 중..."
        />
        <SubmitButton
          style={styles.rejectButton}
          disabledStyle={styles.buttonDisabled}
          textStyle={styles.rejectText}
          onPress={() =>
            setRejectTarget({ id: item.id, name: item.requester?.nickname ?? "알 수 없음" })
          }
          pending={rejectRequest.isPending}
          disabled={acceptRequest.isPending}
          label="거절"
          pendingLabel="처리 중..."
        />
      </View>
    </View>
  );

  const renderSentRequestItem = ({ item }: { item: NeighborRequestWithUser }) => (
    <View style={styles.requestItem}>
      <View style={styles.avatarCircle}>
        <Feather name="user" size={18} color={Colors.zinc500} />
      </View>
      <View style={styles.neighborInfo}>
        <Text style={styles.neighborName}>{item.recipient?.nickname ?? "알 수 없음"}</Text>
        <Text style={styles.neighborSub}>보낸 이웃 요청</Text>
      </View>
      <Pressable
        style={styles.rejectButton}
        onPress={() =>
          setCancelTarget({ id: item.id, name: item.recipient?.nickname ?? "알 수 없음" })
        }
      >
        <Text style={styles.rejectText}>취소</Text>
      </Pressable>
    </View>
  );

  const renderSearchResultItem = ({ item }: { item: UserSearchResult }) => {
    const isSending = sendingToUserId === item.id;
    const isPending = item.status === "pending";
    const isNeighbor = item.status === "neighbor";
    const isDisabled = isNeighbor || isSending;

    const handlePress = () => {
      if (isPending && item.requestId) {
        setCancelTarget({ id: item.requestId, name: item.nickname });
      } else if (item.status === "none") {
        handleSendRequestToUser(item);
      }
    };

    return (
      <Pressable
        style={[styles.searchResultItem, isDisabled && styles.searchResultDisabled]}
        onPress={handlePress}
        onLongPress={
          isPending && item.requestId
            ? () => setCancelTarget({ id: item.requestId!, name: item.nickname })
            : undefined
        }
        delayLongPress={1000}
        disabled={isDisabled}
      >
        <View style={styles.avatarCircle}>
          <Feather name="user" size={18} color={Colors.zinc500} />
        </View>
        <View style={styles.neighborInfo}>
          <Text style={[styles.neighborName, isDisabled && styles.textMuted]}>{item.nickname}</Text>
          <Text style={styles.neighborSub}>{item.email}</Text>
        </View>
        {isSending ? (
          <ActivityIndicator size="small" color={Colors.zinc400} />
        ) : item.status === "neighbor" ? (
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>이웃</Text>
          </View>
        ) : item.status === "pending" ? (
          <View style={[styles.statusBadge, styles.statusBadgePending]}>
            <Text style={[styles.statusBadgeText, styles.statusBadgePendingText]}>요청 중</Text>
          </View>
        ) : (
          <Feather name="user-plus" size={18} color={Colors.zinc400} />
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.sectionTabBar}>
        <Pressable
          style={[styles.sectionTab, activeSection === "neighbors" && styles.sectionTabActive]}
          onPress={() => setActiveSection("neighbors")}
        >
          <Text
            style={[
              styles.sectionTabText,
              activeSection === "neighbors" && styles.sectionTabTextActive,
            ]}
          >
            이웃 ({neighbors.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.sectionTab, activeSection === "requests" && styles.sectionTabActive]}
          onPress={() => setActiveSection("requests")}
        >
          <Text
            style={[
              styles.sectionTabText,
              activeSection === "requests" && styles.sectionTabTextActive,
            ]}
          >
            받은 요청 ({pendingRequests.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.sectionTab, activeSection === "sent" && styles.sectionTabActive]}
          onPress={() => setActiveSection("sent")}
        >
          <Text
            style={[
              styles.sectionTabText,
              activeSection === "sent" && styles.sectionTabTextActive,
            ]}
          >
            보낸 요청 ({sentRequests.length})
          </Text>
        </Pressable>
      </View>

      {activeSection === "neighbors" ? (
        neighborsQuery.isLoading ? (
          <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
            <Text style={styles.loadingText}>불러오는 중...</Text>
          </View>
        ) : neighborsQuery.isError ? (
          <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
            <Feather name="alert-circle" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>불러오기 실패</Text>
            <Text style={styles.emptySubtitle}>네트워크를 확인하고 다시 시도해주세요</Text>
            <Pressable style={styles.addButton} onPress={() => neighborsQuery.refetch()}>
              <Text style={styles.addButtonText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : neighbors.length === 0 ? (
          <RefreshableEmpty
            refreshing={neighborsQuery.isRefetching}
            onRefresh={() => neighborsQuery.refetch()}
            contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
          >
            <Feather name="users" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>아직 이웃이 없어요</Text>
            <Text style={styles.emptySubtitle}>닉네임으로 이웃을 찾아보세요</Text>
            <Pressable style={styles.addButton} onPress={() => setAddSheetVisible(true)}>
              <Text style={styles.addButtonText}>이웃 추가</Text>
            </Pressable>
          </RefreshableEmpty>
        ) : (
          <FlatList
            data={neighbors}
            keyExtractor={(item) => item.id}
            renderItem={renderNeighborItem}
            contentContainerStyle={[styles.listContent, { paddingBottom: navBottom }]}
            refreshControl={
              <RefreshControl
                refreshing={neighborsQuery.isRefetching}
                onRefresh={() => neighborsQuery.refetch()}
                tintColor={Colors.zinc400}
              />
            }
            showsVerticalScrollIndicator={false}
          />
        )
      ) : activeSection === "requests" ? (
        requestsQuery.isLoading ? (
          <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
            <Text style={styles.loadingText}>불러오는 중...</Text>
          </View>
        ) : requestsQuery.isError ? (
          <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
            <Feather name="alert-circle" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>불러오기 실패</Text>
            <Pressable style={styles.addButton} onPress={() => requestsQuery.refetch()}>
              <Text style={styles.addButtonText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : pendingRequests.length === 0 ? (
          <RefreshableEmpty
            refreshing={requestsQuery.isRefetching}
            onRefresh={() => requestsQuery.refetch()}
            contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
          >
            <Feather name="bell" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>대기 중인 요청이 없어요</Text>
            <Text style={styles.emptySubtitle}>이웃 요청이 오면 여기에 표시돼요</Text>
          </RefreshableEmpty>
        ) : (
          <FlatList
            data={pendingRequests}
            keyExtractor={(item) => item.id}
            renderItem={renderRequestItem}
            contentContainerStyle={[styles.listContent, { paddingBottom: navBottom }]}
            refreshControl={
              <RefreshControl
                refreshing={requestsQuery.isRefetching}
                onRefresh={() => requestsQuery.refetch()}
                tintColor={Colors.zinc400}
              />
            }
            showsVerticalScrollIndicator={false}
          />
        )
      ) : sentRequestsQuery.isLoading ? (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      ) : sentRequestsQuery.isError ? (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기 실패</Text>
          <Pressable style={styles.addButton} onPress={() => sentRequestsQuery.refetch()}>
            <Text style={styles.addButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : sentRequests.length === 0 ? (
        <RefreshableEmpty
          refreshing={sentRequestsQuery.isRefetching}
          onRefresh={() => sentRequestsQuery.refetch()}
          contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
        >
          <Feather name="send" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>보낸 요청이 없어요</Text>
          <Text style={styles.emptySubtitle}>이웃 추가 버튼으로 요청을 보내보세요</Text>
        </RefreshableEmpty>
      ) : (
        <FlatList
          data={sentRequests}
          keyExtractor={(item) => item.id}
          renderItem={renderSentRequestItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: navBottom }]}
          refreshControl={
            <RefreshControl
              refreshing={sentRequestsQuery.isRefetching}
              onRefresh={() => sentRequestsQuery.refetch()}
              tintColor={Colors.zinc400}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <BottomSheet
        visible={addSheetVisible}
        onClose={handleAddSheetClose}
        title="이웃 추가"
        snapPoints={[0.6]}
        keyboardAware
      >
        <View style={styles.searchContent}>
          <View style={styles.searchInputRow}>
            <Feather name="search" size={16} color={Colors.zinc400} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="닉네임으로 검색"
              placeholderTextColor={Colors.zinc400}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
              autoCapitalize="none"
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
                <Feather name="x" size={16} color={Colors.zinc400} />
              </Pressable>
            )}
          </View>

          {debouncedQuery.trim().length === 0 ? (
            <View style={styles.searchPlaceholder}>
              <Text style={styles.searchPlaceholderText}>닉네임을 입력하면 사용자가 검색됩니다</Text>
            </View>
          ) : searchResults.isLoading ? (
            <View style={styles.searchPlaceholder}>
              <ActivityIndicator size="small" color={Colors.zinc400} />
            </View>
          ) : searchResults.isError ? (
            <View style={styles.searchPlaceholder}>
              <Text style={styles.searchPlaceholderText}>검색 중 오류가 발생했어요</Text>
            </View>
          ) : (searchResults.data ?? []).length === 0 ? (
            <View style={styles.searchPlaceholder}>
              <Text style={styles.searchPlaceholderText}>검색 결과가 없어요</Text>
            </View>
          ) : (
            <FlatList
              data={searchResults.data}
              keyExtractor={(item) => item.id}
              renderItem={renderSearchResultItem}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      </BottomSheet>

      <ConfirmModal
        visible={deleteTarget !== null}
        title="이웃 삭제"
        description={`'${deleteTarget?.name ?? ""}'님을 이웃 목록에서 삭제할까요?`}
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleDeleteNeighborConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmModal
        visible={rejectTarget !== null}
        title="이웃 요청 거절"
        description={`'${rejectTarget?.name ?? ""}'님의 이웃 요청을 거절하시겠어요?`}
        confirmLabel="거절"
        cancelLabel="취소"
        destructive
        onConfirm={() => {
          if (rejectTarget) {
            handleReject(rejectTarget.id);
          }
          setRejectTarget(null);
        }}
        onCancel={() => setRejectTarget(null)}
      />

      <ConfirmModal
        visible={cancelTarget !== null}
        title="이웃 요청 취소"
        description={`'${cancelTarget?.name ?? ""}'님께 보낸 이웃 요청을 취소할까요?`}
        confirmLabel="취소하기"
        cancelLabel="아니요"
        destructive
        onConfirm={() => {
          if (cancelTarget) {
            handleCancelRequest(cancelTarget.id);
          }
        }}
        onCancel={() => setCancelTarget(null)}
      />

      <BottomSheet
        visible={profileTarget !== null}
        onClose={() => setProfileTarget(null)}
        title="이웃 프로필"
        snapPoints={[0.4]}
      >
        {profileTarget && (
          <View style={styles.profileContent}>
            <View style={styles.profileAvatarLarge}>
              <Feather name="user" size={36} color={Colors.zinc500} />
            </View>
            <Text style={styles.profileName}>{profileTarget.nickname}</Text>
            <Text style={styles.profileEmail}>{profileTarget.email}</Text>
            {profileTarget.joinedAt && (
              <Text style={styles.profileJoined}>이웃이 된 날: {profileTarget.joinedAt}</Text>
            )}
            <View style={styles.profileIdRow}>
              <Text style={styles.profileIdLabel}>ID</Text>
              <Text style={styles.profileIdValue} selectable>
                {profileTarget.id}
              </Text>
            </View>
          </View>
        )}
      </BottomSheet>

      <Pressable
        style={[styles.fab, { bottom: insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + Spacing.xl }]}
        onPress={() => setAddSheetVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="이웃 추가"
      >
        <Feather name="user-plus" size={20} color={Colors.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  sectionTabBar: {
    flexDirection: "row",
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 4,
    gap: 8,
    marginBottom: 8,
  },
  sectionTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.zinc50,
  },
  sectionTabActive: {
    backgroundColor: Colors.zinc900,
  },
  sectionTabText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
  },
  sectionTabTextActive: {
    color: Colors.white,
    fontWeight: "600",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: Spacing.navBarPaddingBottom,
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
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  listContent: {
    paddingBottom: Spacing.navBarPaddingBottom,
  },
  neighborItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 12,
  },
  deleteButton: {
    padding: 4,
    marginLeft: 2,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc600,
  },
  neighborInfo: {
    flex: 1,
    gap: 2,
  },
  neighborName: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  neighborSub: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  requestItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 12,
  },
  requestActions: {
    flexDirection: "row",
    gap: 8,
  },
  acceptButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.zinc900,
    borderRadius: 8,
  },
  acceptText: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.white,
  },
  rejectButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.zinc100,
    borderRadius: 8,
  },
  rejectText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  addButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
  },
  addButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  fab: {
    position: "absolute",
    right: Spacing.screenPx,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  searchContent: {
    flex: 1,
    paddingTop: 4,
  },
  searchInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    gap: 8,
  },
  searchIcon: {
    flexShrink: 0,
  },
  searchInput: {
    ...Typography.body,
    flex: 1,
    fontSize: 15,
    color: Colors.zinc900,
    padding: 0,
  },
  searchPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  searchPlaceholderText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
    textAlign: "center",
  },
  searchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  searchResultDisabled: {
    opacity: 0.6,
  },
  textMuted: {
    color: Colors.zinc500,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
  },
  statusBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.white,
  },
  statusBadgePending: {
    backgroundColor: Colors.zinc100,
  },
  statusBadgePendingText: {
    color: Colors.zinc500,
  },
  profileContent: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 8,
  },
  profileAvatarLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  profileAvatarLargeText: {
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
  profileJoined: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
    marginTop: 4,
  },
  profileIdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
  },
  profileIdLabel: {
    ...Typography.bodySemiBold,
    fontSize: 12,
    color: Colors.zinc500,
  },
  profileIdValue: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc600,
  },
});
