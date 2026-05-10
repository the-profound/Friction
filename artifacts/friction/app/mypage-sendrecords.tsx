import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import RefreshableEmpty from "@/components/RefreshableEmpty";
import { Colors, Spacing, Typography } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import { formatDeliveryTime } from "@/lib/deliverySync";
import { useListSendRecords } from "@workspace/api-client-react";
import type { SendRecordWithDetails } from "@workspace/api-client-react";

export default function MyPageSendRecordsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();

  const sendRecordsQuery = useListSendRecords({ senderId: userId });
  const sendRecords = (sendRecordsQuery.data ?? []) as SendRecordWithDetails[];

  const sortedRecords = useMemo(
    () =>
      [...sendRecords].sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
      ),
    [sendRecords],
  );

  const handleArticlePress = (articleId: string) => {
    router.push({ pathname: "/read", params: { articleId, mode: "re_read" } });
  };

  const renderItem = ({ item }: { item: SendRecordWithDetails }) => {
    const isGroup = item.targetType === "group";
    const targetLabel = isGroup ? "단체 모음" : "개인";
    const recipientDisplay = isGroup
      ? (item.collectionName ?? "단체 모음")
      : (item.recipient?.nickname ?? "알 수 없음");
    return (
      <Pressable style={styles.listItem} onPress={() => handleArticlePress(item.articleId)}>
        <View style={styles.listItemInfo}>
          <View style={styles.recordTitleRow}>
            <Text style={[styles.listItemTitle, styles.recordTitleFlex]} numberOfLines={1}>
              {item.article?.title ?? "제목 없음"}
            </Text>
            <View style={[styles.typeBadge, isGroup ? styles.groupTypeBadge : styles.personTypeBadge]}>
              <Text style={[styles.typeBadgeText, isGroup ? styles.groupTypeBadgeText : styles.personTypeBadgeText]}>
                {targetLabel}
              </Text>
            </View>
            <View
              style={[
                styles.deliveryBadge,
                item.isDelivered ? styles.deliveredBadge : styles.pendingBadge,
              ]}
            >
              <Text
                style={[
                  styles.deliveryBadgeText,
                  item.isDelivered ? styles.deliveredBadgeText : styles.pendingBadgeText,
                ]}
              >
                {item.isDelivered ? "수신됨" : "배달 전"}
              </Text>
            </View>
          </View>
          <Text style={styles.listItemSub}>
            → {recipientDisplay} · {formatDeliveryTime(new Date(item.deliverySlot))}
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={Colors.zinc300} />
      </Pressable>
    );
  };

  const renderContent = () => {
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

    if (sortedRecords.length === 0) {
      return (
        <RefreshableEmpty
          refreshing={sendRecordsQuery.isRefetching}
          onRefresh={() => sendRecordsQuery.refetch()}
          contentContainerStyle={styles.emptyContainer}
        >
          <Feather name="send" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>보낸 편지가 없어요</Text>
          <Text style={styles.emptySubtitle}>편지를 보내면 여기에 기록돼요</Text>
        </RefreshableEmpty>
      );
    }

    return (
      <FlatList
        data={sortedRecords}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
          <Feather name="chevron-left" size={24} color={Colors.zinc700} />
        </Pressable>
        <Text style={styles.headerTitle}>발신 목록</Text>
        <View style={styles.headerSpacer} />
      </View>
      {renderContent()}
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
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    backgroundColor: Colors.white,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  headerSpacer: {
    width: 36,
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
  listContent: {
    paddingBottom: 32,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 12,
    backgroundColor: Colors.white,
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
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: "center",
  },
  personTypeBadge: {
    backgroundColor: Colors.zinc100,
  },
  groupTypeBadge: {
    backgroundColor: "#EDE9FE",
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  personTypeBadgeText: {
    color: Colors.zinc500,
  },
  groupTypeBadgeText: {
    color: "#5B21B6",
  },
});
