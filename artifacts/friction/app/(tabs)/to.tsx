import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import { useNavigation } from "@/contexts/NavigationContext";
import { useUser } from "@/contexts/UserContext";
import { NeighborsInline } from "@/components/ToInline/NeighborsInline";
import { SendInline } from "@/components/ToInline/SendInline";
import {
  useListNeighborRequests,
  useListSendRecords,
  getListNeighborRequestsQueryKey,
  getListSendRecordsQueryKey,
} from "@workspace/api-client-react";
import type {
  NeighborRequestWithUser,
  SendRecordWithDetails,
} from "@workspace/api-client-react";
import { formatDeliveryTime } from "@/lib/deliverySync";
import {
  INCOMING_FALLBACK_POLL_INTERVAL_MS,
  useFocusPollingOptions,
  isQueryStale,
} from "@/lib/useScreenFocused";
import { useRealtimeChannel } from "@/lib/useRealtimeChannel";
import { useQueryClient } from "@tanstack/react-query";

type ParamRouter = ReturnType<typeof useRouter>;

/**
 * expo-router's `setParams` accepts a partial record of params; passing `undefined`
 * for a key clears it at runtime, but its type signature insists on `string`. This
 * helper centralises the safe cast so we don't sprinkle `as unknown as string` casts
 * at every call site.
 */
function clearRouterParams(router: ParamRouter, keys: string[]): void {
  const cleared = Object.fromEntries(keys.map((k) => [k, undefined])) as unknown as Record<
    string,
    string
  >;
  router.setParams(cleared);
}

export default function ToScreen() {
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { toSubTab, setToSubTab } = useNavigation();
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    targetGroup?: string;
    targetGroupName?: string;
    returnToId?: string;
    articleId?: string;
    neighborId?: string;
    focusRequests?: string;
  }>();

  const [focusRequestsSignal, setFocusRequestsSignal] = useState<number | undefined>(undefined);

  // When external entry sets focusRequests=1, switch to neighbors subtab and signal
  // the inline component to focus the "received requests" section.
  useEffect(() => {
    if (params.focusRequests === "1") {
      setToSubTab("neighbors");
      setFocusRequestsSignal(Date.now());
      // Clear the param so re-renders don't re-trigger.
      clearRouterParams(router, ["focusRequests"]);
    }
  }, [params.focusRequests, router, setToSubTab]);

  // Build a stable prefill key so SendInline re-applies prefill when params change.
  const prefillKey = useMemo(
    () =>
      [
        params.targetGroup ?? "",
        params.targetGroupName ?? "",
        params.articleId ?? "",
        params.neighborId ?? "",
        params.returnToId ?? "",
      ].join("|"),
    [
      params.targetGroup,
      params.targetGroupName,
      params.articleId,
      params.neighborId,
      params.returnToId,
    ],
  );

  const handleSendComplete = useCallback(() => {
    // Clear prefill params so subsequent visits don't re-prefill.
    clearRouterParams(router, [
      "targetGroup",
      "targetGroupName",
      "articleId",
      "neighborId",
      "returnToId",
    ]);
  }, [router]);

  // Realtime subscription is the primary mechanism for surfacing freshly-
  // arrived neighbor requests; the slower focus-gated poll (60s) stays as a
  // safety net. The neighbors list itself owns its own subscription inside
  // NeighborsInline. Send records still use plain focus polling because they
  // also reflect server-side delivery state changes that are not driven by a
  // single watched table.
  const pollOpts = useFocusPollingOptions(INCOMING_FALLBACK_POLL_INTERVAL_MS);
  const requestsQuery = useListNeighborRequests({ recipientId: userId }, pollOpts);
  const pendingRequests = (requestsQuery.data ?? []) as NeighborRequestWithUser[];
  const sendRecordsQuery = useListSendRecords({ senderId: userId }, pollOpts);
  const sendRecords = (sendRecordsQuery.data ?? []) as SendRecordWithDetails[];

  useRealtimeChannel(
    userId ? `to-requests:${userId}` : null,
    [
      {
        table: "neighbor_requests",
        filter: `recipient_id=eq.${userId}`,
      },
    ],
    () => {
      requestsQuery.refetch();
    },
  );

  const recentSendRecords = useMemo(
    () =>
      [...sendRecords]
        .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
        .slice(0, 5),
    [sendRecords],
  );

  const handleViewHistory = useCallback(() => {
    router.push("/to-03");
  }, [router]);

  const handleArticlePress = useCallback(
    (articleId: string) => {
      router.push({ pathname: "/read", params: { articleId, mode: "re_read" } });
    },
    [router],
  );

  const handleFocusRequests = useCallback(() => {
    setFocusRequestsSignal(Date.now());
  }, []);

  // Refetch on focus ONLY if cached data is stale (older than the global
  // staleTime). Skips the refetch for quick tab switches so users see their
  // send records and pending requests immediately without a spinner.
  // Realtime + 60 s polling handle new arrivals while the tab is focused.
  const refetchRequests = requestsQuery.refetch;
  const refetchSendRecords = sendRecordsQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      if (isQueryStale(queryClient, getListNeighborRequestsQueryKey({ recipientId: userId }))) {
        refetchRequests();
      }
      if (isQueryStale(queryClient, getListSendRecordsQueryKey({ senderId: userId }))) {
        refetchSendRecords();
      }
    }, [refetchRequests, refetchSendRecords, queryClient, userId]),
  );

  const renderSendRecordItem = ({ item }: { item: SendRecordWithDetails }) => {
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

  const renderHistoryTab = () => {
    if (sendRecordsQuery.isLoading) {
      return (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      );
    }

    if (sendRecordsQuery.isError) {
      return (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
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
        <RefreshableEmpty
          refreshing={sendRecordsQuery.isRefetching}
          onRefresh={() => sendRecordsQuery.refetch()}
          contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
        >
          <Feather name="send" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>보낸 편지가 없어요</Text>
          <Text style={styles.emptySubtitle}>편지를 보내면 여기에 기록돼요</Text>
        </RefreshableEmpty>
      );
    }

    return (
      <FlatList
        data={recentSendRecords}
        keyExtractor={(item) => item.id}
        renderItem={renderSendRecordItem}
        contentContainerStyle={[styles.listContent, { paddingBottom: navBottom }]}
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
            onRefresh={refetchSendRecords}
            tintColor={Colors.zinc400}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    );
  };

  const renderNeighborsTab = () => (
    <View style={styles.tabContent}>
      {pendingRequests.length > 0 && (
        <Pressable style={styles.requestBanner} onPress={handleFocusRequests}>
          <Feather name="bell" size={16} color="#D97706" />
          <Text style={styles.requestBannerText}>
            대기 중인 이웃 요청 {pendingRequests.length}건
          </Text>
          <Feather name="chevron-right" size={16} color={Colors.zinc400} />
        </Pressable>
      )}
      <NeighborsInline focusRequestsSignal={focusRequestsSignal} />
    </View>
  );

  const renderSendTab = () => (
    <SendInline
      targetGroup={params.targetGroup}
      targetGroupName={params.targetGroupName}
      prefillArticleId={params.articleId}
      prefillNeighborId={params.neighborId}
      returnToId={params.returnToId}
      prefillKey={prefillKey}
      onSent={handleSendComplete}
    />
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
      <PageHeader title="발신함" showSearch={false} />
      {renderContent()}
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
