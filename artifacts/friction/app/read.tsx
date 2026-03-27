import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Dimensions,
  BackHandler,
  Alert,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import ProgressIndicator from "@/components/ProgressIndicator/ProgressIndicator";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import { useReadingSession } from "@/lib/useReadingSession";
import { useGetArticle, useCreateStoredSentence } from "@workspace/api-client-react";
import { useUser } from "@/contexts/UserContext";
import type { ReadingMode } from "@/lib/policies";

const { width: SCREEN_W } = Dimensions.get("window");

export default function ReadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();
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

  const [completionSheetVisible, setCompletionSheetVisible] = useState(false);
  const [sentencePopupVisible, setSentencePopupVisible] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const createSentence = useCreateStoredSentence();
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!reading.isRestoring && reading.session.state === "IDLE" && totalPages > 0) {
      reading.startReading();
    }
  }, [reading.isRestoring, reading.session.state, totalPages]);

  useEffect(() => {
    if (reading.session.state === "COMPLETED_READY" && mode === "basic") {
      setCompletionSheetVisible(true);
    }
  }, [reading.session.state, mode]);

  useEffect(() => {
    if (mode !== "basic") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!reading.canExit) {
        Alert.alert("읽기 중", "완독 전까지 나갈 수 없어요.");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [mode, reading.canExit]);

  const handleBack = useCallback(() => {
    if (mode === "basic" && !reading.canExit) {
      Alert.alert("읽기 중", "완독 전까지 나갈 수 없어요.");
      return;
    }
    if (reading.session.state === "READING" || reading.session.state === "PAUSED") {
      reading.pause();
    }
    router.back();
  }, [mode, reading, router]);

  const handlePageChange = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const idx = Math.round(event.nativeEvent.contentOffset.x / SCREEN_W);
      const currentPage = reading.session.position.currentPage;
      if (idx > currentPage) {
        reading.nextPage();
      } else if (idx < currentPage) {
        reading.prevPage();
      }
    },
    [reading],
  );

  useEffect(() => {
    if (flatListRef.current && reading.session.position.currentPage >= 0) {
      flatListRef.current.scrollToOffset({
        offset: reading.session.position.currentPage * SCREEN_W,
        animated: false,
      });
    }
  }, [reading.isRestoring]);

  const handleCommitAndArchive = useCallback(async () => {
    const result = await reading.commitCompletion();
    setCompletionSheetVisible(false);
    if (result.success) {
      router.back();
    } else {
      Alert.alert("오류", result.error ?? "완독 처리에 실패했습니다.");
    }
  }, [reading, router]);

  const handleCommitAndDelete = useCallback(async () => {
    const result = await reading.commitCompletion();
    setCompletionSheetVisible(false);
    if (result.success) {
      router.back();
    } else {
      Alert.alert("오류", result.error ?? "완독 처리에 실패했습니다.");
    }
  }, [reading, router]);

  const handleTextSelection = useCallback((text: string) => {
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
            page: reading.session.position.currentPage,
          },
        },
      });
      setSentencePopupVisible(false);
      setSelectedText("");
      Alert.alert("저장 완료", "문장이 저장되었습니다.");
    } catch {
      Alert.alert("오류", "문장 저장에 실패했습니다.");
    }
  }, [selectedText, userId, articleId, reading.session.position.currentPage, createSentence]);

  if (!articleId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>편지를 선택해주세요</Text>
        </View>
      </View>
    );
  }

  if (articleLoading || reading.isRestoring) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.emptyContainer}>
          <ProgressIndicator type="spinner" size="large" />
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={12} style={styles.backButton}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <View style={styles.progressContainer}>
          <ProgressIndicator type="linear" progress={reading.progress} size="small" />
        </View>
        <Text style={styles.pageIndicator}>
          {totalPages > 0
            ? `${reading.session.position.currentPage + 1}/${totalPages}`
            : ""}
        </Text>
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
        <FlatList
          ref={flatListRef}
          data={pages}
          keyExtractor={(_, idx) => `page-${idx}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={mode === "re_read" || reading.session.state === "READING"}
          onMomentumScrollEnd={handlePageChange}
          renderItem={({ item: pageContent, index }) => (
            <PageView
              content={pageContent}
              pageIndex={index}
              onTextSelect={handleTextSelection}
              insets={insets}
            />
          )}
          getItemLayout={(_, index) => ({
            length: SCREEN_W,
            offset: SCREEN_W * index,
            index,
          })}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>페이지가 없습니다</Text>
        </View>
      )}

      <BottomSheet
        visible={completionSheetVisible}
        onClose={() => {
          if (mode !== "basic") setCompletionSheetVisible(false);
        }}
        title="완독!"
        snapPoints={[0.35]}
        enableDragDown={mode !== "basic"}
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
    </View>
  );
}

function PageView({
  content,
  pageIndex,
  onTextSelect,
  insets,
}: {
  content: string;
  pageIndex: number;
  onTextSelect: (text: string) => void;
  insets: { bottom: number };
}) {
  return (
    <ScrollView
      style={[styles.pageContainer, { width: SCREEN_W }]}
      contentContainerStyle={[styles.pageContent, { paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.pageText} selectable onPress={() => {}}>
        {content}
      </Text>
    </ScrollView>
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
  progressContainer: {
    flex: 1,
  },
  pageIndicator: {
    ...Typography.caption,
    color: Colors.zinc400,
    minWidth: 32,
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
    flex: 1,
  },
  pageContent: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 16,
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
});
