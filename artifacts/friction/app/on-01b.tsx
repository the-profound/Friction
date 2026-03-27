import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import {
  splitContentToPages,
  validatePages,
} from "@/lib/pageDivision";
import { canTransitionForward } from "@/lib/articleStatusCycle";
import type { ArticleStatus } from "@/lib/policies";
import { MarkdownPolicy } from "@/lib/policies";
import {
  useGetArticle,
  useUpdateArticle,
  useTransitionArticleStatus,
  TransitionArticleBodyTargetStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const MAX_CHAR_PER_PAGE = 800;
const PAGE_DIVIDER = MarkdownPolicy.PAGE_DIVIDER;

export default function DividingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const articleQuery = useGetArticle(id ?? "");
  const article = id ? articleQuery.data : undefined;
  const articleLoading = id ? articleQuery.isLoading : false;

  const updateArticle = useUpdateArticle();
  const transitionStatus = useTransitionArticleStatus();

  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const initializedRef = useRef(false);

  useEffect(() => {
    if (article && !initializedRef.current) {
      initializedRef.current = true;
      if (article.pages && Array.isArray(article.pages) && article.pages.length > 0) {
        setContent((article.pages as string[]).join(`\n${PAGE_DIVIDER}\n`));
      } else {
        setContent(article.content || "");
      }
    }
  }, [article]);

  const pages = useMemo(() => splitContentToPages(content), [content]);
  const warnings = useMemo(() => validatePages(pages, MAX_CHAR_PER_PAGE), [pages]);
  const hasRedWarnings = warnings.some((w) => w.level === "red");

  const handleInsertDivider = useCallback((afterPageIndex: number) => {
    const rawPages = content.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
    if (afterPageIndex < 0 || afterPageIndex >= rawPages.length) return;
    const pageContent = rawPages[afterPageIndex];
    const paragraphs = pageContent.split("\n\n");
    if (paragraphs.length < 2) {
      Alert.alert("분할 불가", "이 페이지에는 나눌 수 있는 단락이 부족합니다.");
      return;
    }
    const midpoint = Math.floor(paragraphs.length / 2);
    const before = paragraphs.slice(0, midpoint).join("\n\n");
    const after = paragraphs.slice(midpoint).join("\n\n");
    rawPages[afterPageIndex] = `${before}\n${PAGE_DIVIDER}\n${after}`;
    setContent(rawPages.join(`\n${PAGE_DIVIDER}\n`));
  }, [content]);

  const handleRemoveDivider = useCallback((pageBreakIndex: number) => {
    const parts = content.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
    if (pageBreakIndex < 0 || pageBreakIndex >= parts.length - 1) return;
    parts[pageBreakIndex] = parts[pageBreakIndex] + "\n\n" + parts[pageBreakIndex + 1];
    parts.splice(pageBreakIndex + 1, 1);
    setContent(parts.join(`\n${PAGE_DIVIDER}\n`));
  }, [content]);

  const handleAutoSplit = useCallback(() => {
    const plain = content.replace(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "gm"), "\n\n");
    const paragraphs = plain.split("\n\n").filter((p) => p.trim());
    if (paragraphs.length < 2) {
      Alert.alert("자동 분할 불가", "단락이 부족하여 자동 분할할 수 없습니다.");
      return;
    }
    let currentPage: string[] = [];
    let currentLen = 0;
    const resultPages: string[] = [];
    for (const para of paragraphs) {
      if (currentLen + para.length > MAX_CHAR_PER_PAGE && currentPage.length > 0) {
        resultPages.push(currentPage.join("\n\n"));
        currentPage = [para];
        currentLen = para.length;
      } else {
        currentPage.push(para);
        currentLen += para.length;
      }
    }
    if (currentPage.length > 0) {
      resultPages.push(currentPage.join("\n\n"));
    }
    setContent(resultPages.join(`\n${PAGE_DIVIDER}\n`));
  }, [content]);

  const handleNext = useCallback(async () => {
    const result = canTransitionForward("DIVIDING" as ArticleStatus, {
      content,
      title: article?.title || "",
      pages: pages.map((p) => ({ pageIndex: p.pageIndex, content: p.content, charCount: p.charCount })),
      hasRedWarnings,
    });
    if (!result.allowed) {
      Alert.alert("전환 불가", result.reason);
      return;
    }

    try {
      const pagesJson = pages.map((p) => p.content);
      await updateArticle.mutateAsync({
        id: id!,
        data: { pages: pagesJson },
      });
      await transitionStatus.mutateAsync({
        id: id!,
        data: { targetStatus: TransitionArticleBodyTargetStatus.CLOSING },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.push({ pathname: "/on-01c", params: { id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "상태 전환에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [content, article, pages, hasRedWarnings, id, router, updateArticle, transitionStatus, queryClient]);

  const handleBack = useCallback(async () => {
    if (!id) { router.back(); return; }
    try {
      const pagesJson = pages.map((p) => p.content);
      await updateArticle.mutateAsync({
        id,
        data: { content, pages: pagesJson },
      });
      await transitionStatus.mutateAsync({
        id,
        data: { targetStatus: TransitionArticleBodyTargetStatus.DRAFT },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.back();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "상태 되돌리기에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [id, content, pages, router, updateArticle, transitionStatus, queryClient]);

  if (!id || articleLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.zinc400} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>분할</Text>
          <Text style={styles.pageCount}>{pages.length}페이지</Text>
        </View>
        <Pressable onPress={handleNext} hitSlop={12}>
          <Text style={styles.nextButton}>다음</Text>
        </Pressable>
      </View>

      <View style={styles.toolbar}>
        <Pressable
          style={[styles.toolbarButton, mode === "preview" && styles.toolbarButtonActive]}
          onPress={() => setMode("preview")}
        >
          <Feather name="eye" size={14} color={mode === "preview" ? Colors.white : Colors.zinc600} />
          <Text style={[styles.toolbarText, mode === "preview" && styles.toolbarTextActive]}>미리보기</Text>
        </Pressable>
        <Pressable
          style={[styles.toolbarButton, mode === "edit" && styles.toolbarButtonActive]}
          onPress={() => setMode("edit")}
        >
          <Feather name="edit-2" size={14} color={mode === "edit" ? Colors.white : Colors.zinc600} />
          <Text style={[styles.toolbarText, mode === "edit" && styles.toolbarTextActive]}>편집</Text>
        </Pressable>
        <View style={styles.toolbarSpacer} />
        <Pressable style={styles.autoSplitButton} onPress={handleAutoSplit}>
          <Feather name="scissors" size={14} color={Colors.zinc600} />
          <Text style={styles.autoSplitText}>자동분할</Text>
        </Pressable>
      </View>

      {mode === "edit" ? (
        <View style={styles.editContainer}>
          <Text style={styles.editHint}>
            "{PAGE_DIVIDER}" 를 줄 단위로 입력하면 페이지가 나뉩니다
          </Text>
          <TextInput
            style={styles.editInput}
            value={content}
            onChangeText={setContent}
            multiline
            textAlignVertical="top"
            scrollEnabled
            placeholder="내용을 편집하세요..."
            placeholderTextColor={Colors.zinc400}
          />
        </View>
      ) : (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          {pages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Feather name="scissors" size={36} color={Colors.zinc300} />
              <Text style={styles.emptyTitle}>분할할 내용이 없어요</Text>
              <Text style={styles.emptySubtitle}>이전 단계에서 작성한 내용이 표시됩니다</Text>
            </View>
          ) : (
            pages.map((page, idx) => {
              const pageWarnings = warnings.filter((w) => w.pageIndex === idx);
              return (
                <View key={idx}>
                  <View style={[styles.pageCard, pageWarnings.length > 0 && styles.pageCardWarning]}>
                    <View style={styles.pageHeader}>
                      <Text style={styles.pageLabel}>페이지 {idx + 1}</Text>
                      <Text style={styles.charCount}>{page.charCount}자</Text>
                    </View>
                    <Text style={styles.pageContent} numberOfLines={6}>
                      {page.content}
                    </Text>
                    {pageWarnings.map((w, wi) => (
                      <Text key={wi} style={styles.warningText}>
                        {w.reason}
                      </Text>
                    ))}
                    {page.charCount > MAX_CHAR_PER_PAGE && (
                      <Pressable
                        style={styles.splitPageButton}
                        onPress={() => handleInsertDivider(idx)}
                      >
                        <Feather name="scissors" size={14} color={Colors.zinc600} />
                        <Text style={styles.splitPageText}>이 페이지 나누기</Text>
                      </Pressable>
                    )}
                  </View>
                  {idx < pages.length - 1 ? (
                    <Pressable style={styles.dividerRow} onPress={() => handleRemoveDivider(idx)}>
                      <View style={styles.dividerLine} />
                      <View style={styles.dividerButton}>
                        <Feather name="x" size={12} color={Colors.zinc500} />
                      </View>
                      <View style={styles.dividerLine} />
                    </Pressable>
                  ) : idx < pages.length && (
                    <Pressable
                      style={styles.addDividerRow}
                      onPress={() => handleInsertDivider(idx)}
                    >
                      <View style={styles.addDividerLine} />
                      <View style={styles.addDividerButton}>
                        <Feather name="plus" size={12} color={Colors.zinc500} />
                      </View>
                      <View style={styles.addDividerLine} />
                    </Pressable>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
  },
  headerCenter: {
    alignItems: "center",
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  pageCount: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    marginTop: 2,
  },
  nextButton: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  toolbarButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.zinc50,
  },
  toolbarButtonActive: {
    backgroundColor: Colors.zinc900,
  },
  toolbarText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc600,
  },
  toolbarTextActive: {
    color: Colors.white,
  },
  toolbarSpacer: {
    flex: 1,
  },
  autoSplitButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.zinc200,
  },
  autoSplitText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc600,
  },
  editContainer: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
  },
  editHint: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
    paddingVertical: 8,
    textAlign: "center",
  },
  editInput: {
    flex: 1,
    ...Typography.body,
    fontSize: 15,
    lineHeight: 24,
    color: Colors.zinc800,
    paddingVertical: 0,
    textAlignVertical: "top",
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 0,
  },
  pageCard: {
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    padding: 16,
  },
  pageCardWarning: {
    borderWidth: 1,
    borderColor: "#ef4444",
  },
  pageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  pageLabel: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc600,
  },
  charCount: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  pageContent: {
    ...Typography.body,
    fontSize: 14,
    lineHeight: 22,
    color: Colors.zinc800,
  },
  warningText: {
    ...Typography.caption,
    fontSize: 12,
    color: "#ef4444",
    marginTop: 8,
  },
  splitPageButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Colors.zinc100,
    alignSelf: "flex-start",
  },
  splitPageText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc600,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.zinc200,
  },
  dividerButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 8,
  },
  addDividerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  addDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.zinc100,
    borderStyle: "dashed" as never,
  },
  addDividerButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.zinc50,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 80,
    gap: 8,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    marginTop: 8,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
  },
});
