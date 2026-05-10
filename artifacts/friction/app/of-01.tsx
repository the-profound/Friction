import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Alert, RefreshControl, TextInput, Switch } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import {
  useListMyCollections,
  useCreateMyCollection,
  useDeleteMyCollection,
} from "@workspace/api-client-react";
import type { MyCollection } from "@workspace/api-client-react";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import SubmitButton from "@/components/SubmitButton/SubmitButton";

type MiniTab = "mine" | "public";

export default function PersonalCollectionListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();
  const [activeTab, setActiveTab] = useState<MiniTab>("mine");
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newIsPublic, setNewIsPublic] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { showToast } = useToast();

  const collectionsQuery = useListMyCollections({ ownerId: userId });
  const collections = (collectionsQuery.data ?? []) as MyCollection[];

  const privateCollections = collections.filter((c) => !c.isPublic);
  const publicCollections = collections.filter((c) => c.isPublic);
  const createCollection = useCreateMyCollection();
  const deleteCollection = useDeleteMyCollection();

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) {
      Alert.alert("오류", "이름을 입력해주세요.");
      return;
    }
    try {
      const newCollection = await createCollection.mutateAsync({
        data: { ownerId: userId, name: newName.trim(), description: newDescription.trim(), isPublic: newIsPublic },
      });
      setCreateSheetVisible(false);
      setNewName("");
      setNewDescription("");
      setNewIsPublic(false);
      collectionsQuery.refetch();
      router.push({ pathname: "/of-01-detail", params: { id: newCollection.id, name: newName.trim() } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "폴더 생성에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [newName, newDescription, newIsPublic, userId, createCollection, collectionsQuery, router]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (isDeleting) return;
      setIsDeleting(true);
      try {
        await deleteCollection.mutateAsync({ id });
        setDeleteTarget(null);
        collectionsQuery.refetch();
        showToast({ message: "폴더를 삭제했어요.", type: "success" });
      } catch (e: unknown) {
        setDeleteTarget(null);
        const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
        showToast({ message: msg, type: "error" });
      } finally {
        setIsDeleting(false);
      }
    },
    [isDeleting, deleteCollection, collectionsQuery, showToast],
  );

  const renderItem = ({ item }: { item: MyCollection }) => (
    <ScalePressable
      style={styles.collectionItem}
      onPress={() => router.push({ pathname: "/of-01-detail", params: { id: item.id, name: item.name } })}
      onLongPress={() => { if (!item.isImpression) setDeleteTarget({ id: item.id, name: item.name }); }}
      delayLongPress={1000}
    >
      <View style={styles.collectionIcon}>
        <Feather name={item.isImpression ? "heart" : "folder"} size={20} color={Colors.zinc500} />
      </View>
      <View style={styles.collectionInfo}>
        <Text style={styles.collectionName} numberOfLines={1}>{item.name}</Text>
        {item.description && (
          <Text style={styles.collectionDesc} numberOfLines={1}>{item.description}</Text>
        )}
      </View>
      <View style={styles.collectionRight}>
        <Text style={styles.collectionCount}>{item.articleCount ?? 0}편</Text>
        {item.isPublic && <Feather name="globe" size={12} color={Colors.zinc400} />}
        <Feather name="chevron-right" size={16} color={Colors.zinc300} />
      </View>
    </ScalePressable>
  );

  type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

  const renderCollectionList = (data: MyCollection[], emptyIcon: FeatherIconName, emptyTitle: string, emptySubtitle: string) => {
    if (collectionsQuery.isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      );
    }
    if (collectionsQuery.isError) {
      return (
        <View style={styles.emptyContainer}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기에 실패했어요</Text>
          <ScalePressable style={styles.createButton} onPress={() => collectionsQuery.refetch()}>
            <Text style={styles.createButtonText}>다시 시도</Text>
          </ScalePressable>
        </View>
      );
    }
    if (data.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Feather name={emptyIcon} size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
          <ScalePressable
            style={styles.createButton}
            onPress={() => { setNewName(""); setNewDescription(""); setNewIsPublic(activeTab === "public"); setCreateSheetVisible(true); }}
          >
            <Text style={styles.createButtonText}>새 폴더 만들기</Text>
          </ScalePressable>
        </View>
      );
    }
    return (
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={collectionsQuery.isRefetching}
            onRefresh={() => collectionsQuery.refetch()}
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
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <Text style={styles.headerTitle}>폴더</Text>
        <ScalePressable hitSlop={12} onPress={() => { setNewName(""); setNewDescription(""); setNewIsPublic(false); setCreateSheetVisible(true); }}>
          <Feather name="plus" size={20} color={Colors.zinc600} />
        </ScalePressable>
      </View>

      <View style={styles.tabBar}>
        <ScalePressable
          style={[styles.tab, activeTab === "mine" && styles.tabActive]}
          onPress={() => setActiveTab("mine")}
        >
          <Text style={[styles.tabText, activeTab === "mine" && styles.tabTextActive]}>
            내 폴더 ({privateCollections.length})
          </Text>
        </ScalePressable>
        <ScalePressable
          style={[styles.tab, activeTab === "public" && styles.tabActive]}
          onPress={() => setActiveTab("public")}
        >
          <Text style={[styles.tabText, activeTab === "public" && styles.tabTextActive]}>
            구독 폴더 ({publicCollections.length})
          </Text>
        </ScalePressable>
      </View>

      {activeTab === "mine"
        ? renderCollectionList(privateCollections, "folder", "내 폴더가 없어요", "새 폴더를 만들어 편지를 정리해보세요")
        : renderCollectionList(publicCollections, "globe", "구독 폴더가 없어요", "공개로 설정한 폴더가 여기에 표시돼요\n구독 기능은 추후 업데이트 예정이에요")}

      <BottomSheet
        visible={createSheetVisible}
        onClose={() => setCreateSheetVisible(false)}
        title="새 폴더"
        snapPoints={[0.45]}
        keyboardAware
      >
        <View style={styles.createForm}>
          <TextInput
            style={styles.createInput}
            placeholder="폴더 이름"
            placeholderTextColor={Colors.zinc400}
            value={newName}
            onChangeText={setNewName}
            autoFocus
          />
          <TextInput
            style={[styles.createInput, styles.createInputMulti]}
            placeholder="설명 (선택사항)"
            placeholderTextColor={Colors.zinc400}
            value={newDescription}
            onChangeText={setNewDescription}
            multiline
            textAlignVertical="top"
          />
          <View style={styles.visibilityRow}>
            <View style={styles.visibilityLabel}>
              <Feather name={newIsPublic ? "globe" : "lock"} size={16} color={Colors.zinc500} />
              <Text style={styles.visibilityText}>
                {newIsPublic ? "공개 폴더" : "비공개 폴더"}
              </Text>
            </View>
            <Switch
              value={newIsPublic}
              onValueChange={setNewIsPublic}
              trackColor={{ false: Colors.zinc200, true: Colors.zinc900 }}
              thumbColor={Colors.white}
            />
          </View>
          <SubmitButton
            style={styles.confirmButton}
            disabledStyle={styles.confirmDisabled}
            textStyle={styles.confirmButtonText}
            onPress={handleCreate}
            pending={createCollection.isPending}
            disabled={!newName.trim()}
            label="만들기"
            pendingLabel="만드는 중..."
          />
        </View>
      </BottomSheet>

      <ConfirmModal
        visible={deleteTarget !== null}
        title="폴더 삭제"
        description={`'${deleteTarget?.name ?? ""}'을(를) 삭제할까요?\n폴더 안의 글은 삭제되지 않아요.`}
        confirmLabel={isDeleting ? "삭제 중..." : "삭제"}
        cancelLabel="취소"
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            handleDelete(deleteTarget.id);
          }
        }}
        onCancel={() => { if (!isDeleting) setDeleteTarget(null); }}
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
  listContent: {
    paddingBottom: 40,
  },
  collectionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 12,
  },
  collectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.zinc50,
    alignItems: "center",
    justifyContent: "center",
  },
  collectionInfo: {
    flex: 1,
    gap: 2,
  },
  collectionName: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  collectionDesc: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  collectionRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  collectionCount: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc400,
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
    lineHeight: 22,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  createButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
  },
  createButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  createForm: {
    paddingVertical: 12,
    gap: 12,
  },
  createInput: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc900,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  createInputMulti: {
    minHeight: 80,
    lineHeight: 22,
  },
  confirmButton: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  confirmDisabled: {
    backgroundColor: Colors.zinc300,
  },
  confirmButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  visibilityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  visibilityLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  visibilityText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
  },
});
