import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton from "@/components/shared/HeaderButton";
import { useUser } from "@/contexts/UserContext";
import { isQueryStale } from "@/lib/useScreenFocused";
import { LIST_PERF_PRESET } from "@/lib/listPerf";
import {
  useListSpaces,
  getListSpacesQueryKey,
} from "@workspace/api-client-react";
import type { SpaceListItem } from "@workspace/api-client-react";

const GRID_H_PADDING = Spacing.screenPx;
const GRID_COLUMN_GAP = 10;

function ArchivedSpaceCard({
  item,
  onPress,
  cardSize,
}: {
  item: SpaceListItem;
  onPress: () => void;
  cardSize: number;
}) {
  const isOperator = item.myRole === "OPERATOR";
  const avatarLetter = item.name.charAt(0);

  return (
    <ScalePressable
      style={[styles.card, { width: cardSize, height: cardSize }]}
      onPress={onPress}
      contentStyle={styles.cardContent}
    >
      <View style={styles.cardTopRow}>
        <View style={styles.cardAvatar}>
          <Text style={styles.cardAvatarText}>{avatarLetter}</Text>
        </View>
        <View style={styles.cardBadgeStack}>
          <View style={styles.archivedBadge}>
            <Text style={styles.archivedBadgeText}>종료</Text>
          </View>
          {item.isAnonymous && (
            <View style={styles.anonymousBadge}>
              <Text style={styles.anonymousBadgeText}>익명</Text>
            </View>
          )}
          {isOperator ? (
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>내 공간</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
      {item.operatorNickname ? (
        <Text style={styles.cardOperator} numberOfLines={1}>공간장 · {item.operatorNickname}</Text>
      ) : null}
      <View style={styles.cardSpacer} />
      <View style={styles.cardMeta}>
        <Text style={styles.cardMetaText}>{item.roundCount}회차</Text>
        <View style={styles.metaDot} />
        <Text style={styles.cardMetaText}>
          {item.participantCount}
          {item.maxParticipants ? `/${item.maxParticipants}` : ""}명
        </Text>
      </View>
    </ScalePressable>
  );
}

export default function ArchivedSpacesScreen() {
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const { width: screenWidth } = useWindowDimensions();
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const cardSize = Math.floor((screenWidth - GRID_H_PADDING * 2 - GRID_COLUMN_GAP) / 2);

  const spacesQuery = useListSpaces({ userId });

  const archivedSpaces = (
    (spacesQuery.data ?? []) as SpaceListItem[]
  ).filter((s) => s.status === "ARCHIVED");

  const handleRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await spacesQuery.refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [spacesQuery]);

  useFocusEffect(
    useCallback(() => {
      if (isQueryStale(queryClient, getListSpacesQueryKey({ userId }))) {
        spacesQuery.refetch();
      }
    }, [queryClient, userId, spacesQuery.refetch]),
  );

  const renderItem = useCallback(
    ({ item }: { item: SpaceListItem }) => (
      <ArchivedSpaceCard
        item={item}
        cardSize={cardSize}
        onPress={() =>
          router.push({ pathname: "/of-space-detail" as never, params: { id: item.id } })
        }
      />
    ),
    [router, cardSize],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <HeaderButton
          variant="back"
          onPress={() => router.back()}
          accessibilityLabel="공간 목록으로 돌아가기"
        />
        <Text style={styles.headerTitle}>보관된 공간</Text>
      </View>

      {spacesQuery.isLoading ? (
        <View style={[styles.center, { paddingBottom: navBottom }]}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      ) : spacesQuery.isError ? (
        <View style={[styles.center, { paddingBottom: navBottom }]}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기에 실패했어요</Text>
          <ScalePressable style={styles.retryButtonOuter} contentStyle={styles.retryButton} onPress={handleRefresh}>
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </ScalePressable>
        </View>
      ) : archivedSpaces.length === 0 ? (
        <View style={[styles.center, { paddingBottom: navBottom }]}>
          <Feather name="archive" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>보관된 공간이 없어요</Text>
          <Text style={styles.emptySubtitle}>종료된 공간은 여기에 표시돼요</Text>
        </View>
      ) : (
        <FlatList
          {...LIST_PERF_PRESET}
          data={archivedSpaces}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={[styles.listContent, { paddingBottom: navBottom }]}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.zinc400}
            />
          }
          showsVerticalScrollIndicator={false}
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
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 14,
    gap: 12,
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
    marginTop: 12,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 20,
  },
  retryButtonOuter: {
    marginTop: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.zinc700,
    borderRadius: 10,
  },
  retryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  listContent: {
    paddingTop: 8,
  },
  columnWrapper: {
    paddingHorizontal: Spacing.screenPx,
    gap: GRID_COLUMN_GAP,
    marginBottom: GRID_COLUMN_GAP,
  },
  // ─── Archived space card ─────────────────────────────────────────────────────
  card: {},
  cardContent: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: Colors.zinc50,
    overflow: "hidden",
    padding: 14,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  cardAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.6,
  },
  cardAvatarText: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc500,
  },
  cardBadgeStack: {
    alignItems: "flex-end",
    gap: 4,
  },
  archivedBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: Colors.zinc600,
  },
  archivedBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
    color: Colors.white,
  },
  anonymousBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.zinc100,
  },
  anonymousBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "500",
    color: Colors.zinc500,
  },
  cardOperator: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    marginTop: 2,
  },
  roleBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: "#92323D",
  },
  roleBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.white,
    fontWeight: "600",
  },
  cardName: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc500,
  },
  cardDesc: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc500,
    lineHeight: 16,
    marginTop: 2,
  },
  cardSpacer: {
    flex: 1,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  cardMetaText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  metaDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: Colors.zinc300,
  },
});
