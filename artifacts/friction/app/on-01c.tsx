import React, { useState, useCallback, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  Platform,
  Animated as RNAnimated,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, ReaderTokens } from "@/constants/tokens";
import { bodyTypographyMetrics, computeBodyLayout } from "@/lib/bodyLayout";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import CoverPreview from "@/components/CoverPreview/CoverPreview";
import PreviewPager from "@/components/PreviewPager/PreviewPager";
import CoverEditor from "@/components/CoverEditor/CoverEditor";
import WebViewMarkdownReader from "@/components/WebViewMarkdownReader";
import { resolveArticleCover, getDefaultCover } from "@/utils/articleCover";
import { canStepBack } from "@/lib/articleStatusCycle";
import {
  createSerializedAsyncRunner,
  type SerializedAsyncRunner,
} from "@/lib/serializedAsyncRunner";
import WritingStateBar, {
  type WritingStageAction,
} from "@/components/WritingStateBar/WritingStateBar";
import HeaderButton from "@/components/shared/HeaderButton";
import { trackArticlePublished } from "@/lib/analytics";
import {
  useGetArticle,
  useGetUser,
  useUpdateArticle,
  useTransitionArticleStatus,
  useFinalizeArticle,
  TransitionArticleBodyTargetStatus,
  getGetArticleQueryKey,
  useGetSpace,
  getGetSpaceQueryKey,
  SpaceLetterVisibility,
  useCreateSpaceLetter,
  CreateSpaceLetterBodyLetterType,
  useUpdateSpaceLetterVisibility,
  listSpaceLetters,
  getListSpaceLettersQueryKey,
} from "@workspace/api-client-react";
import type { ArticleCover } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  invalidateArticleLists,
  invalidateArticleDetail,
  patchArticleInRecordCaches,
  stageArticleTransitionSnapshot,
  getProtectedArticleDetailSnapshot,
} from "@/lib/queryInvalidation";
import { useToast } from "@/contexts/ToastContext";

const WRITING_HEADER_HEIGHT = 68;

