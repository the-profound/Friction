import React, { useCallback, useState, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { useNavigation } from "@/contexts/NavigationContext";
import { useUser } from "@/contexts/UserContext";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import {
  useListNeighbors,
  useListNeighborRequests,
  useListSendRecords,
} from "@workspace/api-client-react";
import type {
  NeighborWithUser,
  NeighborRequestWithUser,
  SendRecordWithDetails,
} from "@workspace/api-client-react";
import { formatDeliveryTime } from "@/lib/deliverySync";

interface NeighborProfileTarget {
  nickname: string;
  email: string;
  id: string;
  joinedAt?: string;
}

export default function ToScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { toSubTab } = useNavigation();
  const { userId } = useUser();
  const [profileTarget, setProfileTarget] = useState<NeighborProfileTarget | null>(null);

  const neighborsQuery = useListNeighbors({ userId });
  const neighbors = (neighborsQuery.data ?? []) as NeighborWithUser[];
  const requestsQuery = useListNeighborRequests({ recipientId: userId });
  const pendingRequests = (requestsQuery.data ?? []) as NeighborRequestWithUser[];
  const sendRecordsQuery = useListSendRecords({ senderId: userId });
  const sendRecords = (sendRecordsQuery.data ?? []) as SendRecordWithDetails[];

  const recentSendRecords = useMemo(
    () => [...sendRecords].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()).slice(0, 5),
    [sendRecords],
  );

  const handleAddNeighbor = useCallback(() => {
    router.push("/to-01");
  }, [router]);

  const handleSend = useCallback(() => {
    router.push("/to-02");
  }, [router]);

  const handleViewHistory = useCallback(() => {
    router.push("/to-03");
  }, [router]);

  const handleArticlePress = useCallback(
    (articleId: string) => {
      router.push({ pathname: "/read", params: { articleId, mode: "re_read" } });
    },
    [router],
  );

  const handleNeighborPress = useCallback((item: NeighborWithUser) => {
    setProfileTarget({
      nickname: item.user?.nickname ?? "이름 없음",
      email: item.user?.email ?? "",
      id: item.neighborUserId,
      joinedAt: item.acceptedAt ? new Date(item.acceptedAt).toLocaleDateString("ko-KR") : undefined,
    });
  }, []);

  const renderNeighborItem = ({ item }: { item: NeighborWithUser }) => (
    <Pressable style={styles.listItem} onPress={() => handleNeighborPress(item)}>
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarText}>{(item.user?.nickname ?? "?")[0]}</Text>
      </View>
      <View style={styles.listItemInfo}>
        <Text style={styles.listItemTitle}>{item.user?.nickname ?? "이름 없음"}</Text>
        <Text style={styles.listItemSub}>{item.user?.email ?? ""}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={Colors.zinc300} />
    </Pressable>
  );

  const renderSendRecordItem = ({ item }: { item: SendRecordWithDetails }) => (
    <Pressable style={styles.listItem} onPress={() => handleArticlePress(item.articleId)}>
      <View style={styles.listItemInfo}>
        <View style={styles.recordTitleRow}>
          <Text style={[styles.listItemTitle, styles.recordTitleFlex]} numberOfLines={1}>
            {item.article?.title ?? "제목 없음"}
          </Text>
          <View style={[styles.deliveryBadge, item.isDelivered ? styles.deliveredBadge : styles.pendingBadge]}>
            <Text style={[styles.deliveryBadgeText, item.isDelivered ? styles.deliveredBadgeText : styles.pendingBadgeText]}>
              {item.isDelivered ? "수신됨" : "배달 전"}
            </Text>
          </View>
        </View>
        <Text style={styles.listItemSub}>
          → {item.recipient?.nickname ?? "알 수 없음"} · {formatDeliveryTime(new Date(item.deliverySlot))}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={Colors.zinc300} />
    </Pressable>
  );

  const renderNeighborsTab = () => {
    if (neighborsQuery.isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      );
    }

    if (neighborsQuery.isError) {
      return (
        <View style={styles.emptyContainer}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기 실패</Text>
          <Text style={styles.emptySubtitle}>네트워크를 확인하고 다시 시도해주세요</Text>
          <Pressable style={styles.actionButton} onPress={() => { neighborsQuery.refetch(); requestsQuery.refetch(); }}>
            <Feather name="refresh-cw" size={16} color={Colors.white} />
            <Text style={styles.actionButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.tabContent}>
        {pendingRequests.length > 0 && (
          <Pressable style={styles.requestBanner} onPress={handleAddNeighbor}>
            <Feather name="bell" size={16} color="#D97706" />
            <Text style={styles.requestBannerText}>
              대기 중인 이웃 요청 {pendingRequests.length}건
            </Text>
            <Feather name="chevron-right" size={16} color={Colors.zinc400} />
          </Pressable>
        )}

        {neighbors.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Feather name="users" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>이웃이 없어요</Text>
            <Text style={styles.emptySubtitle}>편지를 주고받을 이웃을 추가해보세요</Text>
            <Pressable style={styles.actionButton} onPress={handleAddNeighbor}>
              <Feather name="user-plus" size={16} color={Colors.white} />
              <Text style={styles.actionButtonText}>이웃 관리</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={neighbors}
            keyExtractor={(item) => item.id}
            renderItem={renderNeighborItem}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>이웃 {neighbors.length}명</Text>
                <Pressable onPress={handleAddNeighbor}>
                  <Text style={styles.moreLink}>관리</Text>
                </Pressable>
              </View>
            }
            refreshControl={
              <RefreshControl
                refreshing={neighborsQuery.isRefetching}
                onRefresh={() => { neighborsQuery.refetch(); requestsQuery.refetch(); }}
                tintColor={Colors.zinc400}
              />
            }
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    );
  };

  const renderHistoryTab = () => {
    if (sendRecordsQuery.isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      );
    }

    if (sendRecordsQuery.isError) {
      return (
        <View style={styles.emptyContainer}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기 실패</Text>
          <Text style={styles.emptySubtitle}>네트워크를 확인하고 다시 시도해주세요</Text>
          <Pressable style={styles.actionButton} onPress={() => sendRecordsQuery.refetch()}>
            <Feather name="refresh-cw" size={16} color={Colors.white} />
            <Text style={styles.actionButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      );
    }

    if (sendRecords.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Feather name="send" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>보낸 편지가 없어요</Text>
          <Text style={styles.emptySubtitle}>편지를 보내면 여기에 기록돼요</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={recentSendRecords}
        keyExtractor={(item) => item.id}
        renderItem={renderSendRecordItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>최근 발신 {sendRecords.length}건</Text>
            <Pressable onPress={handleViewHistory}>
              <Text style={styles.moreLink}>전체 보기</Text>
            </Pressable>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={sendRecordsQuery.isRefetching}
            onRefresh={() => sendRecordsQuery.refetch()}
            tintColor={Colors.zinc400}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    );
  };

  const renderSendTab = () => (
    <View style={styles.emptyContainer}>
      <Feather name="send" size={40} color={Colors.zinc300} />
      <Text style={styles.emptyTitle}>편지 보내기</Text>
      <Text style={styles.emptySubtitle}>완성된 편지를 이웃에게 보내보세요</Text>
      <Pressable style={styles.actionButton} onPress={handleSend}>
        <Feather name="send" size={16} color={Colors.white} />
        <Text style={styles.actionButtonText}>보내기</Text>
      </Pressable>
    </View>
  );

  const renderContent = () => {
    switch (toSubTab) {
      case "neighbors":
        return renderNeighborsTab();
      case "history":
        return renderHistoryTab();
      case "send":
        return renderSendTab();
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="발신함"
        showSearch={false}
      />
      {renderContent()}

      <BottomSheet
        visible={profileTarget !== null}
        onClose={() => setProfileTarget(null)}
        title="이웃 프로필"
        snapPoints={[0.42]}
      >
        {profileTarget && (
          <View style={styles.profileContent}>
            <View style={styles.profileAvatarLarge}>
              <Text style={styles.profileAvatarLargeText}>{profileTarget.nickname[0]}</Text>
            </View>
            <Text style={styles.profileName}>{profileTarget.nickname}</Text>
            <Text style={styles.profileEmail}>{profileTarget.email}</Text>
            {profileTarget.joinedAt && (
              <Text style={styles.profileJoined}>이웃이 된 날: {profileTarget.joinedAt}</Text>
            )}
            <View style={styles.profileIdRow}>
              <Text style={styles.profileIdLabel}>ID</Text>
              <Text style={styles.profileIdValue} selectable>{profileTarget.id}</Text>
            </View>
          </View>
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  tabContent: {
    flex: 1,
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
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.zinc900,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  actionButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
  requestBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: Spacing.screenPx,
    marginVertical: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FEF3C7",
    borderRadius: 12,
  },
  requestBannerText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: "#92400E",
    flex: 1,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
  },
  summaryLabel: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  moreLink: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  listContent: {
    paddingBottom: Spacing.navBarPaddingBottom,
  },
  listItem: {
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
  listItemInfo: {
    flex: 1,
    gap: 2,
  },
  listItemTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  listItemSub: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  recordTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  recordTitleFlex: {
    flexShrink: 1,
  },
  deliveryBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: "center",
  },
  deliveredBadge: {
    backgroundColor: "#D1FAE5",
  },
  pendingBadge: {
    backgroundColor: Colors.zinc100,
  },
  deliveryBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  deliveredBadgeText: {
    color: "#065F46",
  },
  pendingBadgeText: {
    color: Colors.zinc500,
  },
  profileContent: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 20,
    gap: 4,
  },
  profileAvatarLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  profileAvatarLargeText: {
    ...Typography.bodySemiBold,
    fontSize: 26,
    color: Colors.zinc500,
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
    marginBottom: 4,
  },
  profileJoined: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
    marginTop: 4,
  },
  profileIdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  profileIdLabel: {
    ...Typography.bodySemiBold,
    fontSize: 12,
    color: Colors.zinc400,
  },
  profileIdValue: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc500,
  },
});
