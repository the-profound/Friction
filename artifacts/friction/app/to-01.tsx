import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Alert, RefreshControl, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import {
  useListNeighbors,
  useListNeighborRequests,
  useAcceptNeighborRequest,
  useRejectNeighborRequest,
  useCreateNeighborRequest,
} from "@workspace/api-client-react";
import type {
  NeighborWithUser,
  NeighborRequestWithUser,
} from "@workspace/api-client-react";

type Tab = "neighbors" | "requests";

export default function NeighborListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();
  const [activeTab, setActiveTab] = useState<Tab>("neighbors");
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [addRecipientId, setAddRecipientId] = useState("");
  const [rejectTarget, setRejectTarget] = useState<{ id: string; name: string } | null>(null);

  const neighborsQuery = useListNeighbors({ userId });
  const neighbors = (neighborsQuery.data ?? []) as NeighborWithUser[];
  const requestsQuery = useListNeighborRequests({ recipientId: userId });
  const pendingRequests = (requestsQuery.data ?? []) as NeighborRequestWithUser[];
  const acceptRequest = useAcceptNeighborRequest();
  const rejectRequest = useRejectNeighborRequest();
  const createRequest = useCreateNeighborRequest();

  const handleAccept = useCallback(
    async (requestId: string) => {
      try {
        await acceptRequest.mutateAsync({ id: requestId });
        requestsQuery.refetch();
        neighborsQuery.refetch();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "수락에 실패했습니다.";
        Alert.alert("오류", msg);
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
        const msg = e instanceof Error ? e.message : "거절에 실패했습니다.";
        Alert.alert("오류", msg);
      }
    },
    [rejectRequest, requestsQuery],
  );

  const handleSendRequest = useCallback(async () => {
    if (!addRecipientId.trim()) {
      Alert.alert("오류", "이웃의 ID를 입력해주세요.");
      return;
    }
    try {
      await createRequest.mutateAsync({
        data: { requesterId: userId, recipientId: addRecipientId.trim() },
      });
      setAddSheetVisible(false);
      setAddRecipientId("");
      Alert.alert("완료", "이웃 요청을 보냈어요!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "요청에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [addRecipientId, userId, createRequest]);

  const renderNeighborItem = ({ item }: { item: NeighborWithUser }) => (
    <View style={styles.neighborItem}>
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarText}>{(item.user?.nickname ?? "?")[0]}</Text>
      </View>
      <View style={styles.neighborInfo}>
        <Text style={styles.neighborName}>{item.user?.nickname ?? "이름 없음"}</Text>
        <Text style={styles.neighborSub}>{item.user?.email ?? ""}</Text>
      </View>
    </View>
  );

  const renderRequestItem = ({ item }: { item: NeighborRequestWithUser }) => (
    <View style={styles.requestItem}>
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarText}>{(item.requester?.nickname ?? "?")[0]}</Text>
      </View>
      <View style={styles.neighborInfo}>
        <Text style={styles.neighborName}>{item.requester?.nickname ?? "알 수 없음"}</Text>
        <Text style={styles.neighborSub}>이웃 요청</Text>
      </View>
      <View style={styles.requestActions}>
        <Pressable
          style={[styles.acceptButton, acceptRequest.isPending && styles.buttonDisabled]}
          onPress={() => handleAccept(item.id)}
          disabled={acceptRequest.isPending || rejectRequest.isPending}
        >
          <Text style={styles.acceptText}>{acceptRequest.isPending ? "처리 중..." : "수락"}</Text>
        </Pressable>
        <Pressable
          style={[styles.rejectButton, rejectRequest.isPending && styles.buttonDisabled]}
          onPress={() => setRejectTarget({ id: item.id, name: item.requester?.nickname ?? "알 수 없음" })}
          disabled={acceptRequest.isPending || rejectRequest.isPending}
        >
          <Text style={styles.rejectText}>거절</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>이웃 관리</Text>
        <Pressable hitSlop={12} onPress={() => { setAddRecipientId(""); setAddSheetVisible(true); }}>
          <Feather name="user-plus" size={20} color={Colors.zinc600} />
        </Pressable>
      </View>

      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tab, activeTab === "neighbors" && styles.tabActive]}
          onPress={() => setActiveTab("neighbors")}
        >
          <Text style={[styles.tabText, activeTab === "neighbors" && styles.tabTextActive]}>
            이웃 ({neighbors.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === "requests" && styles.tabActive]}
          onPress={() => setActiveTab("requests")}
        >
          <Text style={[styles.tabText, activeTab === "requests" && styles.tabTextActive]}>
            요청 ({pendingRequests.length})
          </Text>
        </Pressable>
      </View>

      {activeTab === "neighbors" ? (
        neighborsQuery.isLoading ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.loadingText}>불러오는 중...</Text>
          </View>
        ) : neighborsQuery.isError ? (
          <View style={styles.emptyContainer}>
            <Feather name="alert-circle" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>불러오기 실패</Text>
            <Pressable style={styles.addButton} onPress={() => neighborsQuery.refetch()}>
              <Text style={styles.addButtonText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : neighbors.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Feather name="users" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>아직 이웃이 없어요</Text>
            <Text style={styles.emptySubtitle}>고유 ID로 이웃을 추가해보세요</Text>
            <Pressable style={styles.addButton} onPress={() => { setAddRecipientId(""); setAddSheetVisible(true); }}>
              <Text style={styles.addButtonText}>이웃 추가</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={neighbors}
            keyExtractor={(item) => item.id}
            renderItem={renderNeighborItem}
            contentContainerStyle={styles.listContent}
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
      ) : requestsQuery.isLoading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      ) : requestsQuery.isError ? (
        <View style={styles.emptyContainer}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기 실패</Text>
          <Pressable style={styles.addButton} onPress={() => requestsQuery.refetch()}>
            <Text style={styles.addButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : pendingRequests.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Feather name="bell" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>대기 중인 요청이 없어요</Text>
          <Text style={styles.emptySubtitle}>이웃 요청이 오면 여기에 표시돼요</Text>
        </View>
      ) : (
        <FlatList
          data={pendingRequests}
          keyExtractor={(item) => item.id}
          renderItem={renderRequestItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={requestsQuery.isRefetching}
              onRefresh={() => requestsQuery.refetch()}
              tintColor={Colors.zinc400}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <BottomSheet
        visible={addSheetVisible}
        onClose={() => setAddSheetVisible(false)}
        title="이웃 추가"
        snapPoints={[0.35]}
      >
        <View style={styles.formContent}>
          <TextInput
            style={styles.formInput}
            placeholder="이웃의 사용자 ID를 입력하세요"
            placeholderTextColor={Colors.zinc400}
            value={addRecipientId}
            onChangeText={setAddRecipientId}
            autoFocus
            autoCapitalize="none"
          />
          <Pressable
            style={[styles.formButton, !addRecipientId.trim() && styles.formButtonDisabled]}
            onPress={handleSendRequest}
            disabled={!addRecipientId.trim()}
          >
            <Text style={styles.formButtonText}>요청 보내기</Text>
          </Pressable>
        </View>
      </BottomSheet>

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
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  listContent: {
    paddingBottom: 40,
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
  formButton: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  formButtonDisabled: {
    backgroundColor: Colors.zinc300,
  },
  formButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
