import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Alert, RefreshControl, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import {
  useListTeamCollections,
  useCreateTeamCollection,
  useDeleteTeamCollection,
} from "@workspace/api-client-react";
import type { TeamCollectionWithRole } from "@workspace/api-client-react";
import BottomSheet from "@/components/BottomSheet/BottomSheet";

type MiniTab = "mine" | "joined" | "subscribed";

export default function TeamCollectionListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();
  const [activeTab, setActiveTab] = useState<MiniTab>("mine");
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const collectionsQuery = useListTeamCollections({ userId });
  const collections = (collectionsQuery.data ?? []) as TeamCollectionWithRole[];
  const createCollection = useCreateTeamCollection();
  const deleteCollection = useDeleteTeamCollection();

  const tabs: { key: MiniTab; label: string }[] = [
    { key: "mine", label: "나의 단체 모음" },
    { key: "joined", label: "참여 중" },
    { key: "subscribed", label: "구독 중" },
  ];

  const filteredCollections = collections.filter((c) => {
    if (activeTab === "mine") return c.role === "OWNER";
    if (activeTab === "joined") return c.role === "MEMBER";
    return c.role !== "OWNER" && c.role !== "MEMBER";
  });

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) {
      Alert.alert("오류", "이름을 입력해주세요.");
      return;
    }
    try {
      await createCollection.mutateAsync({
        data: { creatorId: userId, name: newName.trim(), description: newDescription.trim() },
      });
      setCreateSheetVisible(false);
      setNewName("");
      setNewDescription("");
      collectionsQuery.refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "단체 모음 생성에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [newName, newDescription, userId, createCollection, collectionsQuery]);

  const handleDelete = useCallback(
    (id: string, name: string) => {
      Alert.alert("단체 모음 삭제", `'${name}'을(를) 삭제하시겠어요?`, [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteCollection.mutateAsync({ id });
              collectionsQuery.refetch();
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
              Alert.alert("오류", msg);
            }
          },
        },
      ]);
    },
    [deleteCollection, collectionsQuery],
  );

  const renderItem = ({ item }: { item: TeamCollectionWithRole }) => (
    <Pressable
      style={styles.collectionItem}
      onPress={() => router.push({ pathname: "/of-02-detail", params: { id: item.id } })}
      onLongPress={() => item.role === "OWNER" ? handleDelete(item.id, item.name) : undefined}
    >
      <View style={styles.collectionIcon}>
        <Feather name="users" size={20} color="#7C3AED" />
      </View>
      <View style={styles.collectionInfo}>
        <Text style={styles.collectionName} numberOfLines={1}>{item.name}</Text>
        {item.description && (
          <Text style={styles.collectionDesc} numberOfLines={1}>{item.description}</Text>
        )}
      </View>
      <View style={styles.collectionRight}>
        <View style={styles.roleBadge}>
          <Text style={styles.roleBadgeText}>
            {item.role === "OWNER" ? "소유자" : item.role === "MEMBER" ? "멤버" : "구독"}
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={Colors.zinc300} />
      </View>
    </Pressable>
  );

  const renderEmpty = () => {
    switch (activeTab) {
      case "mine":
        return (
          <View style={styles.emptyContainer}>
            <Feather name="users" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>단체 모음이 없어요</Text>
            <Text style={styles.emptySubtitle}>함께 글을 나눌 모임을 만들어보세요</Text>
            <Pressable
              style={styles.createButton}
              onPress={() => { setNewName(""); setNewDescription(""); setCreateSheetVisible(true); }}
            >
              <Text style={styles.createButtonText}>새 단체 모음 만들기</Text>
            </Pressable>
          </View>
        );
      case "joined":
        return (
          <View style={styles.emptyContainer}>
            <Feather name="user-check" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>참여 중인 모음이 없어요</Text>
            <Text style={styles.emptySubtitle}>초대를 받거나 신청해서 참여하세요</Text>
          </View>
        );
      case "subscribed":
        return (
          <View style={styles.emptyContainer}>
            <Feather name="rss" size={40} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>구독 중인 단체 모음이 없어요</Text>
            <Text style={styles.emptySubtitle}>공개된 단체 모음을 구독해보세요</Text>
          </View>
        );
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>단체 모음</Text>
        <Pressable
          hitSlop={12}
          onPress={() => { setNewName(""); setNewDescription(""); setCreateSheetVisible(true); }}
        >
          <Feather name="plus" size={20} color={Colors.zinc600} />
        </Pressable>
      </View>

      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {collectionsQuery.isLoading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      ) : collectionsQuery.isError ? (
        <View style={styles.emptyContainer}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기에 실패했어요</Text>
          <Pressable style={styles.createButton} onPress={() => collectionsQuery.refetch()}>
            <Text style={styles.createButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : filteredCollections.length === 0 ? (
        renderEmpty()
      ) : (
        <FlatList
          data={filteredCollections}
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
      )}

      <BottomSheet
        visible={createSheetVisible}
        onClose={() => setCreateSheetVisible(false)}
        title="새 단체 모음"
        snapPoints={[0.45]}
      >
        <View style={styles.createForm}>
          <TextInput
            style={styles.createInput}
            placeholder="모음 이름"
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
          <Pressable
            style={[styles.confirmButton, !newName.trim() && styles.confirmDisabled]}
            onPress={handleCreate}
            disabled={!newName.trim()}
          >
            <Text style={styles.confirmButtonText}>만들기</Text>
          </Pressable>
        </View>
      </BottomSheet>
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
    backgroundColor: "#EDE9FE",
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
    gap: 8,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: Colors.zinc100,
  },
  roleBadgeText: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc600,
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
});
