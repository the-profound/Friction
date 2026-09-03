import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import {
  useListUserSpaceLetters,
  useUpdateSpaceLetterVisibility,
  SpaceLetterVisibility,
  getListUserSpaceLettersQueryKey,
  type Article,
  type SpaceLetter,
} from "@workspace/api-client-react";
import CardSelectOverlay, {
  type ChainArticleMeta,
  type OriginLayout,
} from "@/components/CardSelectOverlay/CardSelectOverlay";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { useAncestorChain } from "@/hooks/useAncestorChain";
import { useToast } from "@/contexts/ToastContext";
import { invalidateArticleLists } from "@/lib/queryInvalidation";

export interface LetterOverlayMeta {
  collectionName?: string | null;
  collectionId?: string | null;
  date?: string | null;
}

export interface OpenLetterOverlayOptions {
  meta?: LetterOverlayMeta;
  /**
   * If provided, the overlay origin is measured from this view ref.
   * Pass null / omit to open from the screen centre.
   */
  measureRef?: {
    measureInWindow: (
      cb: (x: number, y: number, w: number, h: number) => void,
    ) => void;
  } | null;
  /**
   * Fallback origin used when measureRef is absent.
   * Has no effect when measureRef is set.
   */
  fallbackOrigin?: OriginLayout;
  /** Prevents the info bar from linking back to the current collection. */
  currentCollectionId?: string | null;
  /** Prevents the info bar from linking back to the current author. */
  currentAuthorId?: string | null;
}

export interface UseLetterSelectionOverlayReturn {
  /** True while the overlay is open. Use to disable FlatList scrolling. */
  isOverlayActive: boolean;
  /**
   * True for the article whose source card should be visually hidden
   * (opacity 0) while the overlay animates to/from it.
   */
  isSourceHidden: (articleId: string) => boolean;
  /** The id of the currently-selected article, or null when no overlay is open. */
  selectedArticleId: string | null;
  openLetterOverlay: (article: Article, options?: OpenLetterOverlayOptions) => void;
  /** Programmatically close the overlay (e.g. when the filter kind/view changes). */
  closeOverlay: () => void;
  /**
   * Renders CardSelectOverlay + visibility-change ConfirmModal.
   * Include once in the screen's JSX.
   *
   * The visibility toggle button appears automatically when the selected
   * article belongs to the current user (authorId === userId) and has a
   * corresponding SpaceLetter entry.  No caller configuration required.
   */
  renderLetterOverlay: () => React.ReactNode;
  /**
   * Map of sourceArticleId → SpaceLetter for the current user's space letters.
   * Exposed so screens can show a visibility badge on individual cards (e.g. 기록 탭).
   */
  spaceLetterByArticleId: ReadonlyMap<string, SpaceLetter>;
}

interface HookOptions {
  /**
   * Called synchronously before the hook navigates the user to the reader
   * (e.g. cancel scroll-position restoration before leaving the screen).
   */
  onBeforeRead?: () => void;
}

/**
 * Shared "편지 선택 오버레이" hook.
 *
 * Every screen that taps a letter uses this hook.  The caller decides when
 * to call openLetterOverlay — for all letters (own and others) on all screens.
 *
 * Visibility toggle button is shown automatically: it appears only when the
 * selected letter's authorId matches userId (the current logged-in user).
 */
