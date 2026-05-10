import React, { useCallback, useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TextInput,
  Platform,
  Alert,
  useWindowDimensions,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import AnimatedSearchBar from "@/components/AnimatedSearchBar/AnimatedSearchBar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Feather, AntDesign } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { useUser } from "@/contexts/UserContext";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import {
  useListMyCollections,
  useListStoredSentences,
  useCreateMyCollection,
  useDeleteStoredSentence,
  useToggleStoredSentenceFavorite,
  useCreateArticle,
  getListMyCollectionsQueryKey,
  getListStoredSentencesQueryKey,
} from "@workspace/api-client-react";
import type { MyCollection, StoredSentence } from "@workspace/api-client-react";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import SwipeableRow, { SwipeableRowHandle } from "@/components/SwipeableRow/SwipeableRow";
import { isQueryStale } from "@/lib/useScreenFocused";
import { useQueryClient } from "@tanstack/react-query";
import { LIST_PERF_PRESET } from "@/lib/listPerf";

type ArchiveSubTab = "personal" | "sentence";

export default function ArchiveScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId } = useUser();
  const queryClient = useQueryClient();

  const [activeSubTab, setActiveSubTab] = useState<ArchiveSubTab>("personal");
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const [selectedSentence, setSelectedSentence] = useState<StoredSentence | null>(null);
  const [sentenceDeleteTarget, setSentenceDeleteTarget] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [sentenceScrollEnabled, setSentenceScrollEnabled] = useState(true);
  const [favOverrides, setFavOverrides] = useState<Map<string, boolean>>(new Map());
  const sentenceOpenRowRef = useRef<SwipeableRowHandle | null>(null);
  const sentenceRowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());

  const myCollectionsQuery = useListMyCollections({ ownerId: userId });
  const sentencesQuery = useListStoredSentences({ userId });

  const createMyCollection = useCreateMyCollection();
  const deleteSentence = useDeleteStoredSentence();
  const toggleFavorite = useToggleStoredSentenceFavorite();
  const createArticle = useCreateArticle();

  const myCollections = (myCollectionsQuery.data ?? []) as MyCollection[];
  const sentences = (sentencesQuery.data ?? []) as StoredSentence[];

  const selectedCount = selectedIds.size;

  const filteredMyCollections = useMemo(() => {
    let list = myCollections;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (a.isArchive && !b.isArchive) return -1;
      if (!a.isArchive && b.isArchive) return 1;
      return 0;
    });
  }, [myCollections, searchQuery]);

  const impressionCollection = useMemo(() => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const found = myCollections.find((c) => c.isImpression);
      return found && found.name.toLowerCase().includes(q) ? found : null;
    }
    return myCollections.find((c) => c.isImpression) ?? null;
  }, [myCollections, searchQuery]);

  const regularCollections = useMemo(() => {
    return filteredMyCollections.filter((c) => !c.isImpression);
  }, [filteredMyCollections]);

  const isOddPersonal = regularCollections.length % 2 !== 0;

  const regularCollectionsForGrid = useMemo<MyCollection[]>(() => {
    return isOddPersonal ? regularCollections.slice(0, -1) : regularCollections;
  }, [regularCollections, isOddPersonal]);

  const lastSingleCollection = useMemo<MyCollection | null>(() => {
    return isOddPersonal ? regularCollections[regularCollections.length - 1] ?? null : null;
  }, [regularCollections, isOddPersonal]);

  const collectionCardWidth = (windowWidth - Spacing.screenPx * 2 - 12) / 2;

  const filteredSentences = useMemo(() => {
    if (!searchQuery.trim()) return sentences;
    const q = searchQuery.toLowerCase();
    return sentences.filter((s) => s.text.toLowerCase().includes(q));
  }, [sentences, searchQuery]);

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
    if (activeSubTab === "sentence") {
      Alert.alert("알림", "읽기 화면에서 문장을 길게 눌러 수집할 수 있어요");
      return;
    }
    setNewName("");
    setNewDescription("");
    setCreateSheetVisible(true);
  }, [activeSubTab]);

  const isCreating = createMyCollection.isPending;

  const handleCreateConfirm = useCallback(async () => {
    if (!newName.trim()) {
      Alert.alert("오류", "이름을 입력해주세요");
      return;
    }
    if (isCreating) return;
    try {
      const newMyCollection = await createMyCollection.mutateAsync({
        data: { ownerId: userId, name: newName.trim(), description: newDescription.trim() },
      });
      myCollectionsQuery.refetch();
      setCreateSheetVisible(false);
      router.push({ pathname: "/of-01-detail", params: { id: newMyCollection.id, name: newName.trim() } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "폴더 생성에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [newName, newDescription, userId, isCreating, createMyCollection, myCollectionsQuery, router]);

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
    if (toggleFavorite.isPending) return;
    const newFav = !currentFav;
    setFavOverrides((prev) => new Map(prev).set(id, newFav));
    if (selectedSentence?.id === id) {
      setSelectedSentence((prev) => prev ? { ...prev, isFavorite: newFav } : null);
    }
    try {
      await toggleFavorite.mutateAsync({ id, data: { isFavorite: newFav } });
    } catch {
      setFavOverrides((prev) => { const next = new Map(prev); next.delete(id); return next; });
      if (selectedSentence?.id === id) {
        setSelectedSentence((prev) => prev ? { ...prev, isFavorite: currentFav } : null);
      }
      Alert.alert("오류", "즐겨찾기 변경에 실패했어요");
      return;
    }
    await sentencesQuery.refetch();
    setFavOverrides((prev) => { const next = new Map(prev); next.delete(id); return next; });
  }, [toggleFavorite, sentencesQuery, selectedSentence]);

  const handleSentenceQuoteAsMemo = useCallback(async (sentence: StoredSentence) => {
    const position = sentence.position as { page?: number } | null;
    const page = position && typeof position.page === "number" ? position.page : undefined;
    const quoteBlock = sentence.articleTitle
      ? `> ${sentence.text.trim()}\n>\n> <${sentence.articleTitle}>${page !== undefined ? `, ${page + 1}면` : ""}`
      : `> ${sentence.text.trim()}\n`;
    try {
      const rawText = sentence.text.trim();
      const truncated = rawText.length > 50 ? rawText.slice(0, 50) + "…" : rawText;
      const article = await createArticle.mutateAsync({
        data: { authorId: userId, title: `문장 수집 - ${truncated}`, content: quoteBlock },
      });
      setSelectedSentence(null);
      router.push({ pathname: "/on-01a", params: { id: article.id } });
    } catch {
      Alert.alert("오류", "메모 생성에 실패했습니다.");
    }
  }, [createArticle, userId, router]);

  const handleSentenceDeleteConfirm = useCallback(async () => {
    if (!sentenceDeleteTarget || deleteSentence.isPending) return;
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

  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      if (activeSubTab === "personal") await myCollectionsQuery.refetch();
      else await sentencesQuery.refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [activeSubTab, myCollectionsQuery, sentencesQuery]);

  const refetchPersonal = myCollectionsQuery.refetch;
  const refetchSentences = sentencesQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      if (isQueryStale(queryClient, getListMyCollectionsQueryKey({ ownerId: userId }))) {
        refetchPersonal();
      }
      if (isQueryStale(queryClient, getListStoredSentencesQueryKey({ userId }))) {
        refetchSentences();
      }
    }, [refetchPersonal, refetchSentences, queryClient, userId]),
  );

  const isLoading =
    activeSubTab === "personal"
      ? myCollectionsQuery.isLoading
      : sentencesQuery.isLoading;

  const isError =
    activeSubTab === "personal"
      ? myCollectionsQuery.isError
      : sentencesQuery.isError;

  const renderPersonalItem = useCallback(({ item }: { item: MyCollection }) => {
    return (
      <ScalePressable
        style={styles.collectionCard}
        onPress={() => router.push({ pathname: "/of-01-detail", params: { id: item.id, name: item.name } })}
      >
        <View style={styles.collectionIcon}>
          <Feather name="folder" size={20} color={Colors.zinc500} />
        </View>
        <Text style={styles.collectionName} numberOfLines={1}>{item.name}</Text>
        <View style={styles.collectionMeta}>
          <Text style={styles.collectionCount}>{item.articleCount ?? 0}편</Text>
          {item.isPublic && <Feather name="globe" size={12} color={Colors.zinc400} />}
        </View>
      </ScalePressable>
    );
  }, [router]);

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
      <ScalePressable
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
          {item.articleTitle ? (
            <Text style={styles.sentenceSource} numberOfLines={1}>{item.articleTitle}</Text>
          ) : null}
          <View style={styles.sentenceMeta}>
            <Text style={styles.sentenceDate}>{new Date(item.createdAt).toLocaleDateString("ko-KR")}</Text>
            {(favOverrides.has(item.id) ? favOverrides.get(item.id) : item.isFavorite) && (
              <AntDesign name="star" size={12} color="#F59E0B" />
            )}
          </View>
        </View>
        <ScalePressable
          onPress={() => handleSentenceToggleFavorite(item.id, favOverrides.has(item.id) ? favOverrides.get(item.id)! : item.isFavorite)}
          hitSlop={8}
          style={styles.sentenceStarBtn}
        >
          {(favOverrides.has(item.id) ? favOverrides.get(item.id) : item.isFavorite) ? (
            <AntDesign name="star" size={22} color="#F59E0B" />
          ) : (
            <Feather name="star" size={22} color={Colors.zinc300} />
          )}
        </ScalePressable>
      </ScalePressable>
    </SwipeableRow>
  ), [handleSentenceToggleFavorite, closeSentenceOpenRow, handleSentenceSwipeOpen, favOverrides]);

  const renderSentenceSelectionItem = useCallback(({ item }: { item: StoredSentence }) => {
    const isSelected = selectedIds.has(item.id);
    return (
      <ScalePressable
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
          {item.articleTitle ? (
            <Text style={styles.sentenceSource} numberOfLines={1}>{item.articleTitle}</Text>
          ) : null}
          <View style={styles.sentenceMeta}>
            <Text style={styles.sentenceDate}>{new Date(item.createdAt).toLocaleDateString("ko-KR")}</Text>
            {item.isFavorite && <AntDesign name="star" size={12} color="#F59E0B" />}
          </View>
        </View>
      </ScalePressable>
    );
  }, [selectedIds, toggleSelect]);

  const renderEmptyPersonal = () => (
    <RefreshableEmpty
      refreshing={isManualRefreshing}
      onRefresh={handleRefresh}
      contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
    >
      <Feather name="folder" size={40} color={Colors.zinc300} />
      <Text style={styles.emptyTitle}>내 폴더가 없어요</Text>
      <Text style={styles.emptySubtitle}>완성된 편지를 모아두는 나만의 공간을 만들어보세요</Text>
      <ScalePressable style={styles.emptyButton} onPress={handleAdd}>
        <Text style={styles.emptyButtonText}>새 폴더 만들기</Text>
      </ScalePressable>
    </RefreshableEmpty>
  );

  const renderEmptySentence = () => (
    <RefreshableEmpty
      refreshing={isManualRefreshing}
      onRefresh={handleRefresh}
      contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
    >
      <Feather name="bookmark" size={40} color={Colors.zinc300} />
      <Text style={styles.emptyTitle}>수집한 문장이 없어요</Text>
      <Text style={styles.emptySubtitle}>읽기 화면에서 마음에 드는 문장을{"\n"}길게 눌러 수집해보세요</Text>
    </RefreshableEmpty>
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={[styles.emptyContainer, { paddingBottom: navBottom }]}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      );
    }

    if (isError) {
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

    if (activeSubTab === "personal") {
      const hasContent = impressionCollection !== null || regularCollections.length > 0;
      return !hasContent ? (
        renderEmptyPersonal()
      ) : (
        <FlatList
          {...LIST_PERF_PRESET}
          key="archive-personal-grid"
          data={regularCollectionsForGrid}
          keyExtractor={(item) => item.id}
          renderItem={renderPersonalItem}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[styles.gridContent, { paddingBottom: navBottom, paddingTop: impressionCollection ? 0 : 12 }]}
          refreshControl={<RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} tintColor={Colors.zinc400} />}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            lastSingleCollection ? (
              <View style={[styles.gridRow, { flexDirection: 'row' }]}>
                <ScalePressable
                  style={[styles.collectionCard, { flex: 0, width: collectionCardWidth }]}
                  onPress={() => router.push({ pathname: "/of-01-detail", params: { id: lastSingleCollection.id, name: lastSingleCollection.name } })}
                >
                  <View style={styles.collectionIcon}>
                    <Feather name="folder" size={20} color={Colors.zinc500} />
                  </View>
                  <Text style={styles.collectionName} numberOfLines={1}>{lastSingleCollection.name}</Text>
                  <View style={styles.collectionMeta}>
                    <Text style={styles.collectionCount}>{lastSingleCollection.articleCount ?? 0}편</Text>
                    {lastSingleCollection.isPublic && <Feather name="globe" size={12} color={Colors.zinc400} />}
                  </View>
                </ScalePressable>
                <View style={{ flex: 0, width: collectionCardWidth }} />
              </View>
            ) : null
          }
          ListHeaderComponent={
            impressionCollection ? (
              <ScalePressable
                style={styles.impressionCard}
                onPress={() => router.push({ pathname: "/of-01-detail", params: { id: impressionCollection.id, name: impressionCollection.name } })}
              >
                <View style={styles.collectionIcon}>
                  <Feather name="heart" size={20} color={Colors.zinc500} />
                </View>
                <Text style={styles.collectionName} numberOfLines={1}>{impressionCollection.name}</Text>
                <View style={styles.collectionMeta}>
                  <Text style={styles.collectionCount}>{impressionCollection.articleCount ?? 0}편</Text>
                  {impressionCollection.isPublic && <Feather name="globe" size={12} color={Colors.zinc400} />}
                </View>
              </ScalePressable>
            ) : null
          }
        />
      );
    }

    return filteredSentences.length === 0 ? (
      renderEmptySentence()
    ) : (
      <FlatList
        {...LIST_PERF_PRESET}
        key="archive-sentence-list"
        data={filteredSentences}
        keyExtractor={(item) => item.id}
        renderItem={selectionMode ? renderSentenceSelectionItem : renderSentenceItem}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: selectionMode ? insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + 80 : navBottom },
        ]}
        refreshControl={
          !selectionMode ? (
            <RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} tintColor={Colors.zinc400} />
          ) : undefined
        }
        scrollEnabled={selectionMode || sentenceScrollEnabled}
        showsVerticalScrollIndicator={false}
      />
    );
  };

  const isSentenceSelectionMode = activeSubTab === "sentence" && selectionMode;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {isSentenceSelectionMode ? (
        <View style={styles.selectionHeader}>
          <ScalePressable onPress={exitSelectionMode} hitSlop={12}>
            <Text style={styles.selectionCancelText}>취소</Text>
          </ScalePressable>
          <Text style={styles.selectionHeaderTitle}>
            {selectedCount > 0 ? `${selectedCount}개 선택` : "문장 선택"}
          </Text>
          <View style={{ width: 44 }} />
        </View>
      ) : (
        <PageHeader
          title="보관함"
          showAdd={activeSubTab !== "sentence"}
          onAddPress={handleAdd}
          showSearch
          onSearchPress={handleSearch}
          searchActive={searchActive}
          showKebab={activeSubTab === "sentence"}
          onKebabPress={enterSelectionMode}
          searchLast={activeSubTab === "sentence"}
        />
      )}

      {!selectionMode && (
        <View style={styles.subTabBar}>
          <View style={{ flex: 1 }}>
            <ScalePressable
              style={[styles.subTabItem, { paddingLeft: 16, paddingRight: 8 }]}
              onPress={() => { setActiveSubTab("personal"); setSearchQuery(""); setSearchActive(false); }}
            >
              <Text style={[styles.subTabText, activeSubTab === "personal" && styles.subTabTextActive]}>
                폴더
              </Text>
              {activeSubTab === "personal" && <View style={styles.subTabUnderline} />}
            </ScalePressable>
          </View>
          <View style={{ flex: 1 }}>
            <ScalePressable
              style={[styles.subTabItem, { paddingLeft: 8, paddingRight: 16 }]}
              onPress={() => { setActiveSubTab("sentence"); setSearchQuery(""); setSearchActive(false); exitSelectionMode(); }}
            >
              <Text style={[styles.subTabText, activeSubTab === "sentence" && styles.subTabTextActive]}>
                수집한 문장
              </Text>
              {activeSubTab === "sentence" && <View style={styles.subTabUnderline} />}
            </ScalePressable>
          </View>
        </View>
      )}


      {!selectionMode && (
        <AnimatedSearchBar
          active={searchActive}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={activeSubTab === "personal" ? "폴더 이름으로 검색" : "문장 내용으로 검색"}
          extraTopSpacing
        />
      )}

      {renderContent()}

      {isSentenceSelectionMode && (
        <View style={[styles.selectionBar, { paddingBottom: insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + 12 }]}>
          <ScalePressable
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
          </ScalePressable>
        </View>
      )}

      <BottomSheet
        visible={createSheetVisible}
        onClose={() => setCreateSheetVisible(false)}
        title="새 폴더"
        snapPoints={[0.65, 0.95]}
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
              <ScalePressable
                style={styles.sentenceSheetRow}
                onPress={() => handleSentenceCopy(selectedSentence.text)}
              >
                <Feather name="copy" size={18} color={Colors.zinc700} />
                <Text style={styles.sentenceSheetActionLabel}>복사하기</Text>
              </ScalePressable>
              <ScalePressable
                style={styles.sentenceSheetRow}
                onPress={() => handleSentenceToggleFavorite(selectedSentence.id, selectedSentence.isFavorite)}
              >
                {selectedSentence.isFavorite ? (
                  <AntDesign name="star" size={22} color="#F59E0B" />
                ) : (
                  <Feather name="star" size={22} color={Colors.zinc700} />
                )}
                <Text style={[styles.sentenceSheetActionLabel, selectedSentence.isFavorite && { color: "#F59E0B" }]}>
                  {selectedSentence.isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                </Text>
              </ScalePressable>
              <ScalePressable
                style={styles.sentenceSheetRow}
                onPress={() => handleSentenceQuoteAsMemo(selectedSentence)}
              >
                <Feather name="edit" size={18} color={Colors.zinc700} />
                <Text style={styles.sentenceSheetActionLabel}>인용해서 메모 작성</Text>
              </ScalePressable>
              {selectedSentence.articleId && (
                <ScalePressable
                  style={styles.sentenceSheetRow}
                  onPress={() => {
                    setSelectedSentence(null);
                    router.push({ pathname: "/read", params: { articleId: selectedSentence.articleId, mode: "re_read" } });
                  }}
                >
                  <Feather name="external-link" size={18} color={Colors.zinc700} />
                  <Text style={styles.sentenceSheetActionLabel}>원본으로 이동</Text>
                </ScalePressable>
              )}
              <ScalePressable
                style={styles.sentenceSheetRow}
                onPress={() => {
                  setSentenceDeleteTarget(selectedSentence.id);
                  setSelectedSentence(null);
                }}
              >
                <Feather name="trash-2" size={18} color="#DC2626" />
                <Text style={[styles.sentenceSheetActionLabel, { color: "#DC2626" }]}>삭제</Text>
              </ScalePressable>
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
  subTabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
    marginBottom: 8,
  },
  subTabItem: {
    paddingHorizontal: 0,
    paddingTop: 12,
    paddingBottom: 0,
    alignItems: "center",
  },
  subTabText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc400,
    paddingBottom: 10,
  },
  subTabTextActive: {
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
  },
  subTabUnderline: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: Colors.zinc900,
    borderRadius: 1,
  },
  gridContent: {
    paddingHorizontal: Spacing.screenPx,
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
  impressionCard: {
    width: '100%',
    backgroundColor: Colors.zinc50,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    minHeight: 110,
  },
  collectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
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
  listContent: {
    paddingTop: 4,
  },
  sentenceItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 12,
  },
  sentenceItemContent: {
    flex: 1,
    gap: 4,
  },
  sentenceText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc800,
    lineHeight: 20,
  },
  sentenceSource: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  sentenceMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sentenceDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  sentenceStarBtn: {
    padding: 4,
  },
  selectionRow: {
    flexDirection: "row",
    alignItems: "center",
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
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    backgroundColor: Colors.zinc900,
    borderColor: Colors.zinc900,
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
  },
  bulkDeleteButtonDisabled: {
    backgroundColor: Colors.zinc200,
  },
  bulkDeleteText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
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
    paddingVertical: 8,
    gap: 4,
  },
  sentenceSheetQuote: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc800,
    lineHeight: 24,
    paddingHorizontal: 4,
  },
  sentenceSheetDate: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc400,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  sentenceSheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.zinc100,
    marginVertical: 12,
  },
  sentenceSheetActions: {
    gap: 4,
  },
  sentenceSheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  sentenceSheetActionLabel: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc800,
  },
});
