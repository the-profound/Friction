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
  Platform,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import {
  Colors,
  Spacing,
  ReaderTokens,
  cqiToPx,
  readerFontSize,
  readerLetterSpacing,
} from "@/constants/tokens";
import ProgressIndicator from "@/components/ProgressIndicator/ProgressIndicator";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import SelectableText from "@/components/SelectableText/SelectableText";
import { useReadingSession } from "@/lib/useReadingSession";
import { useQueryClient } from "@tanstack/react-query";
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

function computeReaderLayout(availableWidth: number, availableHeight: number): ReaderLayout {
  const widthFromHeight = availableHeight * ReaderTokens.aspectRatio;
  const heightFromWidth = availableWidth / ReaderTokens.aspectRatio;

  const containerWidth =
    widthFromHeight <= availableWidth ? widthFromHeight : availableWidth;
  const containerHeight =
    heightFromWidth <= availableHeight ? heightFromWidth : availableHeight;

  const paddingX = cqiToPx(ReaderTokens.padding.xCqi, containerWidth);
  const paddingY = cqiToPx(ReaderTokens.padding.yCqi, containerWidth);

  const safeAreaWidth = cqiToPx(
    ReaderTokens.safeArea.widthCqi,
    containerWidth,
  );
  const safeAreaHeight = cqiToPx(
    ReaderTokens.safeArea.heightCqi,
    containerWidth,
  );

  const bodyFontSize = readerFontSize(
    ReaderTokens.typeScale.bodyCqi,
    containerWidth,
  );
  const captionFontSize = readerFontSize(
    ReaderTokens.typeScale.captionCqi,
    containerWidth,
  );
  const metadataFontSize = readerFontSize(
    ReaderTokens.typeScale.metadataCqi,
    containerWidth,
  );

  const bodyLineHeight = bodyFontSize * ReaderTokens.lineHeight.relaxed;
  const bodyLetterSpacing = readerLetterSpacing(
    ReaderTokens.letterSpacing.relaxedEm,
    bodyFontSize,
  );

  const titleLineHeight = bodyFontSize * ReaderTokens.lineHeight.tight;
  const titleLetterSpacing = readerLetterSpacing(
    ReaderTokens.letterSpacing.tightEm,
    bodyFontSize,
  );

  return {
    containerWidth,
    containerHeight,
    paddingX,
    paddingY,
    safeAreaWidth,
    safeAreaHeight,
    bodyFontSize,
    captionFontSize,
    metadataFontSize,
    bodyLineHeight,
    bodyLetterSpacing,
    titleLineHeight,
    titleLetterSpacing,
  };
}

