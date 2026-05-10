import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Alert, ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, BackHandler } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useAutoSave } from "@/lib/useAutoSave";
import { useEditorLayout } from "@/lib/useEditorLayout";
import { canTransitionForward } from "@/lib/articleStatusCycle";
import type { ArticleStatus } from "@/lib/policies";
import WebViewMarkdownEditor from "@/components/WebViewMarkdownEditor/WebViewMarkdownEditorCompat";
import type { WebViewMarkdownEditorRef, OnChangePayload, OnExportMarkdownPayload, OnSelectionUpdatePayload } from "@/components/WebViewMarkdownEditor/types";
import {
  useGetArticle,
  useUpdateArticle,
  useDeleteArticle,
  useTransitionArticleStatus,
  TransitionArticleBodyTargetStatus,
  ApiError,
  getGetArticleQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateArticleLists, invalidateArticleDetail } from "@/lib/queryInvalidation";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import SourceArticlePickerSheet from "@/components/SourceArticlePickerSheet/SourceArticlePickerSheet";
import WritingStateBar, { type WritingStage } from "@/components/WritingStateBar/WritingStateBar";
import KeyboardToolbar from "@/components/KeyboardToolbar/KeyboardToolbar";
import BlockTypeSheet from "@/components/KeyboardToolbar/BlockTypeSheet";

const DEFAULT_SELECTION: OnSelectionUpdatePayload = {
  activeBlock: "paragraph",
  isBold: false,
  isItalic: false,
  isUnderline: false,
};

