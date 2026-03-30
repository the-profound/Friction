import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  BackHandler,
  Alert,
  ScrollView,
  TextInput,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ProgressIndicator from "@/components/ProgressIndicator/ProgressIndicator";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import SelectableText from "@/components/SelectableText/SelectableText";
import { useReadingSession } from "@/lib/useReadingSession";
import { useGetArticle, useCreateStoredSentence, useDeleteInboxItem } from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";
import { useActiveReading } from "@/contexts/ActiveReadingContext";
import type { ReadingMode } from "@/lib/policies";

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export default function ReadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();
  const { setActiveSession, clearActiveSession } = useActiveReading();
  const params = useLocalSearchParams<{
    articleId: string;
    inboxId?: string;
    mode?: string;
  }>();

  const articleId = params.articleId ?? "";
  const inboxId = params.inboxId;
  const mode: ReadingMode = (params.mode as ReadingMode) ?? "basic";

  const articleQuery = useGetArticle(articleId);
  const article = articleId ? articleQuery.data : undefined;
  const articleLoading = articleId ? articleQuery.isLoading : false;

  useEffect(() => {
    if (articleId && articleQuery.isError) {
      clearActiveSession();
      router.back();
    }
  }, [articleId, articleQuery.isError, clearActiveSession, router]);

  const pages: string[] = useMemo(() => {
    if (!article) return [];
    if (article.pages && Array.isArray(article.pages) && article.pages.length > 0) {
      return article.pages;
    }
    if (article.content) return [article.content];
    return [];
  }, [article]);

  const totalPages = pages.length;

  const reading = useReadingSession({
    articleId,
    mode,
    totalPages,
    userId,
    inboxId,
  });

  const currentPage = totalPages > 0
    ? Math.min(reading.session.position.currentPage, totalPages - 1)
    : reading.session.position.currentPage;
  const isOnLastPage = totalPages > 0 && currentPage >= totalPages - 1;

  const [completionSheetVisible, setCompletionSheetVisible] = useState(false);
  const [sentencePopupVisible, setSentencePopupVisible] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [memoSheetVisible, setMemoSheetVisible] = useState(false);
  const [memoText, setMemoText] = useState("");
  const [pageListHeight, setPageListHeight] = useState(0);
  const handlePageListLayout = useCallback((e: LayoutChangeEvent) => {
    setPageListHeight(e.nativeEvent.layout.height);
  }, []);
  const createSentence = useCreateStoredSentence();
  const deleteInbox = useDeleteInboxItem();

  useEffect(() => {
    if (mode === "basic" && articleId) {
      setActiveSession({ articleId, inboxId, mode });
    }
    return () => {};
  }, [articleId, inboxId, mode, setActiveSession]);

  useEffect(() => {
    if (!reading.isRestoring && reading.isSessionHydrated && reading.session.state === "IDLE" && totalPages > 0) {
      reading.startReading();
    }
  }, [reading.isRestoring, reading.isSessionHydrated, reading.session.state, totalPages]);

  useEffect(() => {
    if (reading.session.state === "COMPLETED_READY") {
      setCompletionSheetVisible(true);
    }
  }, [reading.session.state]);

  useEffect(() => {
    if (reading.session.state === "COMPLETED_COMMITTED") {
      clearActiveSession();
    }
  }, [reading.session.state, clearActiveSession]);

  useEffect(() => {
    if (mode !== "basic") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!reading.canExit) {
        Alert.alert("읽기 중", "완독 후 보관/삭제를 선택해주세요.");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [mode, reading.canExit]);


  const handleBack = useCallback(() => {
    if (mode === "basic" && !reading.canExit) {
      Alert.alert("읽기 중", "완독 후 보관/삭제를 선택해주세요.");
      return;
    }
    if (reading.session.state === "READING" || reading.session.state === "PAUSED") {
      reading.pause();
    }
    router.back();
  }, [mode, reading, router]);

  const canNavigate = mode === "re_read" || reading.session.state === "READING";

  const handleTapLeft = useCallback(() => {
    if (!canNavigate) return;
    reading.prevPage();
  }, [canNavigate, reading]);

  const handleTapRight = useCallback(() => {
    if (!canNavigate) return;
    reading.nextPage();
  }, [canNavigate, reading]);

  const handleCommitAndArchive = useCallback(async () => {
    const result = await reading.commitCompletion();
    setCompletionSheetVisible(false);
    if (result.success) {
      clearActiveSession();
      router.back();
    } else {
      Alert.alert("오류", result.error ?? "완독 처리에 실패했습니다.");
    }
  }, [reading, router, clearActiveSession]);

  const handleCommitAndDelete = useCallback(async () => {
    const result = await reading.commitCompletion();
    if (result.success && inboxId) {
      try {
        await deleteInbox.mutateAsync({ id: inboxId });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "수신함 항목 삭제에 실패했습니다.";
        Alert.alert("알림", `완독 기록은 저장했지만 ${msg}`);
      }
    }
    setCompletionSheetVisible(false);
    if (result.success) {
      clearActiveSession();
      router.back();
    } else {
      Alert.alert("오류", result.error ?? "완독 처리에 실패했습니다.");
    }
  }, [reading, router, inboxId, deleteInbox, clearActiveSession]);

  const handleCollectSentence = useCallback((text: string) => {
    if (text.trim().length > 0) {
      setSelectedText(text.trim());
      setSentencePopupVisible(true);
    }
  }, []);

  const handleSaveSentence = useCallback(async () => {
    if (!selectedText) return;
    try {
      await createSentence.mutateAsync({
        data: {
          userId,
          articleId,
          text: selectedText,
          position: {
            page: currentPage,
          },
        },
      });
      setSentencePopupVisible(false);
      setSelectedText("");
      Alert.alert("저장 완료", "문장이 저장되었습니다.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "문장 저장에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [selectedText, userId, articleId, currentPage, createSentence]);

  const handleSaveMemo = useCallback(async () => {
    if (!memoText.trim()) return;
    try {
      await createSentence.mutateAsync({
        data: {
          userId,
          articleId,
          text: memoText.trim(),
          position: {
            page: currentPage,
            type: "memo",
          },
        },
      });
      setMemoSheetVisible(false);
      setMemoText("");
      Alert.alert("저장 완료", "메모가 저장되었습니다.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "메모 저장에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [memoText, userId, articleId, currentPage, createSentence]);

  if (!articleId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>편지를 선택해주세요</Text>
        </View>
      </View>
    );
  }

  if (articleLoading || reading.isRestoring || !reading.isSessionHydrated) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.emptyContainer}>
          <ProgressIndicator type="spinner" size="large" />
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      </View>
    );
  }

  const currentPageContent = totalPages > 0 ? pages[Math.min(currentPage, totalPages - 1)] : "";

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: mode !== "basic" || reading.canExit,
        }}
      />
      <View style={styles.header}>
        {mode === "re_read" && (
          <Pressable onPress={handleBack} hitSlop={12} style={styles.backButton}>
            <Feather name="arrow-left" size={20} color={Colors.zinc600} />
          </Pressable>
        )}
      </View>

      {article && (
        <View style={styles.titleBar}>
          <Text style={styles.articleTitle} numberOfLines={1}>{article.title}</Text>
          {mode === "re_read" && (
            <View style={styles.modeBadge}>
              <Text style={styles.modeBadgeText}>다시읽기</Text>
            </View>
          )}
        </View>
      )}

      {totalPages > 0 ? (
        <View style={styles.pageListContainer} onLayout={handlePageListLayout}>
          <PageView
            content={currentPageContent}
            pageIndex={currentPage}
            onCollectSentence={handleCollectSentence}
            bottomInset={isOnLastPage ? insets.bottom + 56 : insets.bottom}
            availableHeight={pageListHeight}
          />

          {canNavigate && totalPages > 1 && (
            <>
              <Pressable
                style={styles.tapZoneLeft}
                onPress={handleTapLeft}
              />
              <Pressable
                style={styles.tapZoneRight}
                onPress={handleTapRight}
              />
            </>
          )}

          {isOnLastPage && reading.session.state === "READING" && (
            <View style={[styles.completeButtonContainer, { paddingBottom: insets.bottom + 8 }]}>
              <Pressable style={styles.completeButton} onPress={() => reading.nextPage()}>
                <Feather name="check" size={18} color={Colors.white} />
                <Text style={styles.completeButtonText}>읽기 완료</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>페이지가 없습니다</Text>
        </View>
      )}

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.bottomProgressContainer}>
          <ProgressIndicator type="linear" progress={reading.progress} size="small" />
        </View>
        <Pressable
          onPress={() => setMemoSheetVisible(true)}
          hitSlop={16}
          style={styles.bottomMemoButton}
        >
          <Feather name="edit-3" size={20} color={Colors.zinc600} />
        </Pressable>
      </View>

      <BottomSheet
        visible={completionSheetVisible}
        onClose={() => {}}
        title="완독!"
        snapPoints={[0.35]}
        enableDragDown={false}
        dismissable={false}
      >
        <View style={styles.completionContent}>
          <Feather name="check-circle" size={48} color={Colors.zinc900} style={styles.completionIcon} />
          <Text style={styles.completionText}>읽기를 완료했어요</Text>
          <Pressable style={styles.completionButton} onPress={handleCommitAndArchive}>
            <Feather name="archive" size={18} color={Colors.white} />
            <Text style={styles.completionButtonText}>보관하기</Text>
          </Pressable>
          <Pressable
            style={[styles.completionButton, styles.completionButtonSecondary]}
            onPress={handleCommitAndDelete}
          >
            <Feather name="trash-2" size={18} color={Colors.zinc600} />
            <Text style={styles.completionButtonSecondaryText}>삭제하기</Text>
          </Pressable>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={sentencePopupVisible}
        onClose={() => setSentencePopupVisible(false)}
        title="문장 저장"
        snapPoints={[0.3]}
      >
        <View style={styles.sentenceContent}>
          <Text style={styles.sentencePreview} numberOfLines={3}>
            &ldquo;{selectedText}&rdquo;
          </Text>
          <View style={styles.sentenceActions}>
            <Pressable
              style={[styles.sentenceButton, styles.sentenceButtonCancel]}
              onPress={() => setSentencePopupVisible(false)}
            >
              <Text style={styles.sentenceButtonCancelText}>취소</Text>
            </Pressable>
            <Pressable style={styles.sentenceButton} onPress={handleSaveSentence}>
              <Feather name="bookmark" size={16} color={Colors.white} />
              <Text style={styles.sentenceButtonText}>저장</Text>
            </Pressable>
          </View>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={memoSheetVisible}
        onClose={() => setMemoSheetVisible(false)}
        title="메모 작성"
        snapPoints={[0.4]}
      >
        <View style={styles.memoContent}>
          <TextInput
            style={styles.memoInput}
            placeholder="읽으면서 떠오른 생각을 적어보세요..."
            placeholderTextColor={Colors.searchPlaceholder}
            value={memoText}
            onChangeText={setMemoText}
            multiline
            autoFocus
            textAlignVertical="top"
          />
          <Text style={styles.memoPageInfo}>
            {currentPage + 1}페이지에서 작성 중
          </Text>
          <View style={styles.sentenceActions}>
            <Pressable
              style={[styles.sentenceButton, styles.sentenceButtonCancel]}
              onPress={() => { setMemoSheetVisible(false); setMemoText(""); }}
            >
              <Text style={styles.sentenceButtonCancelText}>취소</Text>
            </Pressable>
            <Pressable style={styles.sentenceButton} onPress={handleSaveMemo}>
              <Feather name="save" size={16} color={Colors.white} />
              <Text style={styles.sentenceButtonText}>저장</Text>
            </Pressable>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}

function PageView({
  content,
  pageIndex,
  onCollectSentence,
  bottomInset,
  availableHeight,
}: {
  content: string;
  pageIndex: number;
  onCollectSentence: (text: string) => void;
  bottomInset: number;
  availableHeight: number;
}) {
  const paragraphs = useMemo(() => splitIntoParagraphs(content), [content]);

  const cardHeight = availableHeight > 0 ? availableHeight : undefined;

  return (
    <View style={[styles.pageContainer, cardHeight ? { height: cardHeight } : { flex: 1 }]}>
      <ScrollView
        contentContainerStyle={[styles.pageContent, { paddingBottom: bottomInset + 40 }]}
        showsVerticalScrollIndicator={false}
        style={styles.pageScrollView}
      >
        {paragraphs.map((para, idx) => (
          <View key={`${pageIndex}-p-${idx}`} style={styles.paragraphWrapper}>
            <SelectableText text={para} onCollect={onCollectSentence} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const TAP_ZONE_WIDTH_PERCENT = 25;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  pageIndicator: {
    ...Typography.caption,
    color: Colors.zinc400,
    flex: 1,
    textAlign: "right",
  },
  titleBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 12,
    gap: 8,
  },
  articleTitle: {
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
    flex: 1,
  },
  modeBadge: {
    backgroundColor: Colors.zinc100,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  modeBadgeText: {
    ...Typography.caption,
    color: Colors.zinc500,
  },
  pageContainer: {
    overflow: "hidden",
  },
  pageScrollView: {
    flex: 1,
  },
  pageContent: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 16,
  },
  paragraphWrapper: {
    marginBottom: 16,
  },
  pageText: {
    ...Typography.body,
    color: Colors.zinc800,
    lineHeight: 28,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 12,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    marginTop: 8,
  },
  completionContent: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 12,
  },
  completionIcon: {
    marginBottom: 4,
  },
  completionText: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
    marginBottom: 8,
  },
  completionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    gap: 8,
    width: "100%",
  },
  completionButtonText: {
    ...Typography.bodySemiBold,
    color: Colors.white,
  },
  completionButtonSecondary: {
    backgroundColor: Colors.zinc100,
  },
  completionButtonSecondaryText: {
    ...Typography.bodySemiBold,
    color: Colors.zinc600,
  },
  sentenceContent: {
    paddingVertical: 12,
    gap: 16,
  },
  sentencePreview: {
    ...Typography.body,
    color: Colors.zinc700,
    fontStyle: "italic",
    lineHeight: 24,
  },
  sentenceActions: {
    flexDirection: "row",
    gap: 12,
  },
  sentenceButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.zinc900,
    borderRadius: 10,
    paddingVertical: 12,
    gap: 6,
  },
  sentenceButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  sentenceButtonCancel: {
    backgroundColor: Colors.zinc100,
  },
  sentenceButtonCancelText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc600,
  },
  memoContent: {
    paddingVertical: 12,
    gap: 12,
  },
  memoInput: {
    ...Typography.body,
    color: Colors.zinc800,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    padding: 14,
    minHeight: 120,
    lineHeight: 24,
  },
  memoPageInfo: {
    ...Typography.caption,
    color: Colors.zinc400,
    textAlign: "right",
  },
  pageListContainer: {
    flex: 1,
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 14,
    gap: 14,
    backgroundColor: Colors.white,
  },
  bottomProgressContainer: {
    flex: 1,
  },
  bottomMemoButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  completeButtonContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: 20,
  },
  completeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    gap: 8,
    width: "100%",
  },
  completeButtonText: {
    ...Typography.bodySemiBold,
    color: Colors.white,
  },
  tapZoneLeft: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: `${TAP_ZONE_WIDTH_PERCENT}%`,
  },
  tapZoneRight: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: `${TAP_ZONE_WIDTH_PERCENT}%`,
  },
});
