import React, { useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { splitContentToPages } from "@/lib/pageDivision";
import { canTransitionForward, canStepBack } from "@/lib/articleStatusCycle";
import type { ArticleStatus } from "@/lib/policies";

export default function ClosingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [content] = useState("");
  const [title] = useState("");
  const [previewPage, setPreviewPage] = useState(0);

  const pages = useMemo(() => splitContentToPages(content), [content]);

  const handleExport = useCallback(() => {
    const status: ArticleStatus = "CLOSING";
    const result = canTransitionForward(status, {
      content,
      title,
      pages: pages.map((p) => ({ pageIndex: p.pageIndex, content: p.content, charCount: p.charCount })),
      hasRedWarnings: false,
    });
    if (!result.allowed) {
      Alert.alert("내보내기 불가", result.reason);
      return;
    }
    Alert.alert(
      "편지로 내보내기",
      "내보내면 더 이상 수정할 수 없어요. 진행할까요?",
      [
        { text: "취소", style: "cancel" },
        {
          text: "내보내기",
          style: "destructive",
          onPress: () => {
            // TODO: transition to LETTER + save + navigate
            router.replace("/");
          },
        },
      ],
    );
  }, [content, title, pages, router]);

  const handleBack = useCallback(() => {
    const result = canStepBack("CLOSING");
    if (!result.allowed) {
      Alert.alert("돌아갈 수 없음", result.reason);
      return;
    }
    router.back();
  }, [router]);

  const currentPage = pages[previewPage] || null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>마감</Text>
          {pages.length > 0 && (
            <Text style={styles.pageIndicator}>
              {previewPage + 1} / {pages.length}
            </Text>
          )}
        </View>
        <Pressable onPress={handleExport} hitSlop={12}>
          <Text style={styles.exportButton}>내보내기</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {pages.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Feather name="eye" size={36} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>미리보기할 내용이 없어요</Text>
          </View>
        ) : (
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>{title || "제목 없음"}</Text>
            <Text style={styles.previewContent}>{currentPage?.content}</Text>
          </View>
        )}
      </ScrollView>
      {pages.length > 1 && (
        <View style={[styles.pageNav, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable
            style={[styles.pageNavButton, previewPage === 0 && styles.pageNavButtonDisabled]}
            onPress={() => setPreviewPage((p) => Math.max(0, p - 1))}
            disabled={previewPage === 0}
          >
            <Feather name="chevron-left" size={20} color={previewPage === 0 ? Colors.zinc300 : Colors.zinc600} />
          </Pressable>
          <Text style={styles.pageNavText}>
            {previewPage + 1} / {pages.length}
          </Text>
          <Pressable
            style={[styles.pageNavButton, previewPage >= pages.length - 1 && styles.pageNavButtonDisabled]}
            onPress={() => setPreviewPage((p) => Math.min(pages.length - 1, p + 1))}
            disabled={previewPage >= pages.length - 1}
          >
            <Feather name="chevron-right" size={20} color={previewPage >= pages.length - 1 ? Colors.zinc300 : Colors.zinc600} />
          </Pressable>
        </View>
      )}
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
  headerCenter: {
    alignItems: "center",
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  pageIndicator: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    marginTop: 2,
  },
  exportButton: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 16,
    paddingBottom: 40,
  },
  previewCard: {
    backgroundColor: Colors.zinc50,
    borderRadius: 16,
    padding: 24,
    minHeight: 400,
  },
  previewTitle: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    marginBottom: 20,
  },
  previewContent: {
    ...Typography.body,
    fontSize: 16,
    lineHeight: 28,
    color: Colors.zinc800,
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
  pageNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 12,
    gap: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  pageNavButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.zinc50,
    alignItems: "center",
    justifyContent: "center",
  },
  pageNavButtonDisabled: {
    opacity: 0.5,
  },
  pageNavText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc600,
  },
});
