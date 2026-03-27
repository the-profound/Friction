import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import {
  splitContentToPages,
  insertDividerAtPosition,
  removeDividerAtPageIndex,
  validatePages,
} from "@/lib/pageDivision";
import { canTransitionForward } from "@/lib/articleStatusCycle";
import type { ArticleStatus } from "@/lib/policies";
import {
  useGetArticle,
  useUpdateArticle,
  useTransitionArticleStatus,
  TransitionArticleBodyTargetStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const MAX_CHAR_PER_PAGE = 800;

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
  const initializedRef = useRef(false);

  useEffect(() => {
    if (article && !initializedRef.current) {
      initializedRef.current = true;
      if (article.pages && Array.isArray(article.pages) && article.pages.length > 0) {
        setContent((article.pages as string[]).join("\n---\n"));
      } else {
        setContent(article.content || "");
      }
    }
  }, [article]);

  const pages = useMemo(() => splitContentToPages(content), [content]);
  const warnings = useMemo(() => validatePages(pages, MAX_CHAR_PER_PAGE), [pages]);
  const hasRedWarnings = warnings.some((w) => w.level === "red");

  const handleAddDivider = useCallback(
    (paragraphIndex: number) => {
      setContent((prev) => insertDividerAtPosition(prev, paragraphIndex));
    },
    [],
  );

  const handleRemoveDivider = useCallback(
    (pageBreakIndex: number) => {
      setContent((prev) => removeDividerAtPageIndex(prev, pageBreakIndex));
    },
    [],
  );

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
  }, [id, router, transitionStatus, queryClient]);

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
                </View>
                {idx < pages.length - 1 && (
                  <Pressable style={styles.dividerRow} onPress={() => handleRemoveDivider(idx)}>
                    <View style={styles.dividerLine} />
                    <View style={styles.dividerButton}>
                      <Feather name="x" size={12} color={Colors.zinc500} />
                    </View>
                    <View style={styles.dividerLine} />
                  </Pressable>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
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
