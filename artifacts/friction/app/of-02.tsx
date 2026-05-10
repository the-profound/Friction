import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Alert, RefreshControl, TextInput } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import {
  useListTeamCollections,
  useCreateTeamCollection,
  useDeleteTeamCollection,
  useAddTeamMember,
  getTeamCollection,
  getListTeamCollectionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { isQueryStale } from "@/lib/useScreenFocused";
import type { TeamCollectionWithRole, TeamCollection } from "@workspace/api-client-react";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import SubmitButton from "@/components/SubmitButton/SubmitButton";

type MiniTab = "mine" | "joined";

export default function TeamCollectionListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<MiniTab>("mine");
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [joinSheetVisible, setJoinSheetVisible] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joinStep, setJoinStep] = useState<"code" | "preview">("code");
  const [joinPreview, setJoinPreview] = useState<TeamCollection | null>(null);
  const [isJoinLoading, setIsJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const collectionsQuery = useListTeamCollections({ userId });
  const collections = (collectionsQuery.data ?? []) as TeamCollectionWithRole[];
  const createCollection = useCreateTeamCollection();
  const deleteCollection = useDeleteTeamCollection();
  const addMember = useAddTeamMember();

  // Refetch on focus ONLY if cached data is stale. This avoids a spinner
  // every time the user navigates back from a team collection detail screen.
  const refetchCollections = collectionsQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      if (isQueryStale(queryClient, getListTeamCollectionsQueryKey({ userId }))) {
        refetchCollections();
      }
    }, [refetchCollections, queryClient, userId]),
  );

  const tabs: { key: MiniTab; label: string }[] = [
    { key: "mine", label: "나의 단체 모음" },
    { key: "joined", label: "참여 중" },
  ];

  const filteredCollections = collections.filter((c) => {
    if (activeTab === "mine") return c.role === "OWNER";
    return c.role === "MEMBER";
  });

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) {
      Alert.alert("오류", "이름을 입력해주세요.");
      return;
    }
    if (createCollection.isPending) return;
    try {
      const newCollection = await createCollection.mutateAsync({
        data: { creatorId: userId, name: newName.trim(), description: newDescription.trim() },
      });
      setCreateSheetVisible(false);
      setNewName("");
      setNewDescription("");
      setActiveTab("mine");
      collectionsQuery.refetch();
      router.push({ pathname: "/of-02-detail", params: { id: newCollection.id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "단체 모음 생성에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [newName, newDescription, userId, createCollection, collectionsQuery, router]);

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

  const handleOpenCreate = useCallback(() => {
    setActionSheetVisible(false);
    setNewName("");
    setNewDescription("");
    setCreateSheetVisible(true);
  }, []);

  const handleOpenJoin = useCallback(() => {
    setActionSheetVisible(false);
    setInviteCode("");
    setJoinStep("code");
    setJoinPreview(null);
    setJoinError(null);
    setJoinSheetVisible(true);
  }, []);

  const handleJoinCodeSubmit = useCallback(async () => {
    const raw = inviteCode.trim();
    if (!raw) {
      setJoinError("초대 코드를 입력해주세요.");
      return;
    }
    const cleanUrl = raw.split("?")[0].split("#")[0].replace(/\/+$/, "");
    const teamId = cleanUrl.includes("/") ? cleanUrl.split("/").filter(Boolean).pop()! : cleanUrl;
    setIsJoinLoading(true);
    setJoinError(null);
    try {
      const collection = await getTeamCollection(teamId);
      const alreadyMember = collections.some((c) => c.id === teamId);
      if (alreadyMember) {
        setJoinError("이미 참여 중인 모음이에요.");
        return;
      }
      setJoinPreview(collection);
      setJoinStep("preview");
    } catch (e: unknown) {
      const status = (e as { status?: number }).status;
      if (status === 404) {
        setJoinError("존재하지 않는 코드예요. 다시 확인해주세요.");
      } else {
        setJoinError("코드를 확인하는 중 오류가 발생했어요. 다시 시도해주세요.");
      }
    } finally {
      setIsJoinLoading(false);
    }
  }, [inviteCode, collections]);

  const handleJoinConfirm = useCallback(async () => {
    if (!joinPreview) return;
    setIsJoinLoading(true);
    setJoinError(null);
    try {
      await addMember.mutateAsync({ id: joinPreview.id, data: { userId } });
      setJoinSheetVisible(false);
      setJoinPreview(null);
      setInviteCode("");
      setActiveTab("joined");
      collectionsQuery.refetch();
      Alert.alert("완료", `'${joinPreview.name}' 모음에 참여했어요!`);
    } catch (e: unknown) {
      const status = (e as { status?: number }).status;
      if (status === 400) {
        setJoinError("이미 참여 중인 모음이에요.");
      } else {
        setJoinError("참여에 실패했어요. 다시 시도해주세요.");
      }
    } finally {
      setIsJoinLoading(false);
    }
  }, [joinPreview, userId, addMember, collectionsQuery]);

  const renderItem = ({ item }: { item: TeamCollectionWithRole }) => (
    <ScalePressable
      style={styles.collectionItem}
      onPress={() => router.push({ pathname: "/of-02-detail", params: { id: item.id } })}
      onLongPress={() => item.role === "OWNER" ? handleDelete(item.id, item.name) : undefined}
      delayLongPress={1000}
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
            {item.role === "OWNER" ? "소유자" : "멤버"}
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={Colors.zinc300} />
      </View>
    </ScalePressable>
  );

  const renderEmpty = () => {
    if (activeTab === "joined") {
      return (
        <View style={styles.emptyContainer}>
          <Feather name="user-check" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>참여 중인 모음이 없어요</Text>
          <Text style={styles.emptySubtitle}>초대 코드를 입력하면 단체 모음에 참여할 수 있어요</Text>
          <ScalePressable style={styles.createButton} onPress={handleOpenJoin}>
            <Text style={styles.createButtonText}>초대 코드로 참여</Text>
          </ScalePressable>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Feather name="users" size={40} color={Colors.zinc300} />
        <Text style={styles.emptyTitle}>단체 모음이 없어요</Text>
        <Text style={styles.emptySubtitle}>함께 글을 나눌 모임을 만들어보세요</Text>
        <ScalePressable style={styles.createButton} onPress={handleOpenCreate}>
          <Text style={styles.createButtonText}>새 단체 모음 만들기</Text>
        </ScalePressable>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <Text style={styles.headerTitle}>단체 모음</Text>
        <ScalePressable hitSlop={12} onPress={() => setActionSheetVisible(true)}>
          <Feather name="plus" size={20} color={Colors.zinc600} />
        </ScalePressable>
      </View>

      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <ScalePressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </ScalePressable>
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
          <ScalePressable style={styles.createButton} onPress={() => collectionsQuery.refetch()}>
            <Text style={styles.createButtonText}>다시 시도</Text>
          </ScalePressable>
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
        visible={actionSheetVisible}
        onClose={() => setActionSheetVisible(false)}
        snapPoints={[0.28]}
      >
        <View style={styles.actionSheetContent}>
          <ScalePressable style={styles.actionSheetRow} onPress={handleOpenCreate}>
            <View style={styles.actionSheetIcon}>
              <Feather name="plus-circle" size={20} color={Colors.zinc700} />
            </View>
            <View style={styles.actionSheetTextWrap}>
              <Text style={styles.actionSheetLabel}>새로 만들기</Text>
              <Text style={styles.actionSheetDesc}>직접 단체 모음을 만들어요</Text>
            </View>
          </ScalePressable>
          <ScalePressable style={styles.actionSheetRow} onPress={handleOpenJoin}>
            <View style={styles.actionSheetIcon}>
              <Feather name="log-in" size={20} color={Colors.zinc700} />
            </View>
            <View style={styles.actionSheetTextWrap}>
              <Text style={styles.actionSheetLabel}>기존 모음에 참가하기</Text>
              <Text style={styles.actionSheetDesc}>초대 코드로 참여해요</Text>
            </View>
          </ScalePressable>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={joinSheetVisible}
        onClose={() => { setJoinSheetVisible(false); setJoinError(null); }}
        title={joinStep === "code" ? "초대 코드로 참가" : "모음 정보 확인"}
        snapPoints={joinStep === "preview" ? [0.55] : [0.4]}
        keyboardAware={joinStep === "code"}
      >
        {joinStep === "code" ? (
          <View style={styles.createForm}>
            <Text style={styles.joinHint}>초대받은 코드 또는 링크를 붙여넣으세요</Text>
            <TextInput
              style={styles.createInput}
              placeholder="초대 코드 입력"
              placeholderTextColor={Colors.zinc400}
              value={inviteCode}
              onChangeText={(v) => { setInviteCode(v); setJoinError(null); }}
              autoFocus
              autoCapitalize="none"
            />
            {joinError ? <Text style={styles.joinErrorText}>{joinError}</Text> : null}
            <SubmitButton
              style={styles.confirmButton}
              disabledStyle={styles.confirmDisabled}
              textStyle={styles.confirmButtonText}
              onPress={handleJoinCodeSubmit}
              pending={isJoinLoading}
              disabled={!inviteCode.trim()}
              label="다음"
              pendingLabel="확인 중..."
            />
          </View>
        ) : joinPreview ? (
          <View style={styles.joinPreviewContainer}>
            <View style={styles.joinPreviewCard}>
              <View style={styles.joinPreviewIcon}>
                <Feather name="users" size={28} color="#7C3AED" />
              </View>
              <Text style={styles.joinPreviewName}>{joinPreview.name}</Text>
              {joinPreview.description ? (
                <Text style={styles.joinPreviewDesc}>{joinPreview.description}</Text>
              ) : null}
              {joinPreview.creatorNickname ? (
                <Text style={styles.joinPreviewOwner}>모음장: {joinPreview.creatorNickname}</Text>
              ) : null}
            </View>
            {joinError ? <Text style={styles.joinErrorText}>{joinError}</Text> : null}
            <SubmitButton
              style={styles.confirmButton}
              disabledStyle={styles.confirmDisabled}
              textStyle={styles.confirmButtonText}
              onPress={handleJoinConfirm}
              pending={isJoinLoading}
              label="참가하기"
              pendingLabel="참가 중..."
            />
            <ScalePressable
              style={styles.joinBackButton}
              onPress={() => { setJoinStep("code"); setJoinError(null); }}
            >
              <Text style={styles.joinBackText}>다른 코드 입력</Text>
            </ScalePressable>
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={createSheetVisible}
        onClose={() => setCreateSheetVisible(false)}
        title="새 단체 모음"
        snapPoints={[0.45]}
        keyboardAware
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
  joinHint: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  actionSheetContent: {
    paddingVertical: 8,
    gap: 4,
  },
  actionSheetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 14,
  },
  actionSheetIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.zinc50,
    alignItems: "center",
    justifyContent: "center",
  },
  actionSheetTextWrap: {
    flex: 1,
    gap: 2,
  },
  actionSheetLabel: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
  },
  actionSheetDesc: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  joinErrorText: {
    ...Typography.body,
    fontSize: 13,
    color: "#DC2626",
    marginTop: -4,
  },
  joinPreviewContainer: {
    paddingVertical: 8,
    gap: 16,
  },
  joinPreviewCard: {
    backgroundColor: Colors.zinc50,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 8,
  },
  joinPreviewIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  joinPreviewName: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
    textAlign: "center",
  },
  joinPreviewDesc: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    textAlign: "center",
  },
  joinPreviewOwner: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
    textAlign: "center",
    marginTop: 4,
  },
  joinBackButton: {
    alignItems: "center",
    paddingVertical: 10,
  },
  joinBackText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
});
