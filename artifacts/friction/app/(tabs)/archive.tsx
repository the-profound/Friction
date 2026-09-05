import React, { useCallback, useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TextInput,
  Platform,
  useWindowDimensions,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import AnimatedSearchBar from "@/components/AnimatedSearchBar/AnimatedSearchBar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { useReaderTransition } from "@/contexts/ReaderTransitionContext";
import { Feather, AntDesign } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import {
  Colors,
  ReaderTokens,
  Shadows,
  Typography,
  Spacing,
  Sizing,
  readerFontSize,
} from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import RefreshableEmpty from "@/components/RefreshableEmpty";
import {
  useListMyCollections,
  useListStoredSentences,
  useCreateMyCollection,
  useDeleteStoredSentence,
  useToggleStoredSentenceFavorite,
  useCreateThought,
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
  const { startFadeToBlack } = useReaderTransition();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId } = useUser();
  const { showToast } = useToast();
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
  const sentenceOpenRowRef = useRef<SwipeableRowHandle | null>(null);
  const sentenceRowRefs = useRef<Map<string, SwipeableRowHandle>>(new Map());

  const myCollectionsQuery = useListMyCollections({ ownerId: userId });
  const sentencesQuery = useListStoredSentences({ userId });

  const createMyCollection = useCreateMyCollection();
  const deleteSentence = useDeleteStoredSentence();
  const toggleFavorite = useToggleStoredSentenceFavorite();
  const createThought = useCreateThought();

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

  const cardWidth = Math.floor(windowWidth - Spacing.screenPx * 2);
  const sentenceTextSize = readerFontSize(
    ReaderTokens.typeScale.bodyCqi,
    Math.max(1, cardWidth - 32),
  );

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
      showToast({ message: `${ids.length}개 문장을 삭제했어요.`, type: "success" });
    } else if (failCount < ids.length) {
      showToast({ message: `일부 삭제에 실패했어요. (${failCount}개)`, type: "error" });
    } else {
      showToast({ message: "삭제에 실패했어요.", type: "error" });
    }
  }, [selectedIds, deleteSentence, sentencesQuery, exitSelectionMode, showToast]);

  const handleSearch = useCallback(() => {
    setSearchActive((prev) => {
      if (prev) setSearchQuery("");
      return !prev;
    });
  }, []);

  const handleAdd = useCallback(() => {
    if (activeSubTab === "sentence") {
      showToast({ message: "읽기 화면에서 문장을 길게 눌러 수집할 수 있어요", type: "info" });
      return;
    }
    setNewName("");
    setNewDescription("");
    setCreateSheetVisible(true);
  }, [activeSubTab, showToast]);

  const isCreating = createMyCollection.isPending;

  const handleCreateConfirm = useCallback(async () => {
    if (!newName.trim()) {
      showToast({ message: "이름을 입력해주세요.", type: "error" });
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
      showToast({ message: msg, type: "error" });
    }
  }, [newName, newDescription, userId, isCreating, createMyCollection, myCollectionsQuery, router, showToast]);

  const handleSentenceCopy = useCallback(async (text: string) => {
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(text);
      } else {
        await Clipboard.setStringAsync(text);
      }
      showToast({ message: "문장을 복사했어요.", type: "success" });
      setSelectedSentence(null);
    } catch {
      showToast({ message: "복사에 실패했어요.", type: "error" });
    }
  }, [showToast]);

  const handleSentenceToggleFavorite = useCallback(async (id: string, currentFav: boolean) => {
    if (toggleFavorite.isPending) return;
    const newFav = !currentFav;
    if (selectedSentence?.id === id) {
      setSelectedSentence((prev) => prev ? { ...prev, isFavorite: newFav } : null);
    }
    try {
      await toggleFavorite.mutateAsync({ id, data: { isFavorite: newFav } });
    } catch {
      if (selectedSentence?.id === id) {
        setSelectedSentence((prev) => prev ? { ...prev, isFavorite: currentFav } : null);
      }
      showToast({ message: "즐겨찾기 변경에 실패했어요.", type: "error" });
      return;
    }
    await sentencesQuery.refetch();
  }, [toggleFavorite, sentencesQuery, selectedSentence, showToast]);

  const handleSentenceQuoteAsMemo = useCallback(async (sentence: StoredSentence) => {
    const position = sentence.position as { page?: number } | null;
    const page = position && typeof position.page === "number" ? position.page : undefined;
    const quoteBlock = sentence.articleTitle
      ? `> ${sentence.text.trim()}\n>\n> <${sentence.articleTitle}>${page !== undefined ? `, ${page + 1}면` : ""}`
      : `> ${sentence.text.trim()}\n`;
    try {
      const thought = await createThought.mutateAsync({
        data: {
          content: `# \n\n${quoteBlock}`,
          createdFrom: "quoted",
          sourceArticleId: sentence.articleId ?? undefined,
          sourceStoredSentenceId: sentence.id,
          status: "PRELIMINARY",
        },
      });
      setSelectedSentence(null);
      router.push({ pathname: "/on-01a", params: { id: thought.id } });
    } catch {
      showToast({ message: "메모 생성에 실패했습니다.", type: "error" });
    }
  }, [createThought, router, showToast]);

  const handleSentenceDeleteConfirm = useCallback(async () => {
    if (!sentenceDeleteTarget || deleteSentence.isPending) return;
    const id = sentenceDeleteTarget;
    setSentenceDeleteTarget(null);
    try {
      await deleteSentence.mutateAsync({ id });
      sentencesQuery.refetch();
      showToast({ message: "문장을 삭제했어요.", type: "success" });
    } catch {
      showToast({ message: "삭제에 실패했어요.", type: "error" });
    }
  }, [sentenceDeleteTarget, deleteSentence, sentencesQuery, showToast]);

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
        style={[styles.cardWrapper, { width: cardWidth }]}
        onPress={() => router.push({ pathname: "/of-01-detail", params: { id: item.id, name: item.name } })}
        contentStyle={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`${item.name} 보관함, ${item.articleCount ?? 0}편`}
      >
        <View style={styles.cardContent}>
          <View style={styles.cardTopRow}>
            <View style={styles.cardIconNameGroup}>
              <Feather name="folder" size={18} color={Colors.zinc500} />
              <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
            </View>
          </View>
          {item.description ? (
            <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
          ) : null}
          <View style={styles.cardSpacer} />
          <View style={styles.cardMeta}>
            <Text style={styles.cardMetaText} numberOfLines={1}>{item.articleCount ?? 0}편</Text>
            <View style={styles.cardMetaRight}>
              {item.isPublic && <Feather name="globe" size={14} color={Colors.zinc400} />}
            </View>
          </View>
        </View>
      </ScalePressable>
    );
  }, [cardWidth, router]);

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
        contentStyle={styles.sentenceItemRow}
        accessibilityRole="button"
        accessibilityLabel="수집한 문장 상세 열기"
      >
        <View style={styles.sentenceItemContent}>
          <View style={styles.sentenceMeta}>
            <Text style={styles.sentenceSource} numberOfLines={1}>
              {item.articleTitle || "출처 없음"}
            </Text>
            <Text style={styles.sentenceDate}>
              {new Date(item.createdAt).toLocaleDateString("ko-KR")}
            </Text>
          </View>
          <Text
            style={[styles.sentenceText, { fontSize: sentenceTextSize, lineHeight: sentenceTextSize * 1.7 }]}
            numberOfLines={3}
            ellipsizeMode="tail"
          >
            &ldquo;{item.text}&rdquo;
          </Text>
        </View>
      </ScalePressable>
    </SwipeableRow>
  ), [closeSentenceOpenRow, handleSentenceSwipeOpen, sentenceTextSize]);

  const renderSentenceSelectionItem = useCallback(({ item }: { item: StoredSentence }) => {
    const isSelected = selectedIds.has(item.id);
    return (
      <ScalePressable
        style={styles.selectionRow}
        onPress={() => toggleSelect(item.id)}
        contentStyle={styles.selectionRowContent}
        accessibilityRole="checkbox"
        accessibilityLabel="수집한 문장 선택"
        accessibilityState={{ checked: isSelected }}
      >
        <View style={styles.checkboxTouchTarget}>
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && <Feather name="check" size={14} color={Colors.white} />}
          </View>
        </View>
        <View style={styles.sentenceItemContent}>
          <View style={styles.sentenceMeta}>
            <Text style={styles.sentenceSource} numberOfLines={1}>
              {item.articleTitle || "출처 없음"}
            </Text>
            <Text style={styles.sentenceDate}>
              {new Date(item.createdAt).toLocaleDateString("ko-KR")}
            </Text>
          </View>
          <Text
            style={[styles.sentenceText, { fontSize: sentenceTextSize, lineHeight: sentenceTextSize * 1.7 }]}
            numberOfLines={3}
            ellipsizeMode="tail"
          >
            &ldquo;{item.text}&rdquo;
          </Text>
        </View>
      </ScalePressable>
    );
  }, [selectedIds, sentenceTextSize, toggleSelect]);

  const renderEmptyPersonal = () => (
    <RefreshableEmpty
      refreshing={isManualRefreshing}
      onRefresh={handleRefresh}
      contentContainerStyle={[styles.emptyContainer, { paddingBottom: navBottom }]}
    >
      <Feather name="folder" size={40} color={Colors.zinc300} />
      <Text style={styles.emptyTitle}>내 폴더가 없어요</Text>
      <Text style={styles.emptySubtitle}>완성된 편지를 모아두는 나만의 공간을 만들어보세요</Text>
      <ScalePressable
        style={styles.emptyButton}
        contentStyle={styles.emptyButtonContent}
        onPress={handleAdd}
        accessibilityRole="button"
        accessibilityLabel="새 폴더 만들기"
      >
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
          <ScalePressable
            style={styles.emptyButton}
            contentStyle={styles.emptyButtonContent}
            onPress={handleRefresh}
            accessibilityRole="button"
            accessibilityLabel="보관함 다시 불러오기"
          >
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
          key="archive-personal-list"
          data={regularCollections}
          keyExtractor={(item) => item.id}
          renderItem={renderPersonalItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: navBottom }]}
          refreshControl={<RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} tintColor={Colors.zinc400} />}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            impressionCollection ? (
              <ScalePressable
                style={[styles.cardWrapper, { width: cardWidth, marginTop: 4 }]}
                onPress={() => router.push({ pathname: "/of-01-detail", params: { id: impressionCollection.id, name: impressionCollection.name } })}
                contentStyle={styles.card}
                accessibilityRole="button"
                accessibilityLabel={`${impressionCollection.name} 보관함, ${impressionCollection.articleCount ?? 0}편`}
              >
                <View style={styles.cardContent}>
                  <View style={styles.cardTopRow}>
                    <View style={styles.cardIconNameGroup}>
                      <Feather name="heart" size={18} color={Colors.zinc500} />
                      <Text style={styles.cardName} numberOfLines={1}>{impressionCollection.name}</Text>
                    </View>
                  </View>
                  <View style={styles.cardSpacer} />
                  <View style={styles.cardMeta}>
                    <Text style={styles.cardMetaText} numberOfLines={1}>{impressionCollection.articleCount ?? 0}편</Text>
                    <View style={styles.cardMetaRight}>
                      {impressionCollection.isPublic && <Feather name="globe" size={14} color={Colors.zinc400} />}
                    </View>
                  </View>
                </View>
              </ScalePressable>
            ) : <View style={styles.listTopSpacer} />
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
    <View style={[styles.container, isSentenceSelectionMode && { paddingTop: insets.top }]}>
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
          title="보관"
          showAdd={activeSubTab !== "sentence"}
          onAddPress={handleAdd}
          showSearch
          onSearchPress={handleSearch}
          searchActive={searchActive}
          showKebab={activeSubTab === "sentence"}
          onKebabPress={enterSelectionMode}
          kebabAccessibilityLabel="수집한 문장 선택 모드 열기"
          searchLast={activeSubTab === "sentence"}
        />
      )}

      {!selectionMode && (
        <View style={styles.subTabBar}>
          <View style={{ flex: 1 }}>
            <ScalePressable
              style={styles.subTabItem}
              contentStyle={[styles.subTabItemContent, { paddingLeft: 16, paddingRight: 8 }]}
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
              style={styles.subTabItem}
              contentStyle={[styles.subTabItemContent, { paddingLeft: 8, paddingRight: 16 }]}
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
            style={styles.bulkDeleteButton}
            onPress={handleBulkDeletePress}
            disabled={selectedCount === 0 || isBulkDeleting}
            contentStyle={[
              styles.bulkDeleteButtonContent,
              (selectedCount === 0 || isBulkDeleting) && styles.bulkDeleteButtonDisabled,
            ]}
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
            cursorColor={Colors.cursorAccent}
            value={newName}
            onChangeText={setNewName}
            autoFocus
          />
          <TextInput
            style={[styles.createInput, styles.createInputMulti]}
            placeholder="설명 (선택사항)"
            placeholderTextColor={Colors.zinc400}
            cursorColor={Colors.cursorAccent}
            value={newDescription}
            onChangeText={setNewDescription}
            multiline
            textAlignVertical="top"
          />
          <SubmitButton
            style={styles.createConfirmButton}
            contentStyle={styles.createConfirmButtonContent}
            disabledContentStyle={styles.createConfirmDisabled}
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
              contentStyle={styles.sentenceSheetRowContent}
              >
                <Feather name="copy" size={18} color={Colors.zinc700} />
                <Text style={styles.sentenceSheetActionLabel}>복사하기</Text>
              </ScalePressable>
              <ScalePressable
                style={styles.sentenceSheetRow}
                onPress={() => handleSentenceToggleFavorite(selectedSentence.id, selectedSentence.isFavorite)}
              contentStyle={styles.sentenceSheetRowContent}
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
              contentStyle={styles.sentenceSheetRowContent}
              >
                <Feather name="edit" size={18} color={Colors.zinc700} />
                <Text style={styles.sentenceSheetActionLabel}>인용해서 메모 작성</Text>
              </ScalePressable>
              {selectedSentence.articleId ? (
                <ScalePressable
                  style={styles.sentenceSheetRow}
                  onPress={() => {
                    const articleId = selectedSentence.articleId;
                    startFadeToBlack(() => {
                      setSelectedSentence(null);
                      router.push({ pathname: "/read", params: { articleId, mode: "re_read" } });
                    });
                  }}
                contentStyle={styles.sentenceSheetRowContent}
                >
                  <Feather name="external-link" size={18} color={Colors.zinc700} />
                  <Text style={styles.sentenceSheetActionLabel}>원본으로 이동</Text>
                </ScalePressable>
              ) : null}
              <ScalePressable
                style={styles.sentenceSheetRow}
                onPress={() => {
                  setSentenceDeleteTarget(selectedSentence.id);
                  setSelectedSentence(null);
                }}
              contentStyle={styles.sentenceSheetRowContent}
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
  },
  subTabItem: {},
  subTabItemContent: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 0,
  },
  subTabText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc400, // typography-ok: inactive sub-tab label
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
  // ─── Card ────────────────────────────────────────────────────────────────────
  listTopSpacer: {
    height: 4,
  },
  cardWrapper: {
    marginHorizontal: Spacing.screenPx,
    marginBottom: 10,
  },
  card: {
    borderRadius: 16,
    backgroundColor: Colors.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardContent: {
    padding: 16,
    position: "relative",
    flexDirection: "column",
    justifyContent: "flex-start",
    borderRadius: 16,
    overflow: "hidden",
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
    gap: 8,
  },
  cardIconNameGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    flex: 1,
    minWidth: 0,
  },
  cardDesc: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc600,
    lineHeight: 16,
    marginTop: 2,
  },
  cardSpacer: {
    flex: 1,
    minHeight: 8,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  cardMetaRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  cardMetaText: {
    ...Typography.captionMedium,
    fontSize: 12,
    color: Colors.zinc500,
    flexShrink: 0,
  },
  listContent: {
    paddingTop: 4,
  },
  sentenceItem: {
    marginHorizontal: Spacing.screenPx,
    marginBottom: Spacing.cardGap,
  },
  sentenceItemRow: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: Colors.white,
    ...Shadows.card,
  },
  sentenceItemContent: {
    flex: 1,
    minWidth: 0,
    gap: 7,
  },
  sentenceText: {
    fontFamily: ReaderTokens.fontFamily.serif,
    color: Colors.zinc600,
  },
  sentenceSource: {
    ...Typography.caption,
    color: Colors.zinc500,
    flex: 1,
    minWidth: 0,
    marginRight: 12,
  },
  sentenceMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sentenceDate: {
    ...Typography.caption,
    color: Colors.zinc500,
    flexShrink: 0,
  },
  selectionRow: {
    marginHorizontal: Spacing.screenPx,
    marginBottom: Spacing.cardGap,
  },
  selectionRowContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
    paddingLeft: 10,
    borderRadius: 16,
    backgroundColor: Colors.white,
    ...Shadows.card,
  },
  checkboxTouchTarget: {
    width: 44,
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
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
  bulkDeleteButton: {},
  bulkDeleteButtonContent: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EF4444",
    borderRadius: 12,
    paddingVertical: 14,
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
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyButton: {
    height: 40,
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 8,
  },
  emptyButtonContent: {
    height: 40,
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 20,
    backgroundColor: Colors.primaryAction,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
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
    width: "100%",
    height: 48,
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 4,
  },
  createConfirmButtonContent: {
    width: "100%",
    height: 48,
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: Colors.primaryAction,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  createConfirmDisabled: {
    backgroundColor: Colors.primaryActionDisabled,
  },
  createConfirmText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.primaryActionForeground,
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
    color: Colors.zinc500,
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
  sentenceSheetRow: {},
  sentenceSheetRowContent: {
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