export default function DraftScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
  const { userId } = useUser();
  const { showToast } = useToast();
  const editorLayout = useEditorLayout();

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
  const [selectionState, setSelectionState] = useState<OnSelectionUpdatePayload>(DEFAULT_SELECTION);
  const [blockTypeSheetVisible, setBlockTypeSheetVisible] = useState(false);
  const contentRef = useRef("");
  const titleRef = useRef("");
  const initializedRef = useRef(false);
  const articleContentRef = useRef("");
  const mountedAtRef = useRef(Date.now());
  const isNavigatingRef = useRef(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const pendingExportRef = useRef<{
    resolve: (md: string) => void;
    requestId: string;
  } | null>(null);
  const exportDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportPendingRef = useRef(false);
  const EXPORT_DEBOUNCE_MS = 1200;

  const [sourceArticleId, setSourceArticleId] = useState<string | null>(null);
  const [sourceArticleTitle, setSourceArticleTitle] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  const sourceArticleQuery = useGetArticle(sourceArticleId ?? "", {
    query: { queryKey: getGetArticleQueryKey(sourceArticleId ?? ""), enabled: !!sourceArticleId },
  });

  useEffect(() => {
    if (sourceArticleQuery.data) {
      setSourceArticleTitle(sourceArticleQuery.data.title || null);
    }
  }, [sourceArticleQuery.data]);

  // Skip the mount-time invalidate when the cache was just primed (≤30s old)
  // by a sibling screen's optimistic setQueryData. This avoids a wasted
  // network RTT on every in-session navigation while still refreshing on cold
  // entry (deep links, app resume) where the cache is genuinely stale.
  useEffect(() => {
    if (!id) return;
    const cached = queryClient.getQueryState(getGetArticleQueryKey(id));
    const fresh = !!cached && Date.now() - cached.dataUpdatedAt < 30_000;
    if (!fresh) {
      invalidateArticleDetail(queryClient, id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Allow up to 30s of slack so cache primed via setQueryData (with
    // updatedAt: Date.now()) on the previous screen passes the gate immediately.
    // A truly stale cache (older than 30s, e.g. cold entry from inbox) still
    // waits for the in-flight refetch — preserving the original safety property.
    const isDataFresh = articleQuery.dataUpdatedAt >= mountedAtRef.current - 30_000;
    if (article && !initializedRef.current && isDataFresh) {
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
  }, [article, editorReady, articleQuery.dataUpdatedAt]);

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

  const { markDirty, markTitleDirty, flush } = useAutoSave({
    onSave: handleSave,
    storageKey: id ? `draft_${id}` : undefined,
  });

  const handleEditorChange = useCallback((_payload: OnChangePayload) => {
    if (_payload.charCount !== undefined) {
      setCharCount(_payload.charCount);
    }
    if (_payload.isDirty) {
      // 매 onChange 마다 export+markDirty 를 즉시 돌리면 본문이 길어질수록
      // editor.getHTML() → htmlToMarkdown → RN 브리지 왕복 → AsyncStorage 직렬화
      // 비용이 입력 한 번마다 누적되어 한글 IME 합성 중에 화면이 멈추는 원인이 된다.
      // 입력이 잠시 멈춘 뒤 1회만 export 하도록 디바운스한다.
      exportPendingRef.current = true;
      if (exportDebounceTimerRef.current) clearTimeout(exportDebounceTimerRef.current);
      exportDebounceTimerRef.current = setTimeout(() => {
        exportDebounceTimerRef.current = null;
        if (!exportPendingRef.current) return;
        exportPendingRef.current = false;
        if (!editorRef.current) return;
        const requestId = `autosave_${Date.now()}`;
        pendingExportRef.current = {
          resolve: (md: string) => {
            contentRef.current = md;
            markDirty(titleRef.current, md);
          },
          requestId,
        };
        editorRef.current.requestExportMarkdown(requestId);
      }, EXPORT_DEBOUNCE_MS);
    }
  }, [markDirty]);

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitle(text);
      titleRef.current = text;
      // 제목 전용 dirty 경로 사용: latestDataRef 에 본문 문자열을 매번 다시
      // 싣지 않는다. 본문은 본문 입력 디바운스 경로(또는 flush 시 강제 export)
      // 에서 갱신되며, 저장 직전 handleNext/handleBack 이 마지막 본문을
      // markDirty 로 한 번 더 보장한다.
      markTitleDirty(text, contentRef.current);
    },
    [markTitleDirty],
  );

  const handleSelectionUpdate = useCallback((payload: OnSelectionUpdatePayload) => {
    setSelectionState(payload);
  }, []);

  const handleToolbarFormat = useCallback(() => {
    setBlockTypeSheetVisible(true);
  }, []);

  const handleBlockTypeSelect = useCallback((blockType: string) => {
    editorRef.current?.setBlockType(blockType);
  }, []);

  const handleToolbarBold = useCallback(() => {
    editorRef.current?.toggleMark("bold");
  }, []);

  const handleToolbarItalic = useCallback(() => {
    editorRef.current?.toggleMark("italic");
  }, []);

  const handleToolbarUnderline = useCallback(() => {
    editorRef.current?.toggleMark("underline");
  }, []);

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
        invalidateArticleDetail(queryClient, id);
      } catch {
        Alert.alert("오류", "답장 대상 편지 연결에 실패했습니다.");
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
      invalidateArticleDetail(queryClient, id);
    } catch {
      Alert.alert("오류", "답장 대상 편지 연결 해제에 실패했습니다.");
    }
  }, [id, updateArticle, queryClient]);

  const handleNext = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    editorRef.current?.blur();
    Keyboard.dismiss();

    if (!titleRef.current.trim()) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      showToast({ message: "제목을 입력해주세요.", type: "info" });
      return;
    }

    // 디바운스 대기 중이던 본문 export 가 있으면 취소하고, 즉시 1회만 export 한다.
    if (exportDebounceTimerRef.current) {
      clearTimeout(exportDebounceTimerRef.current);
      exportDebounceTimerRef.current = null;
    }
    exportPendingRef.current = false;
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
      showToast({ message: result.reason, type: "info" });
      return;
    }

    // Optimistically reflect the new title/content/status in the cache so the
    // next screen renders immediately with fresh data instead of flashing the
    // previous version. We pass `{ updatedAt: Date.now() }` so the receiving
    // screen's freshness gate (dataUpdatedAt vs mountedAt) accepts this cache
    // immediately — without it, setQueryData leaves dataUpdatedAt at the last
    // network fetch time and the next screen blocks on a needless refetch.
    queryClient.setQueryData(
      getGetArticleQueryKey(id),
      (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        return { ...old, title: currentTitle, content, status: "DIVIDING" };
      },
      { updatedAt: Date.now() },
    );

    // Navigate first for a natural, snappy stack-push animation. The body has
    // already been persisted by flush() above, so on-01b can refetch and render
    // the saved content. The status transition fires in the background — if it
    // fails (non-400) we log and surface a toast, but the user keeps moving.
    router.push({ pathname: "/on-01b", params: { id } });
    isNavigatingRef.current = false;
    setIsNavigating(false);

    if (article?.status !== "DIVIDING") {
      transitionStatus
        .mutateAsync({
          id: id!,
          data: { targetStatus: TransitionArticleBodyTargetStatus.DIVIDING },
        })
        .catch((e: unknown) => {
          const status = (e as { status?: number } | null)?.status;
          if (status === 400) return;
          console.warn("[on-01a] background status transition failed:", e);
        })
        .finally(() => {
          invalidateArticleLists(queryClient);
        });
    } else {
      invalidateArticleLists(queryClient);
    }
  }, [flush, id, router, transitionStatus, queryClient, getEditorContent, markDirty, article, showToast]);

  const handleDismissKeyboard = useCallback(() => {
    editorRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const handleInsertDivider = useCallback(() => {
    editorRef.current?.insertDivider();
  }, []);

  const handleShiftEnter = useCallback(() => {
    editorRef.current?.insertHardBreak();
  }, []);

  const handleBack = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);

    editorRef.current?.blur();
    Keyboard.dismiss();

    if (exportDebounceTimerRef.current) {
      clearTimeout(exportDebounceTimerRef.current);
      exportDebounceTimerRef.current = null;
    }
    exportPendingRef.current = false;
    const content = await getEditorContent();
    const currentTitle = titleRef.current.trim();
    const currentContent = content.trim();

    if (source === "quote") {
      if (!currentTitle) {
        isNavigatingRef.current = false;
        setIsNavigating(false);
        showToast({ message: "제목을 입력해주세요.", type: "info" });
        return;
      }
    } else if (!currentTitle && !currentContent) {
      if (id) {
        try {
          await deleteArticle.mutateAsync({ id });
        } catch {
          Alert.alert("오류", "빈 메모 삭제에 실패했습니다.");
        }
        invalidateArticleLists(queryClient);
      }
      isNavigatingRef.current = false;
      setIsNavigating(false);
      router.back();
      return;
    }

    markDirty(titleRef.current, content);
    const flushResult = await flush();
    if (!flushResult.ok) {
      isNavigatingRef.current = false;
      setIsNavigating(false);
      Alert.alert("오류", "저장에 실패했습니다. 내용을 확인해주세요.");
      return;
    }
    invalidateArticleLists(queryClient);
    isNavigatingRef.current = false;
    setIsNavigating(false);
    if (source === "quote") {
      router.replace("/(tabs)/archive");
    } else {
      router.back();
    }
  }, [flush, router, queryClient, getEditorContent, markDirty, id, deleteArticle, source, showToast]);

  const handleStateBarPress = useCallback((target: WritingStage) => {
    if (target === "DRAFT") return;
    if (target === "DIVIDING") {
      handleNext();
      return;
    }
    showToast({ message: "분할 단계를 먼저 완료해야 마감 단계로 이동할 수 있어요.", type: "info" });
  }, [handleNext, showToast]);

  useEffect(() => {
    return () => {
      if (exportDebounceTimerRef.current) {
        clearTimeout(exportDebounceTimerRef.current);
        exportDebounceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // 아직 article 데이터가 초기화되지 않았다면 refs가 비어있어
      // handleBack의 빈 메모 삭제 분기를 잘못 실행할 수 있다.
      // 이 경우 저장 로직을 건너뛰고 단순히 뒤로 이동한다.
      if (!initializedRef.current) {
        router.back();
        return true;
      }
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack, router]);

  if (!id || articleLoading) {
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: false }} />
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.zinc400} />
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ScalePressable onPress={handleBack} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <WritingStateBar
          current="DRAFT"
          onPress={handleStateBarPress}
          disabled={isNavigating}
        />
        {keyboardVisible ? (
          <ScalePressable onPress={handleDismissKeyboard} hitSlop={12}>
            <MaterialCommunityIcons name="keyboard-off-outline" size={22} color={Colors.zinc600} />
          </ScalePressable>
        ) : isNavigating ? (
          <ActivityIndicator size="small" color={Colors.zinc400} />
        ) : (
          <View style={styles.headerRight} />
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.editorOuter}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.editorInner, { width: editorLayout.safeAreaWidth }]}>
        {/*
          본문 텍스트 컬럼은 4개 화면(작성/분할/마감/읽기)이 동일한 정수 픽셀 폭으로
          줄넘김을 결정해야 한다. 컨테이너에 paddingHorizontal을 주는 대신
          editorLayout.textColumnWidth (= Math.round(safeAreaWidth − 2×paddingX))을
          그대로 자식 View의 width로 사용해 Yoga 픽셀 스냅이 부모 위치에 따라
          ±1px 흔들리는 일을 차단한다.
        */}
        <View style={[styles.markdownEditorContainer, { width: editorLayout.textColumnWidth, alignSelf: "center" }]}>
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
            onSelectionUpdate={handleSelectionUpdate}
            bodyFontSize={editorLayout.bodyFontSize}
            bodyLetterSpacing={editorLayout.bodyLetterSpacing}
            titleFontSize={editorLayout.titleFontSize}
            belowTitleSlot={
              <ScalePressable
                style={styles.sourceArticleRow}
                onPress={() => setPickerVisible(true)}
                hitSlop={4}
              >
                <Text style={styles.sourceArticleText} numberOfLines={1}>
                  {sourceArticleId
                    ? `⤷ ${sourceArticleTitle ?? "로딩 중..."} 의 답장`
                    : "⤷ 이 편지를 답장으로 설정"}
                </Text>
                <Text style={styles.sourceArticleGear}>⚙️</Text>
              </ScalePressable>
            }
            sourceArticleSlotText={
              sourceArticleId
                ? `⤷ ${sourceArticleTitle ?? "로딩 중..."} 의 답장 ⚙️`
                : "⤷ 이 편지를 답장으로 설정 ⚙️"
            }
            onSourceArticleSlotTap={() => setPickerVisible(true)}
          />
        </View>
        <View style={styles.editorFooter}>
          <Text style={styles.charCountText}>{charCount}자</Text>
        </View>
        </View>

        {keyboardVisible && Platform.OS !== "web" && selectionState.activeBlock !== "horizontalRule" && (
          <KeyboardToolbar
            selectionState={selectionState}
            onFormatPress={handleToolbarFormat}
            onBoldPress={handleToolbarBold}
            onItalicPress={handleToolbarItalic}
            onUnderlinePress={handleToolbarUnderline}
            onInsertDivider={handleInsertDivider}
            onShiftEnter={handleShiftEnter}
          />
        )}
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

      <BlockTypeSheet
        visible={blockTypeSheetVisible}
        activeBlock={selectionState.activeBlock}
        onClose={() => setBlockTypeSheetVisible(false)}
        onSelect={handleBlockTypeSelect}
      />
      </View>
    </>
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
  headerRight: {
    width: 22,
    height: 22,
  },
  sourceArticleRow: {
    flexDirection: "row",
    alignItems: "center",
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
  editorOuter: {
    flex: 1,
    alignItems: "center",
  },
  editorInner: {
    flex: 1,
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
