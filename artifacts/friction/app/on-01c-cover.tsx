import React, { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core";
import { Colors, ReaderTokens, Sizing, Spacing, Typography } from "@/constants/tokens";
import HeaderButton from "@/components/shared/HeaderButton";
import CoverPreview from "@/components/CoverPreview/CoverPreview";
import CoverEditor from "@/components/CoverEditor/CoverEditor";
import { resolveArticleCover } from "@/utils/articleCover";
import { setCoverPhotoUploadInProgress } from "@/lib/coverPhotoUploadState";
import {
  invalidateArticleLists,
  patchArticleInRecordCaches,
  stageArticleTransitionSnapshot,
  getProtectedArticleDetailSnapshot,
} from "@/lib/queryInvalidation";
import { createSerializedAsyncRunner, type SerializedAsyncRunner } from "@/lib/serializedAsyncRunner";
import { useGetArticle, useGetUser, useUpdateArticle } from "@workspace/api-client-react";
import type { ArticleCover } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/ToastContext";

const HEADER_HEIGHT = 56;

/**
 * Dedicated full-page cover editor (Task #2020). Replaces the old dimmed
 * bottom sheet that lived inline on the Closing screen (app/on-01c.tsx):
 * this page is always fully expanded, has no dim overlay, and no
 * drag-to-close/tap-outside-to-close behavior. The top half shows a
 * live-updating shrunk cover preview; the bottom half hosts the fixed edit
 * controls (font/text color/background color/photo) via <CoverEditor>.
 *
 * Cover ownership lives entirely here: on back, the pending debounced save is
 * flushed and the query cache is staged before navigating back, so the
 * Closing screen (which derives its displayed cover directly from the
 * article query cache) reflects the latest cover immediately.
 */
export default function CoverEditScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const articleQuery = useGetArticle(id ?? "");
  const article = id
    ? getProtectedArticleDetailSnapshot(queryClient, id, articleQuery.data)
    : undefined;
  const articleLoading = id ? articleQuery.isLoading && !article : false;

  const authorQuery = useGetUser(article?.authorId ?? "");
  const authorName = article?.authorId
    ? (authorQuery.data?.nickname ?? authorQuery.data?.email ?? undefined)
    : undefined;

  const updateArticle = useUpdateArticle();

  // Shrink the preview to fit inside the top-half area instead of letting it
  // stretch to full width (which can overflow into the controls area on
  // taller cover aspect ratios / shorter screens).
  const [previewAreaSize, setPreviewAreaSize] = useState<{ width: number; height: number } | null>(null);
  const previewSize = previewAreaSize
    ? (() => {
        const heightBoundWidth = previewAreaSize.height * ReaderTokens.aspectRatio;
        const width = Math.min(previewAreaSize.width, heightBoundWidth);
        return { width, height: width / ReaderTokens.aspectRatio };
      })()
    : { width: 0, height: 0 };

  // `cover` starts as `null` (not a default cover placeholder) so the page
  // never mounts CoverEditor/CoverPreview with a throwaway default value that
  // could then be saved over the article's real cover before the real value
  // arrives. If the article is already in the query cache at mount (the
  // common case when navigating here from the closing screen, which already
  // fetched it), the lazy initializer captures the real cover immediately.
  const [cover, setCover] = useState<ArticleCover | null>(() =>
    article ? resolveArticleCover(article.cover) : null,
  );
  const initializedRef = useRef(!!article);
  useEffect(() => {
    if (!article || initializedRef.current) return;
    initializedRef.current = true;
    setCover(resolveArticleCover(article.cover));
  }, [article]);

  const pendingCoverRef = useRef<ArticleCover | null>(null);
  const saveCoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coverSaveQueueRef = useRef<SerializedAsyncRunner>(createSerializedAsyncRunner());

  const persistCover = useCallback(
    (nextCover: ArticleCover) =>
      coverSaveQueueRef.current(async () => {
        if (!id) throw new Error("편지 정보를 찾을 수 없어요.");
        await updateArticle.mutateAsync({
          id,
          data: { cover: nextCover },
        });
        patchArticleInRecordCaches(queryClient, id, { cover: nextCover });
        stageArticleTransitionSnapshot(queryClient, id, { cover: nextCover }, article);
      }),
    [id, queryClient, updateArticle, article],
  );

  const flushCoverSave = useCallback(async () => {
    if (saveCoverTimerRef.current) {
      clearTimeout(saveCoverTimerRef.current);
      saveCoverTimerRef.current = null;
    }
    const pending = pendingCoverRef.current;
    if (!pending || !id) return;
    try {
      await persistCover(pending);
      if (pendingCoverRef.current === pending) {
        pendingCoverRef.current = null;
      }
    } catch (e: unknown) {
      console.warn("Failed to save cover:", e instanceof Error ? e.message : e);
      if (!pendingCoverRef.current) {
        pendingCoverRef.current = pending;
      }
      throw e;
    }
  }, [id, persistCover]);

  const handleCoverChange = useCallback(
    (next: ArticleCover) => {
      setCover(next);
      pendingCoverRef.current = next;
      if (!id) return;
      if (saveCoverTimerRef.current) clearTimeout(saveCoverTimerRef.current);
      saveCoverTimerRef.current = setTimeout(async () => {
        saveCoverTimerRef.current = null;
        const toSave = pendingCoverRef.current;
        if (!toSave) return;
        try {
          await persistCover(toSave);
          if (pendingCoverRef.current === toSave) {
            pendingCoverRef.current = null;
          }
        } catch (e: unknown) {
          console.warn("Failed to save cover:", e instanceof Error ? e.message : e);
          if (!pendingCoverRef.current) {
            pendingCoverRef.current = toSave;
          }
        }
      }, 500);
    },
    [id, persistCover],
  );

  const handlePhotoCoverCommit = useCallback(
    async (nextCover: ArticleCover) => {
      if (!id) throw new Error("편지 정보를 찾을 수 없어요.");
      if (saveCoverTimerRef.current) {
        clearTimeout(saveCoverTimerRef.current);
        saveCoverTimerRef.current = null;
      }
      const pending = pendingCoverRef.current;
      if (pending) {
        await persistCover(pending);
        if (pendingCoverRef.current === pending) {
          pendingCoverRef.current = null;
        }
      }
      await persistCover(nextCover);
      setCover(nextCover);
      pendingCoverRef.current = null;
    },
    [id, persistCover],
  );

  const isCoverUploadingRef = useRef(false);
  const handleCoverUploadStateChange = useCallback(
    (uploading: boolean) => {
      isCoverUploadingRef.current = uploading;
      if (id) setCoverPhotoUploadInProgress(id, uploading);
    },
    [id],
  );

  useEffect(() => {
    return () => {
      if (saveCoverTimerRef.current) clearTimeout(saveCoverTimerRef.current);
      if (id) setCoverPhotoUploadInProgress(id, false);
    };
  }, [id]);

  // ── 뒤로가기: 진행 중인 표지 저장을 마무리한 뒤에만 화면을 벗어난다. ──
  const isActionInProgressRef = useRef(false);
  const [isSavingOnExit, setIsSavingOnExit] = useState(false);
  const [shouldPreventRemoval, setShouldPreventRemoval] = useState(true);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const navigationCommittedRef = useRef(false);

  const navigateAfterRemovingGuard = useCallback((navigate: () => void) => {
    if (navigationCommittedRef.current) return;
    navigationCommittedRef.current = true;
    isActionInProgressRef.current = true;
    pendingNavigationRef.current = navigate;
    setShouldPreventRemoval(false);
  }, []);

  const handleBack = useCallback(async () => {
    if (isActionInProgressRef.current) return;
    if (isCoverUploadingRef.current) {
      showToast({ message: "표지 사진 작업이 끝난 뒤 이동할 수 있어요.", type: "info" });
      return;
    }
    isActionInProgressRef.current = true;
    setIsSavingOnExit(true);
    try {
      // Back navigation must finish the pending cover save before returning
      // to Closing, so Closing's derived `cover` reads the final value.
      await flushCoverSave();
    } catch {
      showToast({ message: "표지를 저장하지 못했어요. 다시 시도해주세요.", type: "error" });
      // Never trap the user behind a failed save — navigate back anyway.
    } finally {
      setIsSavingOnExit(false);
      void invalidateArticleLists(queryClient);
      navigateAfterRemovingGuard(() => router.back());
    }
  }, [flushCoverSave, navigateAfterRemovingGuard, queryClient, router, showToast]);

  const handlePreventedRemoval = useCallback(() => {
    if (isActionInProgressRef.current) return;
    handleBack();
  }, [handleBack]);

  usePreventRemove(shouldPreventRemoval, handlePreventedRemoval);

  useEffect(() => {
    if (shouldPreventRemoval || !pendingNavigationRef.current) return;
    const navigate = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    const timer = setTimeout(navigate, 0);
    return () => clearTimeout(timer);
  }, [shouldPreventRemoval]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack]);

  if (!id || articleLoading || cover === null) {
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: true }} />
        <View style={[styles.container, { paddingTop: topInset }]} />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !isSavingOnExit }} />
      <View style={[styles.container, { paddingTop: topInset }]}>
        <View style={styles.header}>
          <View style={styles.headerSide}>
            <HeaderButton
              variant="back"
              onPress={handleBack}
              disabled={isSavingOnExit}
              busy={isSavingOnExit}
              accessibilityLabel="마감 화면으로 돌아가기"
            />
          </View>
          <Text style={styles.headerTitle}>표지 편집</Text>
          <View style={[styles.headerSide, styles.headerSideRight]} />
        </View>

        <View style={styles.previewArea}>
          <View
            style={styles.previewMeasure}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setPreviewAreaSize((prev) =>
                prev && prev.width === width && prev.height === height ? prev : { width, height },
              );
            }}
          >
            {previewAreaSize ? (
              <View style={{ width: previewSize.width, height: previewSize.height }}>
                <CoverPreview cover={cover} title={article?.title ?? ""} author={authorName} borderRadius={2} />
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.controlsArea}>
          <CoverEditor
            cover={cover}
            onChange={handleCoverChange}
            articleId={id}
            onPhotoOperationStateChange={handleCoverUploadStateChange}
            onCommitPhotoCover={handlePhotoCoverCommit}
          />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  header: {
    height: HEADER_HEIGHT,
    minHeight: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
  },
  headerSide: {
    width: Sizing.headerButtonTouchSize,
    flexDirection: "row",
    alignItems: "center",
  },
  headerSideRight: {
    justifyContent: "flex-end",
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
  },
  previewArea: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: ReaderTokens.bodyBg,
  },
  previewMeasure: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  controlsArea: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc200,
  },
});
