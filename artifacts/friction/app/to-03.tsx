import React, { useMemo, useCallback } from "react";
import { View, Text, StyleSheet, SectionList, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import { useListSendRecords } from "@workspace/api-client-react";
import type { SendRecordWithDetails } from "@workspace/api-client-react";
import { formatDeliveryTime } from "@/lib/deliverySync";

interface DateSection {
  title: string;
  data: SendRecordWithDetails[];
}

function formatSectionDate(dateStr: string): string {
  const parts = dateStr.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const target = new Date(year, month, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 7) return `${diffDays}일 전`;
  return `${year}.${String(month + 1).padStart(2, "0")}.${String(day).padStart(2, "0")}`;
}

export default function SendHistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();

  const sendRecordsQuery = useListSendRecords({ senderId: userId });
  const sendRecords = (sendRecordsQuery.data ?? []) as SendRecordWithDetails[];

  const sections: DateSection[] = useMemo(() => {
    const sorted = [...sendRecords].sort(
      (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
    );

    const map = new Map<string, SendRecordWithDetails[]>();
    for (const record of sorted) {
      const d = new Date(record.sentAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(record);
    }

    return Array.from(map.entries()).map(([dateKey, data]) => ({
      title: formatSectionDate(dateKey),
      data,
    }));
  }, [sendRecords]);

  const handleRecordPress = useCallback(
    (articleId: string) => {
      router.push({ pathname: "/read", params: { articleId, mode: "re_read" } });
    },
    [router],
  );

  const renderItem = ({ item }: { item: SendRecordWithDetails }) => (
    <Pressable style={styles.recordItem} onPress={() => handleRecordPress(item.articleId)}>
      <View style={styles.recordInfo}>
        <View style={styles.recordTitleRow}>
          <Text style={styles.recordTitle} numberOfLines={1}>
            {item.article?.title ?? "제목 없음"}
          </Text>
          <View style={[styles.deliveryBadge, item.isDelivered ? styles.deliveredBadge : styles.pendingBadge]}>
            <Text style={[styles.deliveryBadgeText, item.isDelivered ? styles.deliveredBadgeText : styles.pendingBadgeText]}>
              {item.isDelivered ? "수신됨" : "배달 전"}
            </Text>
          </View>
        </View>
        <Text style={styles.recordSub}>
          → {item.recipient?.nickname ?? "알 수 없음"} · {formatDeliveryTime(new Date(item.deliverySlot))}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={Colors.zinc300} />
    </Pressable>
  );

  const renderSectionHeader = ({ section }: { section: DateSection }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>발신 기록</Text>
        <View style={{ width: 20 }} />
      </View>

      {sendRecordsQuery.isLoading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      ) : sendRecordsQuery.isError ? (
        <View style={styles.emptyContainer}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기 실패</Text>
          <Text style={styles.emptySubtitle}>네트워크를 확인하고 다시 시도해주세요</Text>
          <Pressable style={styles.retryButton} onPress={() => sendRecordsQuery.refetch()}>
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : sendRecords.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Feather name="send" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>보낸 편지가 없어요</Text>
          <Text style={styles.emptySubtitle}>편지를 보내면 여기에 기록돼요</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={sendRecordsQuery.isRefetching}
              onRefresh={() => sendRecordsQuery.refetch()}
              tintColor={Colors.zinc400}
            />
          }
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
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
  sectionHeader: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 10,
    backgroundColor: Colors.zinc50,
  },
  sectionTitle: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc500,
  },
  recordItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 12,
  },
  recordInfo: {
    flex: 1,
    gap: 2,
  },
  recordTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  recordTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
    flexShrink: 1,
  },
  recordSub: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
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
  retryButton: {
    marginTop: 8,
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