export function useLetterSelectionOverlay(
  userId: string | null,
  options?: HookOptions,
): UseLetterSelectionOverlayReturn {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Keep the callback ref fresh without listing it as a useCallback dep.
  const onBeforeReadRef = useRef(options?.onBeforeRead);
  onBeforeReadRef.current = options?.onBeforeRead;

  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<OriginLayout | null>(null);
  const [isSelectedSourceHidden, setIsSelectedSourceHidden] = useState(false);
  const [selectedMeta, setSelectedMeta] = useState<LetterOverlayMeta>({});
  const [overlayNavOptions, setOverlayNavOptions] = useState<{
    currentCollectionId?: string | null;
    currentAuthorId?: string | null;
  }>({});

  // Visibility toggle state
  const [visibilityConfirmTarget, setVisibilityConfirmTarget] = useState<{
    /** All non-anonymous space_letters for the article — each will be updated. */
    spaceLetters: Array<{ spaceId: string; spaceLetterId: string }>;
    newVisibility: "PUBLIC" | "RECIPIENT_ONLY";
  } | null>(null);
  const [isChangingVisibility, setIsChangingVisibility] = useState(false);

  // Space letters for the current user — used to show visibility badge and toggle.
  const spaceLettersQuery = useListUserSpaceLetters(userId ?? "", {
    query: { enabled: Boolean(userId) },
  });
  const updateVisibility = useUpdateSpaceLetterVisibility();

  const spaceLetterByArticleId = useMemo<ReadonlyMap<string, SpaceLetter>>(() => {
    const map = new Map<string, SpaceLetter>();
    for (const sl of (spaceLettersQuery.data ?? []) as SpaceLetter[]) {
      if (!sl.sourceArticleId) continue;
      const existing = map.get(sl.sourceArticleId);
      // PUBLIC wins: prefer the PUBLIC entry so the badge and toggle button
      // reflect the most-visible state when one article has multiple space_letters.
      if (!existing || sl.visibility === SpaceLetterVisibility.PUBLIC) {
        map.set(sl.sourceArticleId, sl);
      }
    }
    return map;
  }, [spaceLettersQuery.data]);

  const ancestorChain = useAncestorChain(
    selectedArticle?.sourceArticleId ?? null,
    queryClient,
  );

  const { chainArticles, chainMetas, chainInitialIndex } = useMemo(() => {
    if (!selectedArticle) {
      return {
        chainArticles: [] as (Article | null)[],
        chainMetas: [] as ChainArticleMeta[],
        chainInitialIndex: 0,
      };
    }

    const artList: (Article | null)[] = [];
    const metaList: ChainArticleMeta[] = [];

    for (const slot of ancestorChain) {
      artList.push(slot.article);
      metaList.push(
        slot.article
          ? {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              authorName: (slot.article as any).authorNickname ?? null,
              authorId: slot.article.authorId ?? null,
              collectionName: slot.article.collectionName ?? null,
              collectionId: slot.article.collectionId ?? null,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              date: (slot.article as any).letterAt ?? null,
            }
          : {},
      );
    }

    const initIdx = artList.length;
    artList.push(selectedArticle);
    metaList.push({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      authorName: (selectedArticle as any).authorNickname ?? null,
      authorId: selectedArticle.authorId ?? null,
      collectionName: selectedMeta.collectionName ?? null,
      collectionId: selectedMeta.collectionId ?? null,
      date: selectedMeta.date ?? null,
    });

    return { chainArticles: artList, chainMetas: metaList, chainInitialIndex: initIdx };
  }, [selectedArticle, ancestorChain, selectedMeta]);

  const closeOverlay = useCallback(() => {
    setIsSelectedSourceHidden(false);
    setSelectedArticle(null);
    setSelectedOrigin(null);
    setSelectedMeta({});
    setOverlayNavOptions({});
  }, []);

  const handleOverlayRead = useCallback(
    (chainIdx: number) => {
      const article = chainArticles[chainIdx];
      if (!article) return;
      onBeforeReadRef.current?.();
      setSelectedArticle(null);
      setSelectedOrigin(null);
      setSelectedMeta({});
      setOverlayNavOptions({});
      router.push({
        pathname: "/read" as never,
        params: { articleId: article.id, mode: "re_read" },
      });
    },
    [chainArticles, router],
  );

  const openLetterOverlay = useCallback(
    (article: Article, openOptions?: OpenLetterOverlayOptions) => {
      const meta = openOptions?.meta ?? {};
      setSelectedMeta(meta);
      setIsSelectedSourceHidden(false);
      setOverlayNavOptions({
        currentCollectionId: openOptions?.currentCollectionId,
        currentAuthorId: openOptions?.currentAuthorId,
      });

      if (openOptions?.measureRef) {
        openOptions.measureRef.measureInWindow((x, y, width, height) => {
          setSelectedOrigin({ x, y, width, height });
          setSelectedArticle(article);
        });
      } else {
        setSelectedOrigin(openOptions?.fallbackOrigin ?? null);
        setSelectedArticle(article);
      }
    },
    [],
  );

  const handleVisibilityToggle = useCallback(
    (articleId: string) => {
      // Gather every non-anonymous space_letter for this article.
      // Anonymous space letters (displayName != null) cannot have visibility changed.
      const changeableSls = ((spaceLettersQuery.data ?? []) as SpaceLetter[]).filter(
        (sl) => sl.sourceArticleId === articleId && sl.displayName == null,
      );
      if (changeableSls.length === 0) return;
      // If ANY changeable space_letter is PUBLIC, offer to hide all → RECIPIENT_ONLY.
      // Only if ALL are RECIPIENT_ONLY do we offer to show all → PUBLIC.
      const anyPublic = changeableSls.some(
        (sl) => sl.visibility === SpaceLetterVisibility.PUBLIC,
      );
      const newVisibility = anyPublic
        ? SpaceLetterVisibility.RECIPIENT_ONLY
        : SpaceLetterVisibility.PUBLIC;
      setVisibilityConfirmTarget({
        spaceLetters: changeableSls.map((sl) => ({ spaceId: sl.spaceId, spaceLetterId: sl.id })),
        newVisibility,
      });
    },
    [spaceLettersQuery.data],
  );

  const confirmVisibilityChange = useCallback(async () => {
    if (!visibilityConfirmTarget || isChangingVisibility) return;
    setIsChangingVisibility(true);
    const { spaceLetters, newVisibility } = visibilityConfirmTarget;
    try {
      // Update every space_letter for this article (handles letters sent to multiple spaces).
      for (const { spaceId, spaceLetterId } of spaceLetters) {
        await updateVisibility.mutateAsync({
          id: spaceId,
          letterId: spaceLetterId,
          data: { visibility: newVisibility },
        });
      }
      if (userId) {
        await queryClient.invalidateQueries({
          queryKey: getListUserSpaceLettersQueryKey(userId),
        });
      }
      invalidateArticleLists(queryClient);
      setVisibilityConfirmTarget(null);
      showToast({
        message:
          newVisibility === SpaceLetterVisibility.PUBLIC
            ? "전체 공개로 변경했어요."
            : "수신자 공개로 변경했어요.",
        type: "success",
      });
    } catch {
      showToast({ message: "변경에 실패했습니다. 다시 시도해주세요.", type: "error" });
    } finally {
      setIsChangingVisibility(false);
    }
  }, [visibilityConfirmTarget, isChangingVisibility, updateVisibility, queryClient, userId, showToast]);

  const isOverlayActive = selectedArticle !== null;

  const isSourceHidden = useCallback(
    (articleId: string) => isSelectedSourceHidden && selectedArticle?.id === articleId,
    [isSelectedSourceHidden, selectedArticle?.id],
  );

  // renderLetterOverlay is NOT memoised so it always reads the latest state.
  // It is called immediately during render ({renderLetterOverlay()}) so
  // stale-closure issues from useCallback deps would silently break the UI.
  const renderLetterOverlay = (): React.ReactNode => {
    // Visibility button: only for the current user's own letters.
    const isMyLetter = Boolean(userId && selectedArticle?.authorId === userId);
    // Look up the SpaceLetter entry by article id.
    // sl may be undefined when the query hasn't resolved yet or the
    // sourceArticleId mapping differs — in that case we still show the button
    // (disabled) so the affordance is always visible on own letters.
    const sl =
      isMyLetter && selectedArticle
        ? spaceLetterByArticleId.get(selectedArticle.id)
        : undefined;

    let visibilityButton:
      | React.ComponentProps<typeof CardSelectOverlay>["visibilityButton"]
      | undefined;

    if (isMyLetter) {
      const isAnon = sl?.displayName != null;
      const isPub = sl ? sl.visibility === SpaceLetterVisibility.PUBLIC : true;
      // disabled when: anonymous sender (cannot change) OR no SpaceLetter found yet
      const disabled = isAnon || sl == null;
      visibilityButton = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        icon: (disabled || !isPub ? "users" : "globe") as any,
        label: isAnon ? "수신자 공개" : isPub ? "전체 공개" : "수신자 공개",
        disabled,
        onPress: () => {
          if (selectedArticle && sl) handleVisibilityToggle(selectedArticle.id);
        },
      };
    }

    return (
      <>
        <CardSelectOverlay
          articles={chainArticles}
          metas={chainMetas}
          initialIndex={chainInitialIndex}
          originLayout={selectedOrigin}
          onClose={closeOverlay}
          onRead={handleOverlayRead}
          onReady={() => setIsSelectedSourceHidden(true)}
          onNavigateToCollection={(id) =>
            router.push({ pathname: "/of-02-detail", params: { id } })
          }
          onNavigateToAuthor={(authorId) =>
            router.push(`/user-profile/${authorId}` as never)
          }
          currentCollectionId={overlayNavOptions.currentCollectionId}
          currentAuthorId={overlayNavOptions.currentAuthorId}
          visibilityButton={visibilityButton}
        />
        <ConfirmModal
          visible={Boolean(visibilityConfirmTarget)}
          title={
            visibilityConfirmTarget?.newVisibility === SpaceLetterVisibility.RECIPIENT_ONLY
              ? "수신자 공개로 변경하시겠습니까?"
              : "전체 공개로 변경하시겠습니까?"
          }
          description={
            visibilityConfirmTarget?.newVisibility === SpaceLetterVisibility.RECIPIENT_ONLY
              ? "편지가 내 프로필에서 사라지며, 발신 시점의 수신자만 읽을 수 있게 됩니다."
              : "편지가 내 프로필에 표시되며, Friction 내 모든 사용자가 볼 수 있습니다."
          }
          confirmLabel="변경"
          cancelLabel="취소"
          confirmDisabled={isChangingVisibility}
          cancelDisabled={isChangingVisibility}
          onConfirm={confirmVisibilityChange}
          onCancel={() => {
            if (!isChangingVisibility) setVisibilityConfirmTarget(null);
          }}
        />
      </>
    );
  };

  return {
    isOverlayActive,
    isSourceHidden,
    selectedArticleId: selectedArticle?.id ?? null,
    openLetterOverlay,
    closeOverlay,
    renderLetterOverlay,
    spaceLetterByArticleId,
  };
}
