import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useAutoSave } from "@/lib/useAutoSave";
import { canTransitionForward } from "@/lib/articleStatusCycle";
import type { ArticleStatus } from "@/lib/policies";
import {
  useGetArticle,
  useUpdateArticle,
  useTransitionArticleStatus,
  TransitionArticleBodyTargetStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export default function DraftScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const articleQuery = useGetArticle(id ?? "");
  const article = id ? articleQuery.data : undefined;
  const articleLoading = id ? articleQuery.isLoading : false;

  const updateArticle = useUpdateArticle();
  const transitionStatus = useTransitionArticleStatus();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const initializedRef = useRef(false);

  useEffect(() => {
    if (article && !initializedRef.current) {
      initializedRef.current = true;
      setTitle(article.title || "");
      setContent(article.content || "");
    }
  }, [article]);

  const handleSave = useCallback(
    async (data: { title: string; content: string }) => {
      if (!id) return;
      await updateArticle.mutateAsync({
        id,
        data: { title: data.title, content: data.content },
      });
    },
    [id, updateArticle],
  );

  const { status: saveStatus, markDirty, flush } = useAutoSave({
    onSave: handleSave,
    storageKey: id ? `draft_${id}` : undefined,
  });

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitle(text);
      markDirty(text, content);
    },
    [content, markDirty],
  );

  const handleContentChange = useCallback(
    (text: string) => {
      setContent(text);
      markDirty(title, text);
    },
    [title, markDirty],
  );

  const handleNext = useCallback(async () => {
    const flushResult = await flush();
    if (!flushResult.ok) {
      Alert.alert("저장 실패", "저장이 완료되지 않았습니다. 다시 시도해주세요.");
      return;
    }

    const result = canTransitionForward("DRAFT" as ArticleStatus, {
      content,
      title,
      pages: [],
      hasRedWarnings: false,
    });
    if (!result.allowed) {
      Alert.alert("전환 불가", result.reason);
      return;
    }

    try {
      await transitionStatus.mutateAsync({
        id: id!,
        data: { targetStatus: TransitionArticleBodyTargetStatus.DIVIDING },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.push({ pathname: "/on-01b", params: { id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "상태 전환에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [content, title, flush, id, router, transitionStatus, queryClient]);

  const handleBack = useCallback(async () => {
    await flush();
    queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
    router.back();
  }, [flush, router, queryClient]);

  const saveStatusLabel =
    saveStatus === "saving"
      ? "저장 중..."
      : saveStatus === "error"
        ? "저장 실패"
        : saveStatus === "saved"
          ? "저장됨"
          : "";

  const saveStatusColor =
    saveStatus === "error" ? "#ef4444" : Colors.zinc400;

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
          <Text style={styles.headerTitle}>작성</Text>
          {saveStatusLabel ? (
            <Text style={[styles.saveStatus, { color: saveStatusColor }]}>
              {saveStatusLabel}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={handleNext} hitSlop={12}>
          <Text style={styles.nextButton}>다음</Text>
        </Pressable>
      </View>
      <View style={styles.editor}>
        <TextInput
          style={styles.titleInput}
          placeholder="제목"
          placeholderTextColor={Colors.zinc400}
          value={title}
          onChangeText={handleTitleChange}
          maxLength={100}
        />
        <TextInput
          style={styles.contentInput}
          placeholder="떠오르는 생각을 자유롭게 적어보세요..."
          placeholderTextColor={Colors.zinc400}
          value={content}
          onChangeText={handleContentChange}
          multiline
          textAlignVertical="top"
          scrollEnabled
        />
      </View>
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
  saveStatus: {
    ...Typography.caption,
    fontSize: 11,
    marginTop: 2,
  },
  nextButton: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  editor: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 8,
  },
  titleInput: {
    ...Typography.bodySemiBold,
    fontSize: 22,
    color: Colors.zinc900,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    marginBottom: 12,
  },
  contentInput: {
    flex: 1,
    ...Typography.body,
    fontSize: 16,
    lineHeight: 26,
    color: Colors.zinc800,
    paddingVertical: 0,
  },
});
