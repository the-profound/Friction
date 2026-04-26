import React, { useCallback, useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  RefreshControl,
  TextInput,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { useNavigation } from "@/contexts/NavigationContext";
import { useUser } from "@/contexts/UserContext";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import {
  useListMyCollections,
  useListTeamCollections,
  useListStoredSentences,
  useCreateMyCollection,
  useCreateTeamCollection,
  useDeleteStoredSentence,
  useToggleStoredSentenceFavorite,
  useAddTeamMember,
  getTeamCollection,
} from "@workspace/api-client-react";
import type {
  MyCollection,
  TeamCollection,
  TeamCollectionWithRole,
  StoredSentence,
} from "@workspace/api-client-react";
import type { GroupMiniSubTabKey } from "@/types/navigation";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import SwipeableRow, { SwipeableRowHandle } from "@/components/SwipeableRow/SwipeableRow";

export default function OfScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ofSubTab, ofMiniSubTab, setOfMiniSubTab } = useNavigation();
  const { userId } = useUser();
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
  const [selectedSentence, setSelectedSentence] = useState<StoredSentence | null>(null);
  const [sentenceDeleteTarget, setSentenceDeleteTarget] = useState<string | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [sentenceScrollEnabled, setSentenceScrollEnabled] = useState(true);
  const sentenceOpenRowRef = useRef<SwipeableRowHandle | null>(null);
  const sentenceRowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());

  const closeSentenceOpenRow = useCallback(() => {
    if (sentenceOpenRowRef.current) {
      sentenceOpenRowRef.current.close();
      sentenceOpenRowRef.current = null;
    }
  }, []);

  const handleSentenceSwipeOpen = useCallback((id: string) => {
    const currentOpen = sentenceOpenRowRef.current;
    const newRef = sentenceRowRefs.current.get(id) ?? null;
    if (currentOpen && currentOpen !== newRef) {
      currentOpen.close();
    }
    sentenceOpenRowRef.current = newRef;
  }, []);

  const myCollectionsQuery = useListMyCollections({ ownerId: userId });
  const teamCollectionsQuery = useListTeamCollections({ userId });
  const sentencesQuery = useListStoredSentences({ userId });

  const createMyCollection = useCreateMyCollection();
  const createTeamCollection = useCreateTeamCollection();
  const deleteSentence = useDeleteStoredSentence();
  const toggleFavorite = useToggleStoredSentenceFavorite();
  const addTeamMember = useAddTeamMember();

  const myCollections = (myCollectionsQuery.data ?? []) as MyCollection[];
  const teamCollections = (teamCollectionsQuery.data ?? []) as TeamCollectionWithRole[];
  const sentences = (sentencesQuery.data ?? []) as StoredSentence[];

  const activeMiniPersonal = ofMiniSubTab.personal;
  const activeMiniGroup = ofMiniSubTab.group as GroupMiniSubTabKey;

  const selectedCount = selectedIds.size;

  const filteredMyCollections = useMemo(() => {
    let list = myCollections;
    if (activeMiniPersonal === "my") {
      list = myCollections.filter((c) => !c.isPublic);
    } else if (activeMiniPersonal === "subscribed") {
      list = myCollections.filter((c) => c.isPublic);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (a.isArchive && !b.isArchive) return -1;
      if (!a.isArchive && b.isArchive) return 1;
      return 0;
    });
  }, [myCollections, searchQuery, activeMiniPersonal]);

  const filteredTeamCollections = useMemo(() => {
    let list = teamCollections;
    if (activeMiniGroup === "my") {
      list = teamCollections.filter((c) => c.role === "OWNER");
    } else if (activeMiniGroup === "joined") {
      list = teamCollections.filter((c) => c.role === "MEMBER");
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [teamCollections, searchQuery, activeMiniGroup]);

  const filteredSentences = useMemo(() => {
    if (!searchQuery.trim()) return sentences;
    const q = searchQuery.toLowerCase();
    return sentences.filter((s) => s.text.toLowerCase().includes(q));
  }, [sentences, searchQuery]);

  const enterSelectionMode = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(true);
    setSearchActive(false);
    setSearchQuery("");
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleBulkDeletePress = useCallback(() => {
    if (selectedIds.size === 0) return;
    setShowBulkDeleteConfirm(true);
  }, [selectedIds]);

  const handleBulkDeleteConfirm = useCallback(async () => {
    setShowBulkDeleteConfirm(false);
    setIsBulkDeleting(true);
    const ids = Array.from(selectedIds);
    let failCount = 0;
    for (const id of ids) {
      try {
        await deleteSentence.mutateAsync({ id });
      } catch {
        failCount++;
      }
    }
    await sentencesQuery.refetch();
    setIsBulkDeleting(false);
    exitSelectionMode();
    if (failCount === 0) {
      Alert.alert("완료", `${ids.length}개 문장을 삭제했어요.`);
    } else if (failCount < ids.length) {
      Alert.alert("오류", `일부 삭제에 실패했어요. (${failCount}개)`);
    } else {
      Alert.alert("오류", "삭제에 실패했어요.");
    }
  }, [selectedIds, deleteSentence, sentencesQuery, exitSelectionMode]);

  const handleSearch = useCallback(() => {
    setSearchActive((prev) => {
      if (prev) setSearchQuery("");
      return !prev;
    });
  }, []);

  const handleAdd = useCallback(() => {
    if (ofSubTab === "sentence") {
      Alert.alert("알림", "읽기 화면에서 문장을 길게 눌러 수집할 수 있어요");
      return;
    }
    if (ofSubTab === "group") {
      setActionSheetVisible(true);
      return;
    }
    setNewName("");
    setNewDescription("");
    setCreateSheetVisible(true);
  }, [ofSubTab]);

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
      setOfMiniSubTab("group", "joined");
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
  }, [joinPreview, userId, addTeamMember, teamCollectionsQuery, setOfMiniSubTab]);

  const isCreating = createMyCollection.isPending || createTeamCollection.isPending;

  const handleCreateConfirm = useCallback(async () => {
    if (!newName.trim()) {
      Alert.alert("오류", "이름을 입력해주세요");
      return;
    }
    if (isCreating) return;
    try {
      if (ofSubTab === "personal") {
        const newMyCollection = await createMyCollection.mutateAsync({
          data: { ownerId: userId, name: newName.trim(), description: newDescription.trim() },
        });
        myCollectionsQuery.refetch();
        setCreateSheetVisible(false);
        router.push({ pathname: "/of-01-detail", params: { id: newMyCollection.id } });
      } else {
        const newTeamCollection = await createTeamCollection.mutateAsync({
          data: { creatorId: userId, name: newName.trim(), description: newDescription.trim() },
        });
        teamCollectionsQuery.refetch();
        setCreateSheetVisible(false);
        router.push({ pathname: "/of-02-detail", params: { id: newTeamCollection.id } });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "모음 생성에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [ofSubTab, newName, newDescription, userId, isCreating, createMyCollection, createTeamCollection, myCollectionsQuery, teamCollectionsQuery, router]);

  const handleSentenceCopy = useCallback(async (text: string) => {
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(text);
      } else {
        await Clipboard.setStringAsync(text);
      }
      Alert.alert("완료", "문장을 복사했어요");
      setSelectedSentence(null);
    } catch {
      Alert.alert("오류", "복사에 실패했어요");
    }
  }, []);

  const handleSentenceToggleFavorite = useCallback(async (id: string, currentFav: boolean) => {
    try {
      await toggleFavorite.mutateAsync({ id, data: { isFavorite: !currentFav } });
      sentencesQuery.refetch();
      if (selectedSentence?.id === id) {
        setSelectedSentence((prev) => prev ? { ...prev, isFavorite: !currentFav } : null);
      }
      Alert.alert("완료", currentFav ? "즐겨찾기를 해제했어요" : "즐겨찾기에 추가했어요");
    } catch {
      Alert.alert("오류", "즐겨찾기 변경에 실패했어요");
    }
  }, [toggleFavorite, sentencesQuery, selectedSentence]);

  const handleSentenceDeleteConfirm = useCallback(async () => {
    if (!sentenceDeleteTarget) return;
    const id = sentenceDeleteTarget;
    setSentenceDeleteTarget(null);
    try {
      await deleteSentence.mutateAsync({ id });
      sentencesQuery.refetch();
      Alert.alert("완료", "문장을 삭제했어요");
    } catch {
      Alert.alert("오류", "삭제에 실패했어요");
    }
  }, [sentenceDeleteTarget, deleteSentence, sentencesQuery]);

  const handleRefresh = useCallback(() => {
    if (ofSubTab === "personal") myCollectionsQuery.refetch();
    else if (ofSubTab === "group") teamCollectionsQuery.refetch();
    else sentencesQuery.refetch();
  }, [ofSubTab, myCollectionsQuery, teamCollectionsQuery, sentencesQuery]);

  const isRefetching =
    ofSubTab === "personal"
      ? myCollectionsQuery.isRefetching
      : ofSubTab === "group"
        ? teamCollectionsQuery.isRefetching
        : sentencesQuery.isRefetching;

  const isLoading =
    ofSubTab === "personal"
      ? myCollectionsQuery.isLoading
      : ofSubTab === "group"
        ? teamCollectionsQuery.isLoading
        : sentencesQuery.isLoading;

  const isError =
    ofSubTab === "personal"
      ? myCollectionsQuery.isError
      : ofSubTab === "group"
        ? teamCollectionsQuery.isError
        : sentencesQuery.isError;

  const renderPersonalItem = ({ item }: { item: MyCollection }) => (
    <Pressable
      style={styles.collectionCard}
      onPress={() => router.push({ pathname: "/of-01-detail", params: { id: item.id } })}
    >
      <View style={styles.collectionIcon}>
        <Feather name="folder" size={20} color={Colors.zinc500} />
      </View>
      <Text style={styles.collectionName} numberOfLines={1}>{item.name}</Text>
      <View style={styles.collectionMeta}>
        <Text style={styles.collectionCount}>{item.articleCount ?? 0}편</Text>
        {item.isPublic && <Feather name="globe" size={12} color={Colors.zinc400} />}
      </View>
    </Pressable>
  );

  const renderTeamItem = ({ item }: { item: TeamCollectionWithRole }) => (
    <Pressable
      style={styles.collectionCard}
      onPress={() => router.push({ pathname: "/of-02-detail", params: { id: item.id } })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center" }}>
        <Feather name="users" size={20} color="#7C3AED" />
      </View>
      <Text style={styles.collectionName} numberOfLines={1}>{item.name}</Text>
      <View style={styles.collectionMeta}>
        <Text style={styles.collectionCount}>{item.role === "OWNER" ? "소유자" : "멤버"}</Text>
      </View>
    </Pressable>
  );

  const renderSentenceItem = useCallback(({ item }: { item: StoredSentence }) => (
    <SwipeableRow
      ref={(r) => {
        if (r) {
          sentenceRowRefs.current.set(item.id, r);
        } else {
          sentenceRowRefs.current.delete(item.id);
        }
      }}
      onDeletePress={() => {
        closeSentenceOpenRow();
        setSentenceDeleteTarget(item.id);
      }}
      onSwipeOpen={() => handleSentenceSwipeOpen(item.id)}
      onScrollLock={(locked) => setSentenceScrollEnabled(!locked)}
    >
      <Pressable
        style={styles.sentenceItem}
        onPress={() => {
          closeSentenceOpenRow();
          setSelectedSentence(item);
        }}
      >
        <View style={styles.sentenceItemContent}>
          <Text style={styles.sentenceText} numberOfLines={2}>
            &ldquo;{item.text}&rdquo;
          </Text>
          <View style={styles.sentenceMeta}>
            <Text style={styles.sentenceDate}>{new Date(item.createdAt).toLocaleDateString("ko-KR")}</Text>
            {item.isFavorite && <Feather name="star" size={12} color="#F59E0B" />}
          </View>
        </View>
        <Pressable
          onPress={() => handleSentenceToggleFavorite(item.id, item.isFavorite)}
          hitSlop={8}
          style={styles.sentenceStarBtn}
        >
          <Feather name="star" size={16} color={item.isFavorite ? "#F59E0B" : Colors.zinc300} />
        </Pressable>
      </Pressable>
    </SwipeableRow>
  ), [handleSentenceToggleFavorite, closeSentenceOpenRow, handleSentenceSwipeOpen]);

  const renderSentenceSelectionItem = useCallback(({ item }: { item: StoredSentence }) => {
    const isSelected = selectedIds.has(item.id);
    return (
      <Pressable
        style={styles.selectionRow}
        onPress={() => toggleSelect(item.id)}
      >
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && <Feather name="check" size={14} color={Colors.white} />}
        </View>
        <View style={styles.sentenceItemContent}>
          <Text style={styles.sentenceText} numberOfLines={2}>
            &ldquo;{item.text}&rdquo;
          </Text>
          <View style={styles.sentenceMeta}>
            <Text style={styles.sentenceDate}>{new Date(item.createdAt).toLocaleDateString("ko-KR")}</Text>
            {item.isFavorite && <Feather name="star" size={12} color="#F59E0B" />}
          </View>
        </View>
      </Pressable>
    );
  }, [selectedIds, toggleSelect]);

  const renderEmptyPersonal = () => {
    if (activeMiniPersonal === "subscribed") {
      return (
        <View style={styles.emptyContainer}>
          <Feather name="globe" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>구독 모음이 없어요</Text>
          <Text style={styles.emptySubtitle}>공개로 설정한 모음이 여기에 표시돼요{"\n"}구독 기능은 추후 업데이트 예정이에요</Text>
          <Pressable style={styles.emptyButton} onPress={handleAdd}>
            <Text style={styles.emptyButtonText}>새 모음 만들기</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Feather name="folder" size={40} color={Colors.zinc300} />
        <Text style={styles.emptyTitle}>내 모음이 없어요</Text>
        <Text style={styles.emptySubtitle}>완성된 편지를 모아두는 나만의 공간을 만들어보세요</Text>
        <Pressable style={styles.emptyButton} onPress={handleAdd}>
          <Text style={styles.emptyButtonText}>새 모음 만들기</Text>
        </Pressable>
      </View>
    );
  };

  const renderEmptyTeam = () => {
    if (activeMiniGroup === "joined") {
      return (
        <View style={styles.emptyContainer}>
          <Feather name="user-check" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>참여 중인 모음이 없어요</Text>
          <Text style={styles.emptySubtitle}>초대 코드를 입력하면 단체 모음에 참여할 수 있어요</Text>
          <Pressable style={styles.emptyButton} onPress={handleOpenJoin}>
            <Text style={styles.emptyButtonText}>초대 코드로 참여</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Feather name="users" size={40} color={Colors.zinc300} />
        <Text style={styles.emptyTitle}>단체 모음이 없어요</Text>
        <Text style={styles.emptySubtitle}>함께 글을 나눌 모임을 만들어보세요</Text>
        <Pressable style={styles.emptyButton} onPress={handleOpenCreate}>
          <Text style={styles.emptyButtonText}>새 단체 모음 만들기</Text>
        </Pressable>
      </View>
    );
  };

  const renderEmptySentence = () => (
    <View style={styles.emptyContainer}>
      <Feather name="bookmark" size={40} color={Colors.zinc300} />
      <Text style={styles.emptyTitle}>수집한 문장이 없어요</Text>
      <Text style={styles.emptySubtitle}>읽기 화면에서 마음에 드는 문장을{"\n"}길게 눌러 수집해보세요</Text>
    </View>
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      );
    }

    if (isError) {
      return (
        <View style={styles.emptyContainer}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기에 실패했어요</Text>
          <Pressable style={styles.emptyButton} onPress={handleRefresh}>
            <Text style={styles.emptyButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      );
    }

    switch (ofSubTab) {
      case "personal":
        return filteredMyCollections.length === 0 ? (
          renderEmptyPersonal()
        ) : (
          <FlatList
            key="of-personal-grid"
            data={filteredMyCollections}
            keyExtractor={(item) => item.id}
            renderItem={renderPersonalItem}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridContent}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={Colors.zinc400} />}
            showsVerticalScrollIndicator={false}
          />
        );
      case "group":
        return filteredTeamCollections.length === 0 ? (
          renderEmptyTeam()
        ) : (
          <FlatList
            key="of-group-grid"
            data={filteredTeamCollections}
            keyExtractor={(item) => item.id}
            renderItem={renderTeamItem}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridContent}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={Colors.zinc400} />}
            showsVerticalScrollIndicator={false}
          />
        );
      case "sentence":
        return filteredSentences.length === 0 ? (
          renderEmptySentence()
        ) : (
          <FlatList
            key="of-sentence-list"
            data={filteredSentences}
            keyExtractor={(item) => item.id}
            renderItem={selectionMode ? renderSentenceSelectionItem : renderSentenceItem}
            contentContainerStyle={[
              styles.listContent,
              selectionMode && { paddingBottom: insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + 80 },
            ]}
            refreshControl={
              !selectionMode ? (
                <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={Colors.zinc400} />
              ) : undefined
            }
            scrollEnabled={selectionMode || sentenceScrollEnabled}
            showsVerticalScrollIndicator={false}
          />
        );
    }
  };

  const isSentenceSelectionMode = ofSubTab === "sentence" && selectionMode;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {isSentenceSelectionMode ? (
        <View style={styles.selectionHeader}>
          <Pressable onPress={exitSelectionMode} hitSlop={12}>
            <Text style={styles.selectionCancelText}>취소</Text>
          </Pressable>
          <Text style={styles.selectionHeaderTitle}>
            {selectedCount > 0 ? `${selectedCount}개 선택` : "문장 선택"}
          </Text>
          <View style={{ width: 44 }} />
        </View>
      ) : (
        <PageHeader
          title="보관함"
          showAdd={ofSubTab !== "sentence"}
          onAddPress={handleAdd}
          showSearch
          onSearchPress={handleSearch}
          searchActive={searchActive}
          showKebab={ofSubTab === "sentence"}
          onKebabPress={enterSelectionMode}
        />
      )}

      {!selectionMode && searchActive && (
        <View style={styles.searchBar}>
          <Feather name="search" size={16} color={Colors.zinc400} />
          <TextInput
            style={styles.searchInput}
            placeholder={
              ofSubTab === "personal"
                ? "모음 이름으로 검색"
                : ofSubTab === "group"
                  ? "단체 모음 이름으로 검색"
                  : "문장 내용으로 검색"
            }
            placeholderTextColor={Colors.zinc400}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <Feather name="x" size={16} color={Colors.zinc400} />
            </Pressable>
          )}
        </View>
      )}

      {renderContent()}

      {isSentenceSelectionMode && (
        <View style={[styles.selectionBar, { paddingBottom: insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + 12 }]}>
          <Pressable
            style={[
              styles.bulkDeleteButton,
              (selectedCount === 0 || isBulkDeleting) && styles.bulkDeleteButtonDisabled,
            ]}
            onPress={handleBulkDeletePress}
            disabled={selectedCount === 0 || isBulkDeleting}
          >
            <Text style={styles.bulkDeleteText}>
              {isBulkDeleting
                ? "삭제 중..."
                : selectedCount > 0
                  ? `${selectedCount}개 선택 삭제`
                  : "선택 삭제"}
            </Text>
          </Pressable>
        </View>
      )}

      <BottomSheet
        visible={actionSheetVisible}
        onClose={() => setActionSheetVisible(false)}
        snapPoints={[0.28]}
      >
        <View style={styles.actionSheetContent}>
          <Pressable style={styles.actionSheetRow} onPress={handleOpenCreate}>
            <View style={styles.actionSheetIcon}>
              <Feather name="plus-circle" size={20} color={Colors.zinc700} />
            </View>
            <View style={styles.actionSheetTextWrap}>
              <Text style={styles.actionSheetLabel}>새로 만들기</Text>
              <Text style={styles.actionSheetDesc}>직접 단체 모음을 만들어요</Text>
            </View>
          </Pressable>
          <Pressable style={styles.actionSheetRow} onPress={handleOpenJoin}>
            <View style={styles.actionSheetIcon}>
              <Feather name="log-in" size={20} color={Colors.zinc700} />
            </View>
            <View style={styles.actionSheetTextWrap}>
              <Text style={styles.actionSheetLabel}>기존 모음에 참가하기</Text>
              <Text style={styles.actionSheetDesc}>초대 코드로 참여해요</Text>
            </View>
          </Pressable>
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
            <Pressable
              style={styles.joinBackButton}
              onPress={() => { setJoinStep("code"); setJoinError(null); }}
            >
              <Text style={styles.joinBackText}>다른 코드 입력</Text>
            </Pressable>
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={createSheetVisible}
        onClose={() => setCreateSheetVisible(false)}
        title={ofSubTab === "personal" ? "새 개인 모음" : "새 단체 모음"}
        snapPoints={[0.55, 0.95]}
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

      <BottomSheet
        visible={selectedSentence !== null}
        onClose={() => setSelectedSentence(null)}
        snapPoints={[0.55]}
      >
        {selectedSentence && (
          <View style={styles.sentenceSheetContainer}>
            <Text style={styles.sentenceSheetQuote}>
              &ldquo;{selectedSentence.text}&rdquo;
            </Text>
            <Text style={styles.sentenceSheetDate}>
              {new Date(selectedSentence.createdAt).toLocaleDateString("ko-KR")}
            </Text>
            <View style={styles.sentenceSheetDivider} />
            <View style={styles.sentenceSheetActions}>
              <Pressable
                style={styles.sentenceSheetRow}
                onPress={() => handleSentenceCopy(selectedSentence.text)}
              >
                <Feather name="copy" size={18} color={Colors.zinc700} />
                <Text style={styles.sentenceSheetActionLabel}>복사하기</Text>
              </Pressable>
              <Pressable
                style={styles.sentenceSheetRow}
                onPress={() => handleSentenceToggleFavorite(selectedSentence.id, selectedSentence.isFavorite)}
              >
                <Feather
                  name="star"
                  size={18}
                  color={selectedSentence.isFavorite ? "#F59E0B" : Colors.zinc700}
                />
                <Text style={[styles.sentenceSheetActionLabel, selectedSentence.isFavorite && { color: "#F59E0B" }]}>
                  {selectedSentence.isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                </Text>
              </Pressable>
              {selectedSentence.articleId && (
                <Pressable
                  style={styles.sentenceSheetRow}
                  onPress={() => {
                    setSelectedSentence(null);
                    router.push({ pathname: "/read", params: { articleId: selectedSentence.articleId, mode: "re_read" } });
                  }}
                >
                  <Feather name="external-link" size={18} color={Colors.zinc700} />
                  <Text style={styles.sentenceSheetActionLabel}>원본으로 이동</Text>
                </Pressable>
              )}
              <Pressable
                style={styles.sentenceSheetRow}
                onPress={() => {
                  setSentenceDeleteTarget(selectedSentence.id);
                  setSelectedSentence(null);
                }}
              >
                <Feather name="trash-2" size={18} color="#DC2626" />
                <Text style={[styles.sentenceSheetActionLabel, { color: "#DC2626" }]}>삭제</Text>
              </Pressable>
              <Pressable
                style={[styles.sentenceSheetRow, styles.sentenceSheetCancel]}
                onPress={() => setSelectedSentence(null)}
              >
                <Text style={styles.sentenceSheetCancelLabel}>닫기</Text>
              </Pressable>
            </View>
          </View>
        )}
      </BottomSheet>

      <ConfirmModal
        visible={sentenceDeleteTarget !== null}
        title="문장 삭제"
        description="이 문장을 삭제하시겠어요?"
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleSentenceDeleteConfirm}
        onCancel={() => setSentenceDeleteTarget(null)}
      />

      <ConfirmModal
        visible={showBulkDeleteConfirm}
        title="문장 삭제"
        description={`선택한 ${selectedCount}개 문장을 삭제하시겠어요?`}
        confirmLabel="삭제"
        cancelLabel="취소"
        destructive
        onConfirm={handleBulkDeleteConfirm}
        onCancel={() => setShowBulkDeleteConfirm(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  selectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 50,
    paddingBottom: 20,
    backgroundColor: Colors.white,
  },
  selectionHeaderTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  selectionCancelText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.zinc50,
    marginHorizontal: Spacing.screenPx,
    borderRadius: 20,
    height: 40,
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc900,
    padding: 0,
  },
  gridContent: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 8,
    paddingBottom: Spacing.navBarPaddingBottom,
  },
  gridRow: {
    gap: 12,
    marginBottom: 12,
  },
  listContent: {
    paddingBottom: Spacing.navBarPaddingBottom,
  },
  collectionCard: {
    flex: 1,
    backgroundColor: Colors.zinc50,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    maxWidth: "48%",
  },
  collectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  collectionName: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  collectionMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  collectionCount: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  sentenceItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 8,
  },
  selectionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.zinc300,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    flexShrink: 0,
  },
  checkboxSelected: {
    backgroundColor: Colors.zinc900,
    borderColor: Colors.zinc900,
  },
  sentenceItemContent: {
    flex: 1,
  },
  sentenceStarBtn: {
    padding: 4,
  },
  sentenceText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
    fontStyle: "italic",
    lineHeight: 22,
  },
  sentenceMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  sentenceDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  selectionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    backgroundColor: Colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  bulkDeleteButton: {
    backgroundColor: "#EF4444",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  bulkDeleteButtonDisabled: {
    opacity: 0.4,
  },
  bulkDeleteText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
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
    lineHeight: 22,
  },
  emptyButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
  },
  emptyButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
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
  sentenceSheetContainer: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  sentenceSheetQuote: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc800,
    fontStyle: "italic",
    lineHeight: 26,
    paddingHorizontal: Spacing.screenPx,
    marginBottom: 10,
  },
  sentenceSheetDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
    paddingHorizontal: Spacing.screenPx,
    marginBottom: 12,
  },
  sentenceSheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.zinc100,
    marginBottom: 4,
  },
  sentenceSheetActions: {
    paddingHorizontal: Spacing.screenPx,
  },
  sentenceSheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
  },
  sentenceSheetActionLabel: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc800,
  },
  sentenceSheetCancel: {
    justifyContent: "center",
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  sentenceSheetCancelLabel: {
    ...Typography.body,
    fontSize: 15,
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
  joinHint: {
    ...Typography.body,
    fontSize: 14,
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
