import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { useRouter, useFocusEffect } from "expo-router";
import {
  useListSpaces,
  getListSpacesQueryKey,
} from "@workspace/api-client-react";
import type { Space } from "@workspace/api-client-react";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import ScalePressable from "@/components/ScalePressable/ScalePressable";
import { isQueryStale } from "@/lib/useScreenFocused";
import { useQueryClient } from "@tanstack/react-query";
import { LIST_PERF_PRESET } from "@/lib/listPerf";
import { useUser } from "@/contexts/UserContext";

export default function SpacesScreen() {
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId } = useUser();
  const queryClient = useQueryClient();

  const spacesQuery = useListSpaces({ userId });
  const spaces = (spacesQuery.data ?? []) as Space[];

  const handleCreateSpace = useCallback(() => {
    router.push("/space-create" as never);
  }, [router]);

  const refetchSpaces = spacesQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      if (isQueryStale(queryClient, getListSpacesQueryKey({ userId }))) {
        refetchSpaces();
      }
    }, [refetchSpaces, queryClient, userId]),
  );

  const renderSpaceItem = useCallback(
    ({ item }: { item: Space }) => (
      <ScalePressable
        style={styles.spaceCard}
        contentStyle={styles.spaceCardContent}
        onPress={() => {}}
      >
        <View style={styles.spaceIconWrap}>
          <Feather name="box" size={20} color={Colors.white} />
        </View>
        <View style={styles.spaceInfo}>
          <Text style={styles.spaceName} numberOfLines={1}>{item.name}</Text>
          {item.description ? (
            <Text style={styles.spaceDesc} numberOfLines={2}>{item.description}</Text>
          ) : null}
          <View style={styles.spaceMeta}>
            <Text style={styles.spaceMetaText}>{item.roundCount}회차</Text>
            {item.maxParticipants ? (
              <Text style={styles.spaceMetaText}>· 최대 {item.maxParticipants}명</Text>
            ) : null}
            {item.isAnonymous ? (
              <Text style={styles.spaceMetaText}>· 익명</Text>
            ) : null}
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={Colors.zinc300} />
      </ScalePressable>
    ),
    [],
  );

  const renderContent = () => {
    if (spacesQuery.isLoading) {
      return (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      );
    }

    if (spacesQuery.isError) {
      return (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기에 실패했어요</Text>
          <ScalePressable style={styles.emptyButton} onPress={() => spacesQuery.refetch()}>
            <Text style={styles.emptyButtonText}>다시 시도</Text>
          </ScalePressable>
        </View>
      );
    }

    if (spaces.length === 0) {
      return (
        <RefreshableEmpty
          refreshing={false}
          onRefresh={() => spacesQuery.refetch()}
          contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
        >
          <Feather name="box" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>공간이 없어요</Text>
          <Text style={styles.emptySubtitle}>
            단계별로 공간을 만들고 함께 글을 나눠요
          </Text>
          <ScalePressable style={styles.emptyButton} onPress={handleCreateSpace}>
            <Text style={styles.emptyButtonText}>새 공간 만들기</Text>
          </ScalePressable>
        </RefreshableEmpty>
      );
    }

    return (
      <FlatList
        {...LIST_PERF_PRESET}
        key="of-space-list"
        data={spaces}
        keyExtractor={(item) => item.id}
        renderItem={renderSpaceItem}
        contentContainerStyle={[styles.spaceListContent, { paddingBottom: navBottom }]}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => spacesQuery.refetch()}
            tintColor={Colors.zinc400}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="공간"
        rightText="새 공간"
        onRightTextPress={handleCreateSpace}
      />
      {renderContent()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: Spacing.screenPx,
  },
  emptyTitle: {
    ...Typography.bodyBold,
    fontSize: 16,
    color: Colors.zinc900,
    marginTop: 12,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.zinc900,
    borderRadius: 20,
  },
  emptyButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
  },
  spaceListContent: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    gap: 10,
  },
  spaceCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.zinc100,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  spaceCardContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  spaceIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
  },
  spaceInfo: {
    flex: 1,
    gap: 2,
  },
  spaceName: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  spaceDesc: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    lineHeight: 18,
  },
  spaceMeta: {
    flexDirection: "row",
    gap: 4,
    marginTop: 2,
  },
  spaceMetaText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
});