export default function ClosingScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { height: screenHeight } = useWindowDimensions();
  const { id, spaceId, spaceRoundId, letterType } = useLocalSearchParams<{
    id: string;
    spaceId?: string;
    spaceRoundId?: string;
    letterType?: string;
  }>();
  const articleQuery = useGetArticle(id ?? "");
  const article = id
    ? getProtectedArticleDetailSnapshot(queryClient, id, articleQuery.data)
    : undefined;
  const articleLoading = id ? articleQuery.isLoading && !article : false;

  // AsyncStorage 복구 — (tabs)/on.tsx에서 재개할 때 라우트에 spaceId가 없는 경우를 처리한다.
  // contextReady: false인 동안 내보내기를 차단해 복구 완료 전에 export가 실행되는 것을 방지한다.
  const [recoveredSpaceContext, setRecoveredSpaceContext] = useState<{
    spaceId: string;
    spaceRoundId?: string;
    letterType?: string;
  } | null>(null);
  const [contextReady, setContextReady] = useState(!!spaceId);
  useEffect(() => {
    if (spaceId) {
      setContextReady(true);
      return;
    }
    if (!id) {
      setContextReady(true);
      return;
    }
    // spaceId가 라우트에 없는 경우 — AsyncStorage에서 복구 시도
    void AsyncStorage.getItem(`space_context:${id}`).then((raw) => {
      if (raw) {
        try {
          setRecoveredSpaceContext(
            JSON.parse(raw) as { spaceId: string; spaceRoundId?: string; letterType?: string },
          );
        } catch {}
      }
      setContextReady(true);
    });
  }, [id, spaceId]);

  const effectiveSpaceId = spaceId ?? recoveredSpaceContext?.spaceId;
  const effectiveSpaceRoundId = spaceRoundId ?? recoveredSpaceContext?.spaceRoundId;
  const effectiveLetterType = letterType ?? recoveredSpaceContext?.letterType;

  const spaceQuery = useGetSpace(effectiveSpaceId ?? "", {
    query: {
      queryKey: getGetSpaceQueryKey(effectiveSpaceId ?? ""),
      enabled: !!effectiveSpaceId,
    },
  });
  const isAnonymous = spaceQuery.data?.isAnonymous ?? false;

  const authorQuery = useGetUser(article?.authorId ?? "");
  const authorName = article?.authorId
    ? (authorQuery.data?.nickname ?? authorQuery.data?.email ?? undefined)
    : undefined;

  // Skip mount-time invalidate when cache is fresh (≤30s) — avoids a wasted
  // refetch on every 분할→마감 navigation. Cold entries still refresh.
  useEffect(() => {
    if (!id) return;
    const cached = queryClient.getQueryState(getGetArticleQueryKey(id));
    const fresh = !!cached && Date.now() - cached.dataUpdatedAt < 30_000;
    if (!fresh) {
      invalidateArticleDetail(queryClient, id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateArticle = useUpdateArticle();
  const transitionStatus = useTransitionArticleStatus();
  const finalizeArticle = useFinalizeArticle();
  const createSpaceLetterMutation = useCreateSpaceLetter();
  const updateSpaceLetterVisibilityMutation = useUpdateSpaceLetterVisibility();

  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const [previewPage, setPreviewPage] = useState(0);
  const [cover, setCover] = useState<ArticleCover>(getDefaultCover());
  const [coverEditorVisible, setCoverEditorVisible] = useState(false);
  const coverSheetTranslateYAnim = useRef(new RNAnimated.Value(screenHeight)).current;
  const [coverFrame, setCoverFrame] = useState({ y: 0, height: 0 });
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCoverUploading, setIsCoverUploading] = useState(false);
  const [visibility, setVisibility] = useState<SpaceLetterVisibility>(
    SpaceLetterVisibility.PUBLIC,
  );
  const coverUploadInProgressRef = useRef(false);
  const isActionInProgressRef = useRef(false);
  const exportPromptOpenRef = useRef(false);
  const [shouldPreventRemoval, setShouldPreventRemoval] = useState(true);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const navigationCommittedRef = useRef(false);
  const storedLayoutWidth = (article?.layoutWidth != null && article.layoutWidth > 0) ? article.layoutWidth : null;
  const exportedArticleIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const saveCoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coverSaveQueueRef = useRef<SerializedAsyncRunner>(
    createSerializedAsyncRunner(),
  );
  // Step 3(E) — pages 변경 여부 추적: 분할 화면에서 이미 저장된 pages를 다시
  // 보내지 않도록, 서버에서 받은 초기 pages 스냅샷을 저장해 둔다. on-01c는
  // 현재 pages를 편집하지 않으므로 거의 항상 변경되지 않은 상태로 남는다.
  const initialPagesRef = useRef<string[] | null>(null);

  const navigateAfterRemovingGuard = useCallback((navigate: () => void) => {
    if (navigationCommittedRef.current) return;
    navigationCommittedRef.current = true;
    isActionInProgressRef.current = true;
    pendingNavigationRef.current = navigate;
    setShouldPreventRemoval(false);
  }, []);

  useEffect(() => {
    if (!article) return;
    // pages는 이 화면에서 편집하지 않으므로 항상 서버 데이터로 동기화
    const incoming = article.pages || [];
    setPages((prev) => {
      // 실제로 변경된 경우에만 previewPage 초기화 + 상태 업데이트
      if (JSON.stringify(prev) === JSON.stringify(incoming)) return prev;
      setPreviewPage(0);
      return incoming;
    });
    // C1 fix: removed isDataFresh gate — initialize on first data regardless of
    // cache age. initializedRef ensures title/cover are only set once (user edits
    // these fields, so we must not overwrite on background refetch).
    // initialPagesRef also snapshotted on first data to keep diff detection accurate.
    if (initialPagesRef.current === null) {
      initialPagesRef.current = incoming;
    }
    if (!initializedRef.current) {
      initializedRef.current = true;
      setTitle(article.title || "");
      setCover(resolveArticleCover(article.cover));
      console.log("[on-01 init] on-01c cached?=true dirty?=false title injected:", (article.title || "").slice(0, 30));
    }
  }, [article]);

  // 익명 공간이면 공개 설정을 RECIPIENT_ONLY로 고정한다.
  useEffect(() => {
    if (isAnonymous) {
      setVisibility(SpaceLetterVisibility.RECIPIENT_ONLY);
    }
  }, [isAnonymous]);

  const pendingCoverRef = useRef<ArticleCover | null>(null);
  // 마감→분할 복귀 시 전달할 콘텐츠 페이지 인덱스를 렌더마다 갱신한다.
  const returnPageIdxRef = useRef(0);
  // 마감 화면은 페이지 단위 스와이프만 지원하므로 블록 인덱스는 항상 0(첫 블록)으로 고정.
  // 향후 미리보기 내 블록 탭 추적이 구현되면 이 ref를 갱신한다.
  const returnBlockIdxRef = useRef(0);

  const persistCover = useCallback(
    (nextCover: ArticleCover) =>
      coverSaveQueueRef.current(async () => {
        if (!id) throw new Error("편지 정보를 찾을 수 없어요.");
        await updateArticle.mutateAsync({
          id,
          data: { cover: nextCover },
        });
        patchArticleInRecordCaches(queryClient, id, { cover: nextCover });
      }),
    [id, queryClient, updateArticle],
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

  useEffect(() => {
    return () => {
      if (saveCoverTimerRef.current) clearTimeout(saveCoverTimerRef.current);
    };
  }, []);

  const handleExport = useCallback(() => {
    if (isActionInProgressRef.current || exportPromptOpenRef.current) return;
    // AsyncStorage 복구가 완료될 때까지 내보내기를 차단한다.
    // 복구 전에 export를 허용하면 effectiveSpaceId가 undefined인 상태로 finalizeArticle이
    // 실행되어 SpaceLetter 생성/연결이 누락될 수 있다.
    if (!contextReady) return;
    // 공간이 있는 경우 isAnonymous 로딩 중에 내보내기를 허용하면
    // PUBLIC 토글을 선택한 채로 익명 공간에 발신해 PATCH 403이 발생한다.
    if (effectiveSpaceId && spaceQuery.isLoading) return;
    if (coverUploadInProgressRef.current) {
      showToast({ message: "표지 사진 업로드가 끝난 뒤 내보낼 수 있어요.", type: "info" });
      return;
    }
    if (!title.trim()) {
      showToast({ message: "제목을 입력해주세요.", type: "info" });
      return;
    }
    if (pages.length === 0) {
      showToast({ message: "페이지가 없어요.", type: "info" });
      return;
    }
    exportPromptOpenRef.current = true;
    setConfirmVisible(true);
  }, [contextReady, effectiveSpaceId, spaceQuery.isLoading, title, pages, showToast]);

  const finalizeExport = useCallback(
    async () => {
      const articleId = exportedArticleIdRef.current;
      if (!articleId) return;
      const updated = await finalizeArticle.mutateAsync({
        id: articleId,
        data: {},
      });
      queryClient.setQueryData(getGetArticleQueryKey(articleId), updated);
      trackArticlePublished({
        articleId,
        charCount: pages.reduce((sum, p) => sum + p.length, 0),
        pageCount: pages.length,
      });
      invalidateArticleLists(queryClient);

      // 공간 편지 공개 설정 적용 — effectiveSpaceId가 있을 때 신뢰할 수 있는 방식으로 처리한다.
      // 1) 이미 존재하는 편지 → 실명 공간만 PATCH (익명 공간은 서버가 RECIPIENT_ONLY 강제, PATCH 시 403)
      // 2) 아직 없는 편지 → createSpaceLetter POST body에 visibility 포함하여 생성
      // 실패해도 로컬 편지는 이미 완성(LETTER)됐으므로 내보내기 자체는 막지 않는다.
      if (effectiveSpaceId) {
        try {
          // 익명 공간은 항상 RECIPIENT_ONLY로 제출 (토글 상태와 무관하게 서버 규칙 준수)
          const resolvedVisibility = isAnonymous
            ? SpaceLetterVisibility.RECIPIENT_ONLY
            : visibility;

          const validLetterTypes = Object.values(CreateSpaceLetterBodyLetterType);
          const resolvedLetterType = validLetterTypes.includes(
            effectiveLetterType as CreateSpaceLetterBodyLetterType,
          )
            ? (effectiveLetterType as CreateSpaceLetterBodyLetterType)
            : CreateSpaceLetterBodyLetterType.CENTER;

          const letters = await listSpaceLetters(effectiveSpaceId);
          // letterType + spaceRoundId + sourceArticleId로 정확히 매칭하여
          // 같은 공간에 같은 articleId를 사용하는 다른 역할의 편지를 건드리지 않는다.
          const existing = letters.find(
            (l) =>
              l.sourceArticleId === articleId &&
              l.letterType === resolvedLetterType &&
              (effectiveSpaceRoundId ? (l.spaceRoundId ?? null) === effectiveSpaceRoundId : true),
          );
          if (existing) {
            // 익명 공간은 서버가 이미 RECIPIENT_ONLY를 유지하므로 PATCH 불필요
            if (!isAnonymous) {
              await updateSpaceLetterVisibilityMutation.mutateAsync({
                id: effectiveSpaceId,
                letterId: existing.id,
                data: { visibility: resolvedVisibility },
              });
            }
          } else {
            await createSpaceLetterMutation.mutateAsync({
              id: effectiveSpaceId,
              data: {
                authorId: updated.authorId,
                sourceArticleId: articleId,
                letterType: resolvedLetterType,
                spaceRoundId: effectiveSpaceRoundId ?? null,
                visibility: resolvedVisibility,
              },
            });
          }
          queryClient.invalidateQueries({
            queryKey: getListSpaceLettersQueryKey(effectiveSpaceId),
          });
          // 성공 시에만 AsyncStorage 정리 (실패 시 컨텍스트를 유지해 재시도 가능하게)
          try { await AsyncStorage.removeItem(`space_context:${articleId}`); } catch {}
          navigateAfterRemovingGuard(() => {
            router.replace({ pathname: "/of-space-start", params: { id: effectiveSpaceId } });
          });
          return;
        } catch (e) {
          console.warn("[on-01c] 공간 편지 공개 설정 실패:", e);
          // AsyncStorage는 삭제하지 않는다 — 공간 화면에서 편지를 선택해 직접 연결할 수 있음
          showToast({
            message: "편지는 완성됐지만 공간 등록에 실패했어요. 공간 화면에서 직접 선택해주세요.",
            type: "error",
            duration: 7000,
          });
        }
        navigateAfterRemovingGuard(() => {
          router.replace({ pathname: "/of-space-start", params: { id: effectiveSpaceId } });
        });
      } else {
        navigateAfterRemovingGuard(() => {
          router.replace({ pathname: "/(tabs)/on", params: { tab: "my_article" } });
        });
      }
    },
    [
      pages, finalizeArticle, navigateAfterRemovingGuard, queryClient, router, showToast,
      effectiveSpaceId, effectiveSpaceRoundId, effectiveLetterType, visibility, isAnonymous,
      createSpaceLetterMutation, updateSpaceLetterVisibilityMutation,
    ],
  );

  const handleConfirmExport = useCallback(async () => {
    exportPromptOpenRef.current = false;
    setConfirmVisible(false);
    if (coverUploadInProgressRef.current) return;
    if (isActionInProgressRef.current) return;
    isActionInProgressRef.current = true;
    if (saveCoverTimerRef.current) {
      clearTimeout(saveCoverTimerRef.current);
      saveCoverTimerRef.current = null;
    }
    const coverToSave = pendingCoverRef.current ?? cover;
    setIsExporting(true);
    try {
      // An already-started debounced cover save must finish before the final
      // cover write. No cover mutation may bypass this queue before finalize.
      await persistCover(coverToSave);
      if (pendingCoverRef.current === coverToSave) {
        pendingCoverRef.current = null;
      }

      // Step 3(E) — PATCH 페이로드 최소화:
      // pages는 분할 화면(on-01b)에서 이미 저장됐고 이 화면에서는 편집되지 않으므로,
      // 초기 스냅샷과 다를 때만 포함한다 (실질적으로 거의 항상 생략된다).
      // title은 blur 전 입력까지 확정하고, cover는 위 직렬화 큐에서 별도로 확정한다.
      const patchData: { title?: string; pages?: string[] } = {
        title,
      };
      const initialPages = initialPagesRef.current;
      const pagesChanged =
        initialPages === null || JSON.stringify(initialPages) !== JSON.stringify(pages);
      if (pagesChanged) {
        patchData.pages = pages;
      }
      await updateArticle.mutateAsync({
        id: id!,
        data: patchData,
      });
      exportedArticleIdRef.current = id!;
      await finalizeExport();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "내보내기에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    } finally {
      setIsExporting(false);
      // A committed route owns the action lock through deferred dispatch and
      // unmount, so a back event cannot replace the export destination.
      if (!navigationCommittedRef.current) {
        isActionInProgressRef.current = false;
      }
    }
  }, [id, title, pages, cover, persistCover, updateArticle, finalizeExport]);

  const handleCancelExport = useCallback(() => {
    exportPromptOpenRef.current = false;
    setConfirmVisible(false);
  }, []);

  const handleCoverUploadStateChange = useCallback((uploading: boolean) => {
    coverUploadInProgressRef.current = uploading;
    setIsCoverUploading(uploading);
  }, []);

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

  const handleBack = useCallback(() => {
    if (coverUploadInProgressRef.current) {
      showToast({ message: "표지 사진 작업이 끝난 뒤 이동할 수 있어요.", type: "info" });
      return;
    }
    if (isActionInProgressRef.current) return;
    isActionInProgressRef.current = true;
    const coverToSave = pendingCoverRef.current ?? cover;
    if (id) {
      stageArticleTransitionSnapshot(queryClient, id, {
        title,
        cover: coverToSave,
      }, article);
    }

    // The local article snapshot is the visible source of truth. The queued
    // title/cover writes continue after the route has changed.
    void Promise.allSettled([flushCoverSave()]).then((results) => {
      if (results.some((result) => result.status === "rejected")) {
        showToast({ message: "최신 내용을 저장하지 못했어요. 다시 시도해주세요.", type: "error" });
      }
      void invalidateArticleLists(queryClient);
    });

    navigateAfterRemovingGuard(() => router.replace("/(tabs)/on"));
  }, [
    cover,
    flushCoverSave,
    id,
    navigateAfterRemovingGuard,
    queryClient,
    router,
    showToast,
    title,
  ]);

  const handleStepBack = useCallback(() => {
    if (coverUploadInProgressRef.current) return;
    if (isActionInProgressRef.current) return;
    isActionInProgressRef.current = true;
    const result = canStepBack("CLOSING");
    if (!result.allowed) {
      isActionInProgressRef.current = false;
      return;
    }
    if (!id) {
      isActionInProgressRef.current = false;
      return;
    }
    const coverToSave = pendingCoverRef.current ?? cover;
    stageArticleTransitionSnapshot(queryClient, id, {
      title,
      cover: coverToSave,
      status: "DIVIDING",
    }, article);

    // Navigate directly to the integrated writing/dividing screen. Save and
    // status transition are deliberately detached from the route change.
    const completeStepBackTransition = () => {
      void Promise.allSettled([flushCoverSave()]).then((results) => {
        if (results.some((result) => result.status === "rejected")) {
          showToast({ message: "최신 내용을 모두 저장하지 못했어요. 다시 시도해주세요.", type: "error" });
        }
        return transitionStatus.mutateAsync({
          id,
          data: { targetStatus: TransitionArticleBodyTargetStatus.DIVIDING },
        });
      }).then(
        () => {
          void invalidateArticleLists(queryClient);
        },
        () => {
          // Keep the optimistic detail snapshot visible so the destination
          // screen is not replaced by a stale CLOSING response.
          showToast({
            message: "분할 단계로 전환하지 못했어요. 다시 시도해주세요.",
            type: "error",
            duration: 7000,
            action: {
              label: "다시 시도",
              onPress: completeStepBackTransition,
            },
          });
          void invalidateArticleLists(queryClient);
        },
      );
    };
    completeStepBackTransition();

    const returnPageIdx = returnPageIdxRef.current;
    const returnBlockIdx = returnBlockIdxRef.current;
    navigateAfterRemovingGuard(() => router.replace({
      pathname: "/on-01a",
      params: {
        id,
        mode: "dividing",
        returnPage: String(returnPageIdx),
        returnBlock: String(returnBlockIdx),
      },
    }));
  }, [
    cover,
    flushCoverSave,
    id,
    navigateAfterRemovingGuard,
    queryClient,
    router,
    showToast,
    title,
    transitionStatus,
  ]);

  const stageMenuBusy = isExporting || isCoverUploading;
  const stageMenuActions: WritingStageAction[] = [
    {
      label: "검토 단계로",
      onPress: handleStepBack,
      disabled: stageMenuBusy,
      busy: false,
    },
    {
      label: "표지 편집",
      onPress: () => {
        setPreviewPage(0);
        setCoverEditorVisible(true);
      },
      disabled: stageMenuBusy,
      busy: false,
    },
    {
      label: "내보내기",
      onPress: handleExport,
      disabled: stageMenuBusy || exportPromptOpenRef.current,
      busy: isExporting,
    },
  ];

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

  const hasCoverPage = true;
  const totalVirtualPages = pages.length > 0
    ? (hasCoverPage ? pages.length + 1 : pages.length)
    : 0;

  const clampedPreviewPage = totalVirtualPages > 0
    ? Math.min(previewPage, totalVirtualPages - 1)
    : 0;
  const isCoverPage = hasCoverPage && clampedPreviewPage === 0;
  const contentPageIndex = hasCoverPage ? clampedPreviewPage - 1 : clampedPreviewPage;
  // 렌더마다 최신 복귀 페이지 인덱스를 ref에 반영한다.
  returnPageIdxRef.current = isCoverPage ? 0 : Math.max(0, contentPageIndex);

  const handleCoverFrameLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    setCoverFrame((current) =>
      current.y === y && current.height === height ? current : { y, height },
    );
  };
  const coverRestCenter =
    topInset + WRITING_HEADER_HEIGHT + coverFrame.y + coverFrame.height / 2;
  const coverAvailableTop = topInset + WRITING_HEADER_HEIGHT + 8;
  const midSheetTop = screenHeight * (1 - 0.58);
  const getCoverFit = (sheetTop: number) => {
    const availableBottom = sheetTop - 12;
    const availableHeight = Math.max(0, availableBottom - coverAvailableTop);
    const scale =
      coverFrame.height > 0 ? Math.min(1, availableHeight / coverFrame.height) : 1;
    const center =
      availableHeight > 0
        ? (coverAvailableTop + availableBottom) / 2
        : coverAvailableTop;
    return {
      scale,
      translateY: coverFrame.height > 0 ? center - coverRestCenter : 0,
    };
  };
  const midCoverFit = getCoverFit(midSheetTop);
  const coverPreviewAnimStyle = {
    transform: [
      {
        translateY: coverSheetTranslateYAnim.interpolate({
          inputRange: [midSheetTop, screenHeight],
          outputRange: [midCoverFit.translateY, 0],
          extrapolate: "clamp",
        }),
      },
      {
        scale: coverSheetTranslateYAnim.interpolate({
          inputRange: [midSheetTop, screenHeight],
          outputRange: [midCoverFit.scale, 1],
          extrapolate: "clamp",
        }),
      },
    ],
  };

  if (!id || articleLoading) {
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: true }} />
        <View style={[styles.container, { paddingTop: topInset }]}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.zinc400} />
          </View>
        </View>
      </>
    );
  }

  if (!article) {
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: true }} />
        <View style={[styles.container, { paddingTop: topInset }]}>
          <View style={styles.loadingContainer}>
            <Feather name="alert-circle" size={30} color={Colors.zinc500} />
            <Text style={styles.loadErrorTitle}>글을 열지 못했어요</Text>
            <Text style={styles.loadErrorDescription}>
              잠시 후 다시 시도하거나 이전 화면으로 돌아가세요.
            </Text>
            <View style={styles.loadErrorActions}>
              <ScalePressable
                style={styles.loadErrorButton}
                contentStyle={styles.loadErrorButtonContent}
                onPress={() => articleQuery.refetch()}
                accessibilityRole="button"
                accessibilityLabel="글 다시 불러오기"
              >
                <Text style={styles.loadErrorButtonText}>다시 시도</Text>
              </ScalePressable>
              <ScalePressable
                style={styles.loadErrorButton}
                contentStyle={styles.loadErrorButtonContent}
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="이전 화면으로 돌아가기"
              >
                <Text style={styles.loadErrorButtonText}>이전 화면</Text>
              </ScalePressable>
            </View>
          </View>
        </View>
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
            disabled={stageMenuBusy}
            accessibilityLabel="기록 목록으로 돌아가기"
            busy={isExporting}
          />
        </View>
        <View style={styles.headerSideRight}>
          <WritingStateBar
            current="CLOSING"
            actions={stageMenuActions}
            disabled={stageMenuBusy}
            busy={stageMenuBusy}
          />
        </View>
      </View>

      <View style={styles.previewArea}>
        <RNAnimated.View
          style={[styles.previewInner, coverPreviewAnimStyle]}
          onLayout={handleCoverFrameLayout}
          renderToHardwareTextureAndroid={coverEditorVisible}
          needsOffscreenAlphaCompositing={coverEditorVisible}
        >
          {totalVirtualPages === 0 ? (
              <View style={styles.emptyContainer}>
                <Feather name="eye" size={36} color={Colors.zinc300} />
                <Text style={styles.emptyTitle}>미리보기할 내용이 없어요</Text>
              </View>
          ) : (
            <PreviewPager
              pageCount={totalVirtualPages}
              pageIndex={clampedPreviewPage}
              onPageChange={setPreviewPage}
              renderPage={(pageIndex, dimensions) => {
                if (pageIndex === 0) {
                  return (
                    <View style={styles.coverPreviewWrapper}>
                      <CoverPreview cover={cover} title={title} author={authorName} borderRadius={2} />
                    </View>
                  );
                }
                const markdown = pages[pageIndex - 1] ?? "";
                if (storedLayoutWidth !== null) {
                  const storedBody = computeBodyLayout(storedLayoutWidth);
                  return (
                    <View style={styles.previewCard}>
                      <View style={styles.scaledBodyViewport}>
                        <View style={{
                          width: storedLayoutWidth,
                          height: storedLayoutWidth / ReaderTokens.aspectRatio,
                          transform: [{ scale: Math.min(dimensions.width / storedLayoutWidth, 1.0) }],
                          alignItems: "center",
                          justifyContent: "center",
                        }}>
                          <View style={{
                            width: storedBody.pageWidth,
                            flex: 1,
                            paddingHorizontal: storedBody.paddingX,
                            paddingTop: storedBody.paddingY,
                            paddingBottom: storedBody.paddingY + insets.bottom + storedBody.titleBarHeight,
                          }}>
                            <View style={{ width: storedBody.textColumnWidth, flex: 1 }}>
                              <WebViewMarkdownReader
                                markdown={markdown}
                                typography={bodyTypographyMetrics(storedBody)}
                              />
                            </View>
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                }
                if (dimensions.width > 0) {
                  const fallbackBody = computeBodyLayout(dimensions.width);
                  return (
                    <View style={styles.previewCard}>
                      <View style={{
                        width: fallbackBody.pageWidth,
                        flex: 1,
                        paddingHorizontal: fallbackBody.paddingX,
                        paddingTop: fallbackBody.paddingY,
                        paddingBottom: fallbackBody.paddingY + insets.bottom + fallbackBody.titleBarHeight,
                        alignSelf: "center",
                      }}>
                        <View style={{ width: fallbackBody.textColumnWidth, flex: 1 }}>
                          <WebViewMarkdownReader
                            markdown={markdown}
                            typography={bodyTypographyMetrics(fallbackBody)}
                          />
                        </View>
                      </View>
                    </View>
                  );
                }
                return null;
              }}
            />
          )}
        </RNAnimated.View>
      </View>

      {totalVirtualPages > 1 && (
        <View style={[styles.pageNav, { paddingBottom: bottomInset + 16 }]}>
          <Text style={styles.pageNavText}>
            {isCoverPage ? "표지" : `${Math.max(0, contentPageIndex) + 1} / ${pages.length}`}
          </Text>
        </View>
      )}

      <CoverEditor
        visible={coverEditorVisible}
        onClose={() => setCoverEditorVisible(false)}
        cover={cover}
        onChange={handleCoverChange}
        title={title}
        author={authorName}
        articleId={id}
        onPhotoOperationStateChange={handleCoverUploadStateChange}
        onCommitPhotoCover={handlePhotoCoverCommit}
        sheetTranslateYAnim={coverSheetTranslateYAnim}
      />

      <ConfirmModal
        visible={confirmVisible}
        title="편지로 내보내기"
        description="내보내면 더 이상 수정할 수 없어요. 진행할까요?"
        confirmLabel="내보내기"
        cancelLabel="취소"
        destructive
        onConfirm={handleConfirmExport}
        onCancel={handleCancelExport}
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
  loadErrorTitle: {
    marginTop: 16,
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc800,
  },
  loadErrorDescription: {
    marginTop: 8,
    ...Typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.zinc500,
    textAlign: "center",
  },
  loadErrorActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 20,
  },
  loadErrorButton: {
    width: 104,
    height: 40,
    flexGrow: 0,
    flexShrink: 0,
  },
  loadErrorButtonContent: {
    width: 104,
    height: 40,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: Colors.zinc100,
  },
  loadErrorButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc700,
  },
  header: {
    height: WRITING_HEADER_HEIGHT,
    minHeight: WRITING_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
    backgroundColor: Colors.white,
  },
  headerSide: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  headerSideRight: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  previewArea: {
    flex: 1,
    overflow: "hidden",
  },
  previewInner: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 16,
    paddingBottom: 16,
    justifyContent: "center",
    backgroundColor: ReaderTokens.bodyBg,
  },
  coverPreviewWrapper: {
    borderRadius: 2,
    width: "100%",
    height: "100%",
  },
  previewCard: {
    borderRadius: 2,
    flex: 1,
    backgroundColor: ReaderTokens.bodyBg,
    overflow: "hidden",
  },
  scaledBodyViewport: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  pageNavText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc600,
  },
});