export default function ReadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const queryClient = useQueryClient();
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
  const [pageListSize, setPageListSize] = useState({ width: 0, height: 0 });
  const handlePageListLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setPageListSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  const layout = useMemo(
    () =>
      computeReaderLayout(
        pageListSize.width > 0 ? pageListSize.width : screenWidth,
        pageListSize.height > 0 ? pageListSize.height : screenWidth / ReaderTokens.aspectRatio,
      ),
    [pageListSize.width, pageListSize.height, screenWidth],
  );
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
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      clearActiveSession();
      router.back();
    } else {
      Alert.alert("오류", result.error ?? "완독 처리에 실패했습니다.");
    }
  }, [reading, router, clearActiveSession, queryClient]);

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
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      clearActiveSession();
      router.back();
    } else {
      Alert.alert("오류", result.error ?? "완독 처리에 실패했습니다.");
    }
  }, [reading, router, inboxId, deleteInbox, clearActiveSession, queryClient]);

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
      queryClient.invalidateQueries({ queryKey: ["/api/stored-sentences"] });
      setSentencePopupVisible(false);
      setSelectedText("");
      Alert.alert("저장 완료", "문장이 저장되었습니다.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "문장 저장에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [selectedText, userId, articleId, currentPage, createSentence, queryClient]);

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
      queryClient.invalidateQueries({ queryKey: ["/api/stored-sentences"] });
      setMemoSheetVisible(false);
      setMemoText("");
      Alert.alert("저장 완료", "메모가 저장되었습니다.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "메모 저장에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [memoText, userId, articleId, currentPage, createSentence, queryClient]);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        articleTitle: {
          fontSize: layout.captionFontSize,
          fontFamily: ReaderTokens.fontFamily.sans,
          letterSpacing: layout.titleLetterSpacing,
          color: Colors.zinc400,
          textAlign: "center" as const,
        },
        modeBadgeText: {
          fontSize: layout.metadataFontSize,
          fontFamily: ReaderTokens.fontFamily.sans,
          color: Colors.zinc500,
        },
        completionText: {
          fontSize: layout.bodyFontSize * 1.125,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.zinc900,
          marginBottom: 8,
        },
        completionButtonText: {
          fontSize: layout.bodyFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.white,
        },
        completionButtonSecondaryText: {
          fontSize: layout.bodyFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.zinc600,
        },
        sentencePreview: {
          fontSize: layout.bodyFontSize,
          fontFamily: ReaderTokens.fontFamily.serif,
          color: Colors.zinc700,
          fontStyle: "italic" as const,
          lineHeight: layout.bodyLineHeight,
        },
        sentenceButtonText: {
          fontSize: layout.captionFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.white,
        },
        sentenceButtonCancelText: {
          fontSize: layout.captionFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.zinc600,
        },
        memoInput: {
          fontSize: layout.bodyFontSize,
          fontFamily: ReaderTokens.fontFamily.sans,
          color: Colors.zinc800,
          backgroundColor: Colors.zinc50,
          borderRadius: 10,
          padding: 14,
          minHeight: 120,
          lineHeight: layout.bodyLineHeight,
        },
        memoPageInfo: {
          fontSize: layout.captionFontSize,
          fontFamily: ReaderTokens.fontFamily.sans,
          color: Colors.zinc400,
          textAlign: "right" as const,
        },
        completeButtonText: {
          fontSize: layout.bodyFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.white,
        },
        sheetTitle: {
          fontSize: layout.bodyFontSize,
          fontWeight: "600" as const,
          fontFamily: ReaderTokens.fontFamily.sansSemiBold,
          color: Colors.zinc900,
        },
      }),
    [layout],
  );

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
      {mode === "re_read" && (
        <View style={styles.header}>
          <Pressable onPress={handleBack} hitSlop={12} style={styles.backButton}>
            <Feather name="arrow-left" size={20} color={Colors.zinc600} />
          </Pressable>
        </View>
      )}

      {totalPages > 0 ? (
        <View style={styles.pageListContainer} onLayout={handlePageListLayout}>
          <View
            style={[
              styles.readerFrame,
              {
                width: layout.containerWidth,
                height: layout.containerHeight,
              },
            ]}
          >
            <PageView
              content={currentPageContent}
              pageIndex={currentPage}
              onCollectSentence={handleCollectSentence}
              bottomInset={isOnLastPage ? insets.bottom + 56 : insets.bottom}
              layout={layout}
            />

            {article && (
              <View style={styles.titleBar}>
                <Text style={dynamicStyles.articleTitle} numberOfLines={1}>{article.title}</Text>
                {mode === "re_read" && (
                  <View style={styles.modeBadge}>
                    <Text style={dynamicStyles.modeBadgeText}>다시읽기</Text>
                  </View>
                )}
              </View>
            )}
          </View>

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
                <Text style={dynamicStyles.completeButtonText}>읽기 완료</Text>
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
        titleStyle={dynamicStyles.sheetTitle}
        snapPoints={[0.35]}
        enableDragDown={false}
        dismissable={false}
      >
        <View style={styles.completionContent}>
          <Feather name="check-circle" size={48} color={Colors.zinc900} style={styles.completionIcon} />
          <Text style={dynamicStyles.completionText}>읽기를 완료했어요</Text>
          <Pressable style={styles.completionButton} onPress={handleCommitAndArchive}>
            <Feather name="archive" size={18} color={Colors.white} />
            <Text style={dynamicStyles.completionButtonText}>보관하기</Text>
          </Pressable>
          <Pressable
            style={[styles.completionButton, styles.completionButtonSecondary]}
            onPress={handleCommitAndDelete}
          >
            <Feather name="trash-2" size={18} color={Colors.zinc600} />
            <Text style={dynamicStyles.completionButtonSecondaryText}>삭제하기</Text>
          </Pressable>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={sentencePopupVisible}
        onClose={() => setSentencePopupVisible(false)}
        title="문장 저장"
        titleStyle={dynamicStyles.sheetTitle}
        snapPoints={[0.3]}
      >
        <View style={styles.sentenceContent}>
          <Text style={dynamicStyles.sentencePreview} numberOfLines={3}>
            &ldquo;{selectedText}&rdquo;
          </Text>
          <View style={styles.sentenceActions}>
            <Pressable
              style={[styles.sentenceButton, styles.sentenceButtonCancel]}
              onPress={() => setSentencePopupVisible(false)}
            >
              <Text style={dynamicStyles.sentenceButtonCancelText}>취소</Text>
            </Pressable>
            <Pressable style={styles.sentenceButton} onPress={handleSaveSentence}>
              <Feather name="bookmark" size={16} color={Colors.white} />
              <Text style={dynamicStyles.sentenceButtonText}>저장</Text>
            </Pressable>
          </View>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={memoSheetVisible}
        onClose={() => setMemoSheetVisible(false)}
        title="메모 작성"
        titleStyle={dynamicStyles.sheetTitle}
        snapPoints={[0.4]}
      >
        <View style={styles.memoContent}>
          <TextInput
            style={dynamicStyles.memoInput}
            placeholder="읽으면서 떠오른 생각을 적어보세요..."
            placeholderTextColor={Colors.searchPlaceholder}
            value={memoText}
            onChangeText={setMemoText}
            multiline
            autoFocus
            textAlignVertical="top"
          />
          <Text style={dynamicStyles.memoPageInfo}>
            {currentPage + 1}페이지에서 작성 중
          </Text>
          <View style={styles.sentenceActions}>
            <Pressable
              style={[styles.sentenceButton, styles.sentenceButtonCancel]}
              onPress={() => { setMemoSheetVisible(false); setMemoText(""); }}
            >
              <Text style={dynamicStyles.sentenceButtonCancelText}>취소</Text>
            </Pressable>
            <Pressable style={styles.sentenceButton} onPress={handleSaveMemo}>
              <Feather name="save" size={16} color={Colors.white} />
              <Text style={dynamicStyles.sentenceButtonText}>저장</Text>
            </Pressable>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}

interface ReaderLayout {
  containerWidth: number;
  containerHeight: number;
  paddingX: number;
  paddingY: number;
  safeAreaWidth: number;
  safeAreaHeight: number;
  bodyFontSize: number;
  captionFontSize: number;
  metadataFontSize: number;
  bodyLineHeight: number;
  bodyLetterSpacing: number;
  titleLineHeight: number;
  titleLetterSpacing: number;
}

function PageView({
  content,
  pageIndex,
  onCollectSentence,
  bottomInset,
  layout,
}: {
  content: string;
  pageIndex: number;
  onCollectSentence: (text: string) => void;
  bottomInset: number;
  layout: ReaderLayout;
}) {
  const paragraphs = useMemo(() => splitIntoParagraphs(content), [content]);

  const dynamicPageStyles = useMemo(
    () =>
      StyleSheet.create({
        safeAreaBox: {
          width: layout.safeAreaWidth,
          maxHeight: layout.safeAreaHeight,
          alignSelf: "center",
        },
        pageContent: {
          flexGrow: 1,
          justifyContent: "center" as const,
          paddingHorizontal: layout.paddingX,
          paddingTop: layout.paddingY,
          paddingBottom: bottomInset + layout.paddingY,
        },
        paragraphWrapper: {
          marginBottom: layout.paddingY,
        },
      }),
    [layout.safeAreaWidth, layout.safeAreaHeight, layout.paddingX, layout.paddingY, bottomInset],
  );

  return (
    <View style={[styles.pageContainer, { flex: 1 }]}>
      <View style={[dynamicPageStyles.safeAreaBox, { flex: 1 }]}>
        <ScrollView
          contentContainerStyle={dynamicPageStyles.pageContent}
          showsVerticalScrollIndicator={false}
          style={styles.pageScrollView}
        >
          {paragraphs.map((para, idx) => (
            <View key={`${pageIndex}-p-${idx}`} style={dynamicPageStyles.paragraphWrapper}>
              <SelectableText
                text={para}
                onCollect={onCollectSentence}
                fontSize={layout.bodyFontSize}
                lineHeight={layout.bodyLineHeight}
                letterSpacing={layout.bodyLetterSpacing}
              />
            </View>
          ))}
        </ScrollView>
      </View>
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
  titleBar: {
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 12,
    paddingTop: 8,
    width: "100%",
  },
  modeBadge: {
    backgroundColor: Colors.zinc100,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pageContainer: {
    overflow: "hidden",
    justifyContent: "center",
  },
  pageScrollView: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
    fontFamily: ReaderTokens.fontFamily.sansSemiBold,
    color: Colors.zinc900,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: ReaderTokens.fontFamily.sans,
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
  completionButtonSecondary: {
    backgroundColor: Colors.zinc100,
  },
  sentenceContent: {
    paddingVertical: 12,
    gap: 16,
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
  sentenceButtonCancel: {
    backgroundColor: Colors.zinc100,
  },
  memoContent: {
    paddingVertical: 12,
    gap: 12,
  },
  pageListContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  readerFrame: {
    alignSelf: "center",
    overflow: "visible",
    backgroundColor: Colors.white,
    ...Platform.select({
      web: {
        boxShadow: "0 -6px 18px rgba(0,0,0,0.045), 0 6px 18px rgba(0,0,0,0.045)",
      },
      default: {
        elevation: 4,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.06,
        shadowRadius: 18,
      },
    }),
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
