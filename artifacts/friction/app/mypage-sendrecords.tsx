import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useCallback, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import BottomSheet from "@/components/BottomSheet/BottomSheet";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import SwipeableRow, { SwipeableRowHandle } from "@/components/SwipeableRow/SwipeableRow";
import { Colors, Spacing, Typography } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import { formatDeliveryTime } from "@/lib/deliverySync";
import {
  useListSendRecords,
  useDeleteSendRecord,
  useListMyCollections,
  useAddArticleToMyCollection,
} from "@workspace/api-client-react";
import type { SendRecordWithDetails, MyCollection } from "@workspace/api-client-react";

export default function MyPageSendRecordsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();

  const sendRecordsQuery = useListSendRecords({ senderId: userId });
  const sendRecords = (sendRecordsQuery.data ?? []) as SendRecordWithDetails[];

  const collectionsQuery = useListMyCollections({ ownerId: userId });
  const collections = (collectionsQuery.data ?? []) as MyCollection[];

  const deleteSendRecord = useDeleteSendRecord();
  const addToCollection = useAddArticleToMyCollection();

  const [archiveSheetVisible, setArchiveSheetVisible] = useState(false);
  const [archiveArticleId, setArchiveArticleId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [scrollEnabled, setScrollEnabled] = useState(true);

  const openRowRef = useRef<SwipeableRowHandle | null>(null);
  const rowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());

  const sortedRecords = useMemo(
    () =>
      [...sendRecords].sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
      ),
    [sendRecords],
  );

  const sortedCollections = useMemo(() => {
    return [...collections]
      .filter((c) => !c.isArchive)
      .sort((a, b) => {
        if (a.isImpression && !b.isImpression) return -1;
        if (!a.isImpression && b.isImpression) return 1;
        return (b.articleCount ?? 0) - (a.articleCount ?? 0);
      });
  }, [collections]);

  const closeOpenRow = useCallback(() => {
    if (openRowRef.current) {
      openRowRef.current.close();
      openRowRef.current = null;
    }
  }, []);

  const handleSwipeOpen = useCallback((id: string) => {
    const current = openRowRef.current;
    const next = rowRefs.current.get(id) ?? null;
    if (current && current !== next) {
      current.close();
    }
    openRowRef.current = next;
  }, []);

  const handleArticlePress = useCallback(
    (articleId: string) => {
      closeOpenRow();
      router.push({ pathname: "/read", params: { articleId, mode: "re_read" } });
    },
    [router, closeOpenRow],
  );

  const handleSendAction = useCallback(
    (articleId: string) => {
      closeOpenRow();
      router.push({ pathname: "/(tabs)/to", params: { prefillArticleId: articleId } });
    },
    [router, closeOpenRow],
  );

  const handleArchiveAction = useCallback(
    (articleId: string) => {
      closeOpenRow();
      setArchiveArticleId(articleId);
      setSelectedCollectionId(null);
      setArchiveSheetVisible(true);
    },
    [closeOpenRow],
  );

  const handleArchiveConfirm = useCallback(async () => {
    if (!archiveArticleId || !selectedCollectionId || isArchiving) return;
    setIsArchiving(true);
    try {
      await addToCollection.mutateAsync({
        id: selectedCollectionId,
        data: { articleId: archiveArticleId },
      });
      await collectionsQuery.refetch();
      setArchiveSheetVisible(false);
      setArchiveArticleId(null);
      setSelectedCollectionId(null);
      Alert.alert("완료", "폴더에 보관했어요");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "보관에 실패했습니다.";
      Alert.alert("오류", msg);
    } finally {
      setIsArchiving(false);
    }
  }, [archiveArticleId, selectedCollectionId, isArchiving, addToCollection]);

  const handleDeleteAction = useCallback(
    (recordId: string) => {
      closeOpenRow();
      setDeleteTargetId(recordId);
      setDeleteModalVisible(true);
    },
    [closeOpenRow],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTargetId || isDeleting) return;
    const id = deleteTargetId;
    setDeleteModalVisible(false);
    setDeleteTargetId(null);
    setIsDeleting(true);
    try {
      await deleteSendRecord.mutateAsync({ id });
      await sendRecordsQuery.refetch();
    } catch {
      Alert.alert("오류", "삭제에 실패했어요");
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTargetId, isDeleting, deleteSendRecord, sendRecordsQuery]);

  const renderItem = ({ item }: { item: SendRecordWithDetails }) => {
    const isGroup = item.targetType === "group";
    const targetLabel = isGroup ? "단체 모음" : "개인";
    const recipientDisplay = isGroup
      ? (item.collectionName ?? "단체 모음")
      : (item.recipient?.nickname ?? "알 수 없음");
    return (
      <SwipeableRow
        ref={(r) => {
          if (r) {
            rowRefs.current.set(item.id, r);
          } else {
            rowRefs.current.delete(item.id);
          }
        }}
        actions={[
          {
            label: "발신",
            color: "#3B82F6",
            onPress: () => handleSendAction(item.articleId),
          },
          {
            label: "보관",
            color: "#10B981",
            onPress: () => handleArchiveAction(item.articleId),
          },
          {
            label: "삭제",
            color: "#EF4444",
            onPress: () => handleDeleteAction(item.id),
          },
        ]}
        onSwipeOpen={() => handleSwipeOpen(item.id)}
        onScrollLock={(locked) => setScrollEnabled(!locked)}
      >
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
      </SwipeableRow>
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
        scrollEnabled={scrollEnabled}
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

      <BottomSheet
        visible={archiveSheetVisible}
        onClose={() => {
          setArchiveSheetVisible(false);
          setArchiveArticleId(null);
          setSelectedCollectionId(null);
        }}
        snapPoints={[0.6]}
        enableDragDown
        dismissable
      >
        <View style={styles.archiveSheetContainer}>
          <Text style={styles.archiveSheetTitle}>보관할 폴더 선택</Text>
          {collectionsQuery.isLoading ? (
            <View style={styles.archiveSheetEmpty}>
              <Text style={styles.archiveSheetEmptyText}>불러오는 중...</Text>
            </View>
          ) : sortedCollections.length === 0 ? (
            <View style={styles.archiveSheetEmpty}>
              <Text style={styles.archiveSheetEmptyText}>보관할 폴더가 없어요</Text>
            </View>
          ) : (
            <FlatList
              data={sortedCollections}
              keyExtractor={(c) => c.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.archiveSheetList}
              ItemSeparatorComponent={() => <View style={styles.archiveSeparator} />}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedCollectionId;
                return (
                  <Pressable
                    style={[styles.archiveItem, isSelected && styles.archiveItemSelected]}
                    onPress={() => setSelectedCollectionId(item.id)}
                  >
                    <View style={styles.archiveItemLeft}>
                      <Feather
                        name={item.isImpression ? "heart" : "folder"}
                        size={18}
                        color={isSelected ? Colors.zinc900 : Colors.zinc500}
                      />
                      <Text
                        style={[styles.archiveItemName, isSelected && styles.archiveItemNameSelected]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                    </View>
                    <View style={styles.archiveItemRight}>
                      {item.articleCount !== undefined && (
                        <Text style={styles.archiveItemCount}>{item.articleCount}편</Text>
                      )}
                      {isSelected && <Feather name="check" size={16} color={Colors.zinc900} />}
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
          <Pressable
            style={[
              styles.archiveConfirmButton,
              (!selectedCollectionId || isArchiving) && styles.archiveConfirmButtonDisabled,
            ]}
            onPress={handleArchiveConfirm}
            disabled={!selectedCollectionId || isArchiving}
          >
            <Text style={styles.archiveConfirmButtonText}>
              {isArchiving ? "보관 중..." : "보관하기"}
            </Text>
          </Pressable>
        </View>
      </BottomSheet>

      <ConfirmModal
        visible={deleteModalVisible}
        title="발신 기록을 삭제할까요?"
        description="삭제된 기록은 복구할 수 없어요."
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onCancel={() => {
          setDeleteModalVisible(false);
          setDeleteTargetId(null);
        }}
        onConfirm={handleDeleteConfirm}
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
  archiveSheetContainer: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 16,
  },
  archiveSheetTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    textAlign: "center",
    paddingVertical: 12,
  },
  archiveSheetEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  archiveSheetEmptyText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  archiveSheetList: {
    paddingVertical: 4,
  },
  archiveSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.zinc100,
  },
  archiveItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  archiveItemSelected: {
    backgroundColor: Colors.zinc50,
  },
  archiveItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  archiveItemName: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc600,
    flex: 1,
  },
  archiveItemNameSelected: {
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
  },
  archiveItemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  archiveItemCount: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
  },
  archiveConfirmButton: {
    backgroundColor: Colors.zinc900,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 12,
  },
  archiveConfirmButtonDisabled: {
    opacity: 0.4,
  },
  archiveConfirmButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
});
