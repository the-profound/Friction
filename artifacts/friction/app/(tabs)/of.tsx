import React, { useCallback, useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TextInput,
  ScrollView,
  useWindowDimensions,
  Alert,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import AnimatedSearchBar from "@/components/AnimatedSearchBar/AnimatedSearchBar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { useUser } from "@/contexts/UserContext";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import {
  useListTeamCollections,
  useCreateTeamCollection,
  useAddTeamMember,
  getTeamCollection,
  getListTeamCollectionsQueryKey,
} from "@workspace/api-client-react";
import type { TeamCollection, TeamCollectionWithRole } from "@workspace/api-client-react";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import { isQueryStale } from "@/lib/useScreenFocused";
import { useQueryClient } from "@tanstack/react-query";
import { LIST_PERF_PRESET } from "@/lib/listPerf";

type GroupFilter = "all" | "my" | "joined";

const GROUP_FILTER_OPTIONS: { key: GroupFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "my", label: "내가 만든" },
  { key: "joined", label: "참여 중" },
];

export default function OfScreen() {
  const { height: windowH, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");

  const teamCollectionsQuery = useListTeamCollections({ userId });
  const createTeamCollection = useCreateTeamCollection();
  const addTeamMember = useAddTeamMember();

  const teamCollections = (teamCollectionsQuery.data ?? []) as TeamCollectionWithRole[];

  const filteredTeamCollections = useMemo(() => {
    let list = teamCollections;
    if (groupFilter === "my") {
      list = teamCollections.filter((c) => c.role === "OWNER");
    } else if (groupFilter === "joined") {
      list = teamCollections.filter((c) => c.role === "MEMBER");
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [teamCollections, searchQuery, groupFilter]);

  const isOddTeam = filteredTeamCollections.length % 2 !== 0;

  const filteredTeamCollectionsForGrid = useMemo<TeamCollectionWithRole[]>(() => {
    return isOddTeam ? filteredTeamCollections.slice(0, -1) : filteredTeamCollections;
  }, [filteredTeamCollections, isOddTeam]);

  const lastSingleTeamCollection = useMemo<TeamCollectionWithRole | null>(() => {
    return isOddTeam ? filteredTeamCollections[filteredTeamCollections.length - 1] ?? null : null;
  }, [filteredTeamCollections, isOddTeam]);

  const teamCardWidth = (windowWidth - Spacing.screenPx * 2 - 12) / 2;

  const handleSearch = useCallback(() => {
    setSearchActive((prev) => {
      if (prev) setSearchQuery("");
      return !prev;
    });
  }, []);

  const handleAdd = useCallback(() => {
    setActionSheetVisible(true);
  }, []);

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
      const alreadyMember = teamCollections.some((c) => c.id === teamId);
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
  }, [inviteCode, teamCollections]);

  const handleJoinConfirm = useCallback(async () => {
    if (!joinPreview) return;
    setIsJoinLoading(true);
    setJoinError(null);
    try {
      await addTeamMember.mutateAsync({ id: joinPreview.id, data: { userId } });
      setJoinSheetVisible(false);
      setJoinPreview(null);
      setInviteCode("");
      setGroupFilter("joined");
      await teamCollectionsQuery.refetch();
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
  }, [joinPreview, userId, addTeamMember, teamCollectionsQuery]);

  const isCreating = createTeamCollection.isPending;

  const handleCreateConfirm = useCallback(async () => {
    if (!newName.trim()) {
      Alert.alert("오류", "이름을 입력해주세요");
      return;
    }
    if (isCreating) return;
    try {
      const newTeamCollection = await createTeamCollection.mutateAsync({
        data: { creatorId: userId, name: newName.trim(), description: newDescription.trim() },
      });
      teamCollectionsQuery.refetch();
      setCreateSheetVisible(false);
      router.push({ pathname: "/of-02-detail", params: { id: newTeamCollection.id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "모음 생성에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [newName, newDescription, userId, isCreating, createTeamCollection, teamCollectionsQuery, router]);

  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await teamCollectionsQuery.refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [teamCollectionsQuery]);

  const refetchTeams = teamCollectionsQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      if (isQueryStale(queryClient, getListTeamCollectionsQueryKey({ userId }))) {
        refetchTeams();
      }
    }, [refetchTeams, queryClient, userId]),
  );

  const renderTeamItem = useCallback(({ item }: { item: TeamCollectionWithRole }) => {
    return (
      <ScalePressable
        style={styles.collectionCard}
        onPress={() => router.push({ pathname: "/of-02-detail", params: { id: item.id } })}
      >
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#bf6f78", alignItems: "center", justifyContent: "center" }}>
          <Feather name="users" size={18} color="#FFFFFF" />
        </View>
        <Text style={styles.collectionName} numberOfLines={1}>{item.name}</Text>
        <View style={styles.collectionMeta}>
          <Text style={styles.collectionCount}>{item.role === "OWNER" ? "소유자" : "멤버"}</Text>
        </View>
      </ScalePressable>
    );
  }, [router]);

  const renderEmptyTeam = () => {
    if (groupFilter === "joined") {
      return (
        <RefreshableEmpty
          refreshing={isManualRefreshing}
          onRefresh={handleRefresh}
          contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
        >
          <Feather name="user-check" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>참여 중인 모음이 없어요</Text>
          <Text style={styles.emptySubtitle}>초대 코드를 입력하면 단체 모음에 참여할 수 있어요</Text>
          <ScalePressable style={styles.emptyButton} onPress={handleOpenJoin}>
            <Text style={styles.emptyButtonText}>초대 코드로 참여</Text>
          </ScalePressable>
        </RefreshableEmpty>
      );
    }
    return (
      <RefreshableEmpty
        refreshing={isManualRefreshing}
        onRefresh={handleRefresh}
        contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
      >
        <Feather name="users" size={40} color={Colors.zinc300} />
        <Text style={styles.emptyTitle}>단체 모음이 없어요</Text>
        <Text style={styles.emptySubtitle}>함께 편지를 나눌 모임을 만들어보세요</Text>
        <ScalePressable style={styles.emptyButton} onPress={handleOpenCreate}>
          <Text style={styles.emptyButtonText}>새 단체 모음 만들기</Text>
        </ScalePressable>
      </RefreshableEmpty>
    );
  };

  const renderContent = () => {
    if (teamCollectionsQuery.isLoading) {
      return (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      );
    }

    if (teamCollectionsQuery.isError) {
      return (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기에 실패했어요</Text>
          <ScalePressable style={styles.emptyButton} onPress={handleRefresh}>
            <Text style={styles.emptyButtonText}>다시 시도</Text>
          </ScalePressable>
        </View>
      );
    }

    return filteredTeamCollections.length === 0 ? (
      renderEmptyTeam()
    ) : (
      <FlatList
        {...LIST_PERF_PRESET}
        key="of-group-grid"
        data={filteredTeamCollectionsForGrid}
        keyExtractor={(item) => item.id}
        renderItem={renderTeamItem}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[styles.gridContent, { paddingBottom: navBottom }]}
        refreshControl={<RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} tintColor={Colors.zinc400} />}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          lastSingleTeamCollection ? (
            <View style={[styles.gridRow, { flexDirection: 'row' }]}>
              <ScalePressable
                style={[styles.collectionCard, { flex: 0, width: teamCardWidth }]}
                onPress={() => router.push({ pathname: "/of-02-detail", params: { id: lastSingleTeamCollection.id } })}
              >
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#bf6f78", alignItems: "center", justifyContent: "center" }}>
                  <Feather name="users" size={18} color="#FFFFFF" />
                </View>
                <Text style={styles.collectionName} numberOfLines={1}>{lastSingleTeamCollection.name}</Text>
                <View style={styles.collectionMeta}>
                  <Text style={styles.collectionCount}>{lastSingleTeamCollection.role === "OWNER" ? "소유자" : "멤버"}</Text>
                </View>
              </ScalePressable>
              <View style={{ flex: 0, width: teamCardWidth }} />
            </View>
          ) : null
        }
      />
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="단체 모음"
        showAdd
        onAddPress={handleAdd}
        showSearch
        onSearchPress={handleSearch}
        searchActive={searchActive}
      />

      <View style={styles.filterBar}>
        {GROUP_FILTER_OPTIONS.map((opt) => (
          <ScalePressable
            key={opt.key}
            style={[styles.filterChip, groupFilter === opt.key && styles.filterChipActive]}
            onPress={() => setGroupFilter(opt.key)}
          >
            <Text style={[styles.filterChipText, groupFilter === opt.key && styles.filterChipTextActive]}>
              {opt.label}
            </Text>
          </ScalePressable>
        ))}
      </View>

      <AnimatedSearchBar
        active={searchActive}
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="단체 모음 이름으로 검색"
      />

      {renderContent()}

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
        snapPoints={joinStep === "preview" ? [0.65, 0.92] : [0.6, 0.85]}
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
              autoCorrect={false}
              spellCheck={false}
              textContentType="none"
              autoComplete="off"
              importantForAutofill="no"
              passwordRules=""
              keyboardType="default"
            />
            {joinError ? (
              <Text style={styles.joinErrorText}>{joinError}</Text>
            ) : null}
            <SubmitButton
              style={styles.createConfirmButton}
              disabledStyle={styles.createConfirmDisabled}
              textStyle={styles.createConfirmText}
              onPress={handleJoinCodeSubmit}
              pending={isJoinLoading}
              disabled={!inviteCode.trim()}
              label="다음"
              pendingLabel="확인 중..."
            />
          </View>
        ) : joinPreview ? (
          <View style={styles.joinPreviewContainer}>
            <ScrollView
              style={[styles.joinPreviewScroll, { maxHeight: Math.max(windowH * 0.38, 150) }]}
              contentContainerStyle={styles.joinPreviewCard}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
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
            </ScrollView>
            <View style={styles.joinPreviewActions}>
              {joinError ? (
                <Text style={styles.joinErrorText}>{joinError}</Text>
              ) : null}
              <SubmitButton
                style={styles.createConfirmButton}
                disabledStyle={styles.createConfirmDisabled}
                textStyle={styles.createConfirmText}
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
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={createSheetVisible}
        onClose={() => setCreateSheetVisible(false)}
        title="새 단체 모음"
        snapPoints={[0.65, 0.95]}
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
            style={styles.createConfirmButton}
            disabledStyle={styles.createConfirmDisabled}
            textStyle={styles.createConfirmText}
            onPress={handleCreateConfirm}
            pending={isCreating}
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
  filterBar: {
    flexDirection: "row",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
    paddingVertical: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.zinc50,
  },
  filterChipActive: {
    backgroundColor: Colors.zinc900,
  },
  filterChipText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
  },
  filterChipTextActive: {
    color: Colors.white,
    fontWeight: "600",
  },
  gridContent: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 8,
    gap: 12,
  },
  gridRow: {
    gap: 12,
  },
  collectionCard: {
    flex: 1,
    backgroundColor: Colors.zinc50,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    minHeight: 110,
  },
  collectionName: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc900,
    flex: 1,
  },
  collectionMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  collectionCount: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
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
  actionSheetContent: {
    paddingVertical: 8,
    gap: 4,
  },
  actionSheetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 14,
  },
  actionSheetIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  actionSheetTextWrap: {
    flex: 1,
    gap: 2,
  },
  actionSheetLabel: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  actionSheetDesc: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc400,
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
  createConfirmButton: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  createConfirmDisabled: {
    backgroundColor: Colors.zinc300,
  },
  createConfirmText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  joinHint: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  joinErrorText: {
    ...Typography.caption,
    fontSize: 13,
    color: "#EF4444",
  },
  joinPreviewContainer: {
    flex: 1,
    gap: 16,
  },
  joinPreviewScroll: {
    flexGrow: 0,
  },
  joinPreviewCard: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 8,
  },
  joinPreviewIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  joinPreviewName: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    textAlign: "center",
  },
  joinPreviewDesc: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 20,
  },
  joinPreviewOwner: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc400,
  },
  joinPreviewActions: {
    gap: 8,
  },
  joinBackButton: {
    alignItems: "center",
    paddingVertical: 12,
  },
  joinBackText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
  },
});
