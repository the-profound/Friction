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
import {
  markArticleCoverSaveCommitted,
  queueLatestArticleCoverSave,
  waitForLatestArticleCoverSave,
} from "@/lib/articleCoverSaveCoordinator";
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
    const resolved = resolveArticleCover(article.cover);
    latestCoverRef.current = resolved;
    setCover(resolved);
  }, [article]);

  const latestCoverRef = useRef<ArticleCover | null>(cover);
  const saveCoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueCoverSave = useCallback((nextCover: ArticleCover) => {
    if (!id) return;
    queueLatestArticleCoverSave(id, {
      value: nextCover,
      save: async () => {
        await updateArticle.mutateAsync({
          id,
          data: { cover: nextCover },
        });
      },
      onLatestSaved: () => {
        patchArticleInRecordCaches(queryClient, id, { cover: nextCover });
        stageArticleTransitionSnapshot(queryClient, id, { cover: nextCover }, article);
        void invalidateArticleLists(queryClient);
      },
      onLatestError: (error, retry) => {
        console.warn("Failed to save cover:", error instanceof Error ? error.message : error);
        showToast({
          message: "표지를 저장하지 못했어요.",
          type: "error",
          duration: 7000,
          action: {
            label: "다시 시도",
            onPress: retry,
          },
        });
      },
    });
  }, [article, id, queryClient, showToast, updateArticle]);

  const commitLatestCover = useCallback(() => {
    if (saveCoverTimerRef.current) {
      clearTimeout(saveCoverTimerRef.current);
      saveCoverTimerRef.current = null;
    }
    const latest = latestCoverRef.current;
    if (!latest || !id) return;
    patchArticleInRecordCaches(queryClient, id, { cover: latest });
    stageArticleTransitionSnapshot(queryClient, id, { cover: latest }, article);
    queueCoverSave(latest);
  }, [article, id, queryClient, queueCoverSave]);

  const handleCoverChange = useCallback(
    (next: ArticleCover) => {
      setCover(next);
      latestCoverRef.current = next;
      if (!id) return;
      if (saveCoverTimerRef.current) clearTimeout(saveCoverTimerRef.current);
      saveCoverTimerRef.current = setTimeout(() => {
        saveCoverTimerRef.current = null;
        commitLatestCover();
      }, 500);
    },
    [commitLatestCover, id],
  );

  const handlePhotoCoverCommit = useCallback(
    async (savedCover: ArticleCover) => {
      if (!id) throw new Error("편지 정보를 찾을 수 없어요.");
      // Verification already saved this exact cover with its inspected image
      // bytes. Reconcile the live preview and every article cache from that
      // server-owned value instead of issuing a second PATCH.
      setCover(savedCover);
      latestCoverRef.current = savedCover;
      markArticleCoverSaveCommitted(id, savedCover);
      patchArticleInRecordCaches(queryClient, id, { cover: savedCover });
      stageArticleTransitionSnapshot(queryClient, id, { cover: savedCover }, article);
    },
    [id, queryClient, article],
  );

  const preparePhotoCommit = useCallback(async () => {
    if (saveCoverTimerRef.current) {
      clearTimeout(saveCoverTimerRef.current);
      saveCoverTimerRef.current = null;
    }
    commitLatestCover();
    if (id) {
      const saved = await waitForLatestArticleCoverSave(id);
      if (!saved) {
        throw new Error("기존 표지를 저장한 뒤 사진을 적용해주세요.");
      }
    }
  }, [commitLatestCover, id]);

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

  // ── 뒤로가기: 최신 표지를 즉시 확정하고 물리 저장은 백그라운드에서 마무리한다. ──
  const isActionInProgressRef = useRef(false);
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

  const handleBack = useCallback(() => {
    if (isActionInProgressRef.current) return;
    if (isCoverUploadingRef.current) {
      showToast({ message: "표지 사진 작업이 끝난 뒤 이동할 수 있어요.", type: "info" });
      return;
    }
    isActionInProgressRef.current = true;
    // Commit the latest selection to cache and the coalescing persistence
    // boundary synchronously. Navigation never waits for debounce, an older
    // in-flight request, or slow network I/O.
    commitLatestCover();
    navigateAfterRemovingGuard(() => router.back());
  }, [commitLatestCover, navigateAfterRemovingGuard, router, showToast]);

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
      <Stack.Screen options={{ gestureEnabled: true }} />
      <View style={[styles.container, { paddingTop: topInset }]}>
        <View style={styles.header}>
          <View style={styles.headerSide}>
            <HeaderButton
              variant="back"
              onPress={handleBack}
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
            onPreparePhotoCommit={preparePhotoCommit}
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
