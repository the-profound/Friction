import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useAutoSave } from "@/lib/useAutoSave";
import { canTransitionForward } from "@/lib/articleStatusCycle";
import type { ArticleStatus } from "@/lib/policies";
import WebViewMarkdownEditor from "@/components/WebViewMarkdownEditor/WebViewMarkdownEditorCompat";
import type { WebViewMarkdownEditorRef, OnChangePayload, OnExportMarkdownPayload } from "@/components/WebViewMarkdownEditor/types";
import {
  useGetArticle,
  useUpdateArticle,
  useDeleteArticle,
  useTransitionArticleStatus,
  TransitionArticleBodyTargetStatus,
  ApiError,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/contexts/UserContext";
import SourceArticlePickerSheet from "@/components/SourceArticlePickerSheet/SourceArticlePickerSheet";

export default function DraftScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useUser();

  const articleQuery = useGetArticle(id ?? "");
  const article = id ? articleQuery.data : undefined;
  const articleLoading = id ? articleQuery.isLoading : false;

  const updateArticle = useUpdateArticle();
  const deleteArticle = useDeleteArticle();
  const transitionStatus = useTransitionArticleStatus();

  const editorRef = useRef<WebViewMarkdownEditorRef>(null);
  const [title, setTitle] = useState("");
  const [charCount, setCharCount] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const contentRef = useRef("");
  const titleRef = useRef("");
  const initializedRef = useRef(false);
  const articleContentRef = useRef("");
  const isNavigatingRef = useRef(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const pendingExportRef = useRef<{
    resolve: (md: string) => void;
    requestId: string;
  } | null>(null);

  const [sourceArticleId, setSourceArticleId] = useState<string | null>(null);
  const [sourceArticleTitle, setSourceArticleTitle] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  const sourceArticleQuery = useGetArticle(sourceArticleId ?? "", {
    query: { enabled: !!sourceArticleId },
  });

  useEffect(() => {
    if (sourceArticleQuery.data) {
      setSourceArticleTitle(sourceArticleQuery.data.title || null);
    }
  }, [sourceArticleQuery.data]);

  useEffect(() => {
    if (article && !initializedRef.current) {
      initializedRef.current = true;
      const t = article.title || "";
      const c = article.content || "";
      setTitle(t);
      titleRef.current = t;
      contentRef.current = c;
      articleContentRef.current = c;
      setCharCount(c.length);
      if (editorReady) {
        editorRef.current?.setMarkdown(c);
        editorRef.current?.setTitle(t);
      }
      if (article.sourceArticleId) {
        setSourceArticleId(article.sourceArticleId);
      }
    }
  }, [article, editorReady]);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleEditorReady = useCallback(() => {
    setEditorReady(true);
    editorRef.current?.setMarkdown(articleContentRef.current);
    editorRef.current?.setTitle(titleRef.current);
  }, []);

  const getEditorContent = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      if (!editorRef.current || !editorReady) {
        resolve(contentRef.current);
        return;
      }
      const requestId = `export_${Date.now()}`;
      pendingExportRef.current = { resolve, requestId };
      editorRef.current.requestExportMarkdown(requestId);
      setTimeout(() => {
        if (pendingExportRef.current?.requestId === requestId) {
          pendingExportRef.current = null;
          resolve(contentRef.current);
        }
      }, 2000);
    });
  }, [editorReady]);

  const handleExportMarkdown = useCallback((payload: OnExportMarkdownPayload) => {
    contentRef.current = payload.markdown;
    if (pendingExportRef.current?.requestId === payload.requestId) {
      pendingExportRef.current.resolve(payload.markdown);
      pendingExportRef.current = null;
    }
  }, []);

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

  const { markDirty, flush } = useAutoSave({
    onSave: handleSave,
    storageKey: id ? `draft_${id}` : undefined,
  });

  const handleEditorChange = useCallback((_payload: OnChangePayload) => {
    if (_payload.charCount !== undefined) {
      setCharCount(_payload.charCount);
    }
    if (_payload.isDirty && editorRef.current) {
      const requestId = `autosave_${Date.now()}`;
      pendingExportRef.current = {
        resolve: (md: string) => {
          contentRef.current = md;
          markDirty(titleRef.current, md);
        },
        requestId,
      };
      editorRef.current.requestExportMarkdown(requestId);
    }
  }, [markDirty]);

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitle(text);
      titleRef.current = text;
      markDirty(text, contentRef.current);
    },
    [markDirty],
  );

  const handleSourceArticleSelect = useCallback(
    async (articleId: string, articleTitle: string) => {
      if (!id) return;
      try {
        await updateArticle.mutateAsync({
          id,
          data: { sourceArticleId: articleId },
        });
        setSourceArticleId(articleId);
        setSourceArticleTitle(articleTitle);
        queryClient.invalidateQueries({ queryKey: [`/api/articles/${id}`] });
      } catch {
        Alert.alert("오류", "원글 연결에 실패했습니다.");
      }
    },
    [id, updateArticle, queryClient],
  );

  const handleSourceArticleUnlink = useCallback(async () => {
    if (!id) return;
    try {
      await updateArticle.mutateAsync({
        id,
        data: { sourceArticleId: null },
      });
      setSourceArticleId(null);
      setSourceArticleTitle(null);
      queryClient.invalidateQueries({ queryKey: [`/api/articles/${id}`] });
    } catch {
      Alert.alert("오류", "원글 연결 해제에 실패했습니다.");
    }
  }, [id, updateArticle, queryClient]);

  const handleNext = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    const content = await getEditorContent();
    markDirty(titleRef.current, content);
    const flushResult = await flush();
    if (!flushResult.ok) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      Alert.alert("저장 실패", "저장이 완료되지 않았습니다. 다시 시도해주세요.");
      return;
    }

    const currentTitle = titleRef.current;
    const result = canTransitionForward("DRAFT" as ArticleStatus, {
      content,
      title: currentTitle,
      pages: [],
      hasRedWarnings: false,
    });
    if (!result.allowed) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      Alert.alert("전환 불가", result.reason);
      return;
    }

    try {
      await updateArticle.mutateAsync({
        id: id!,
        data: { title: currentTitle, content },
      });
      queryClient.setQueryData([`/api/articles/${id}`], (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        return { ...old, title: currentTitle, content };
      });
      if (article?.status !== "DIVIDING") {
        try {
          await transitionStatus.mutateAsync({
            id: id!,
            data: { targetStatus: TransitionArticleBodyTargetStatus.DIVIDING },
          });
        } catch (e: unknown) {
          if (!(e instanceof ApiError && e.status === 400)) throw e;
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      router.push({ pathname: "/on-01b", params: { id } });
    } catch (e: unknown) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      const msg = e instanceof Error ? e.message : "상태 전환에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [flush, id, router, updateArticle, transitionStatus, queryClient, getEditorContent, markDirty, article]);

  const handleDismissKeyboard = useCallback(() => {
    editorRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const handleBack = useCallback(async () => {
    const content = await getEditorContent();
    const currentTitle = titleRef.current.trim();
    const currentContent = content.trim();

    if (!currentTitle && !currentContent) {
      if (id) {
        try {
          await deleteArticle.mutateAsync({ id });
        } catch {
Alert.alert("오류", "빈 메모 삭제에 실패했습니다.");
        }
        queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      }
      router.back();
      return;
    }

    markDirty(titleRef.current, content);
    const flushResult = await flush();
    if (!flushResult.ok) {
Alert.alert("오류", "저장에 실패했습니다. 내용을 확인해주세요.");
    }
    queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
    router.back();
  }, [flush, router, queryClient, getEditorContent, markDirty, id, deleteArticle]);

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
        <Text style={styles.headerTitle}>작성</Text>
        {keyboardVisible ? (
          <Pressable onPress={handleDismissKeyboard} hitSlop={12}>
            <MaterialCommunityIcons name="keyboard-off-outline" size={22} color={Colors.zinc600} />
          </Pressable>
        ) : (
          <Pressable onPress={handleNext} hitSlop={12} disabled={isNavigating}>
            <Text style={[styles.nextButton, isNavigating && styles.nextButtonDisabled]}>다음</Text>
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.editor}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.markdownEditorContainer}>
          <WebViewMarkdownEditor
            ref={editorRef}
            initialMarkdown={contentRef.current}
            titleValue={title}
            placeholder="떠오르는 생각을 자유롭게 적어보세요..."
            editable
            onReady={handleEditorReady}
            onChange={handleEditorChange}
            onExportMarkdown={handleExportMarkdown}
            onTitleChange={handleTitleChange}
            onKeyboardVisibilityChange={setKeyboardVisible}
            belowTitleSlot={
              <Pressable
                style={styles.sourceArticleRow}
                onPress={() => setPickerVisible(true)}
                hitSlop={4}
              >
                <Text style={styles.sourceArticleText} numberOfLines={1}>
                  {sourceArticleId
                    ? `⤷ ${sourceArticleTitle ?? "로딩 중..."} 의 답장`
                    : "⤷ 이 글을 답장으로 설정"}
                </Text>
                <Text style={styles.sourceArticleGear}>⚙️</Text>
              </Pressable>
            }
            sourceArticleSlotText={
              sourceArticleId
                ? `⤷ ${sourceArticleTitle ?? "로딩 중..."} 의 답장 ⚙️`
                : "⤷ 이 글을 답장으로 설정 ⚙️"
            }
            onSourceArticleSlotTap={() => setPickerVisible(true)}
          />
        </View>
        <View style={styles.editorFooter}>
          <Text style={styles.charCountText}>{charCount}자</Text>
        </View>
      </KeyboardAvoidingView>

      {userId && (
        <SourceArticlePickerSheet
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          userId={userId}
          currentSourceArticleId={sourceArticleId}
          currentSourceArticleTitle={sourceArticleTitle}
          onSelect={handleSourceArticleSelect}
          onUnlink={handleSourceArticleUnlink}
        />
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
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  nextButton: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  nextButtonDisabled: {
    color: Colors.zinc400,
  },
  sourceArticleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 8,
    gap: 4,
  },
  sourceArticleText: {
    flex: 1,
    fontSize: 13,
    color: Colors.zinc400,
    fontFamily: "Pretendard",
  },
  sourceArticleGear: {
    fontSize: 13,
  },
  editor: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 8,
  },
  markdownEditorContainer: {
    flex: 1,
  },
  editorFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  charCountText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
});
