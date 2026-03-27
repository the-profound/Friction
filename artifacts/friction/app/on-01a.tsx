import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useAutoSave } from "@/lib/useAutoSave";
import { canTransitionForward } from "@/lib/articleStatusCycle";
import type { ArticleStatus } from "@/lib/policies";

export default function DraftScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const handleSave = useCallback(
    async (data: { title: string; content: string }) => {
      // TODO: persist to local DB / API
    },
    [],
  );

  const { status: saveStatus, markDirty, flush } = useAutoSave({ onSave: handleSave });

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
    await flush();
    const status: ArticleStatus = "DRAFT";
    const result = canTransitionForward(status, {
      content,
      title,
      pages: [],
      hasRedWarnings: false,
    });
    if (!result.allowed) {
      Alert.alert("전환 불가", result.reason);
      return;
    }
    router.push({ pathname: "/on-01b", params: { id } });
  }, [content, title, flush, id, router]);

  const handleBack = useCallback(async () => {
    await flush();
    router.back();
  }, [flush, router]);

  const saveStatusLabel =
    saveStatus === "saving" ? "저장 중..." : saveStatus === "error" ? "저장 실패" : "";

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>작성</Text>
          {saveStatusLabel ? (
            <Text style={styles.saveStatus}>{saveStatusLabel}</Text>
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
    color: Colors.zinc400,
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
