import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import {
  getListSendRecordsQueryKey,
  useListUserSpaceLetters,
  useListSendRecords,
  useUpdateSpaceLetterVisibility,
  SpaceLetterVisibility,
  getListUserSpaceLettersQueryKey,
  type Article,
  type SendRecordWithDetails,
  type SpaceLetter,
} from "@workspace/api-client-react";
import CardSelectOverlay, {
  type ChainArticleMeta,
  type OriginLayout,
  type EnvelopeInfo,
} from "@/components/CardSelectOverlay/CardSelectOverlay";

// Re-export so screens can import these types from the hook and avoid
// importing CardSelectOverlay directly (which is the goal of this task).
export type { OriginLayout, EnvelopeInfo } from "@/components/CardSelectOverlay/CardSelectOverlay";
export type { ChainArticleMeta } from "@/components/CardSelectOverlay/CardSelectOverlay";
import ScalePressable from "@/components/shared/ScalePressable";
import { useAncestorChain } from "@/hooks/useAncestorChain";
import { useToast } from "@/contexts/ToastContext";
import { invalidateArticleLists } from "@/lib/queryInvalidation";
import { useAuth } from "@/contexts/AuthContext";
import { Colors, Typography } from "@/constants/tokens";

export interface LetterOverlayMeta {
  collectionName?: string | null;
  collectionId?: string | null;
  /** Space id backing the same displayed collectionName, when the letter came from a Space. */
  spaceId?: string | null;
  date?: string | null;
  /** Override the author name shown in the overlay info bar. */
  authorName?: string | null;
  /** Override the author ID for info-bar navigation (pass null for anonymous). */
  authorId?: string | null;
  /** Override the isRead dimming of the card. */
  isRead?: boolean;
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
  /** Prevents the info bar from linking back to the current space (e.g. the space's own detail screen). */
  currentSpaceId?: string | null;
  /** Envelope info for sealed letters (inbox use). */
  envelopeInfo?: EnvelopeInfo | null;
  /**
   * Pass true when the source carousel uses the restrained carousel shadow
   * token so the hero transition blends shadows correctly.
   */
  originUsesCarouselShadow?: boolean;
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
   * Update the selected article in-place after an async fetch resolves.
   * Useful for screens that seed a lightweight article on open and then load
   * the full article (with a real sourceArticleId) asynchronously.
   * No-op when the overlay is not currently open.
   */
  updateOverlayArticle: (article: Article) => void;
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
  /**
   * When false, the ancestor-chain lookup is skipped entirely.
   * Use for anonymous spaces where traversing the reply chain would expose
   * real author identities. Default: true.
   */
  allowAncestorChain?: boolean;
  /**
   * Override for the "읽기" action. When provided, called instead of the
   * default `router.push('/read')`. The hook still clears its own state
   * before invoking this callback.
   * `isNonPrimary` is true when the user tapped a chain slot that is NOT the
   * initially-opened article (i.e. an ancestor or descendant slot).
   */
  onRead?: (article: Article, isNonPrimary: boolean) => void;
  /**
   * Called just after the overlay is closed (user pressed ✕ or backdrop).
   * Use to clean up per-screen state that mirrors the overlay lifecycle.
   */
  onClose?: () => void;
  /**
   * When provided, replaces the hook's internal chain-building during render.
   * Called with the currently-selected article on every render while the
   * overlay is open. Return null to fall back to the hook's own chain.
   *
   * Because renderLetterOverlay() is called directly inside the parent
   * component's render, this function always has access to the latest
   * reactive state in the calling component — no stale-closure issues.
   */
  getChain?: (article: Article) => {
    articles: (Article | null)[];
    metas: ChainArticleMeta[];
    initialIndex: number;
  } | null;
}

function hasPersonalSend(records: SendRecordWithDetails[], articleId: string): boolean {
  return records.some(
    (record) =>
      record.articleId === articleId &&
      record.targetType !== "space" &&
      !record.spaceId,
  );
}

interface InlineConfirmDialogProps {
  visible: boolean;
  title: string;
  description: string;
  cancelLabel?: string;
  /** Omit to render the single-button "info" variant. */
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm?: () => void;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
}

/**
 * Visibility-change confirm / info dialog rendered inside CardSelectOverlay's
 * `inlineModal` slot (see CardSelectOverlay's doc comment for why a nested
 * RN Modal cannot be used there).
 *
 * Visually and behaviourally mirrors components/ConfirmModal/ConfirmModal.tsx:
 * same tokens (colors/typography/spacing), same fade transition, and the same
 * "freeze last content while fading out" trick so dismissing never flashes
 * empty content.
 */
function InlineConfirmDialog({
  visible,
  title,
  description,
  cancelLabel = "취소",
  confirmLabel,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  cancelDisabled = false,
}: InlineConfirmDialogProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [isMounted, setIsMounted] = useState(visible);

  // Freeze content while fading out so the dialog never flashes empty/stale
  // text between the moment the caller clears its state and the fade finishing.
  const frozenTitle = useRef(title);
  const frozenDescription = useRef(description);
  const frozenCancelLabel = useRef(cancelLabel);
  const frozenConfirmLabel = useRef(confirmLabel);
  const frozenOnConfirm = useRef(onConfirm);
  if (visible) {
    frozenTitle.current = title;
    frozenDescription.current = description;
    frozenCancelLabel.current = cancelLabel;
    frozenConfirmLabel.current = confirmLabel;
    frozenOnConfirm.current = onConfirm;
  }

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setIsMounted(false);
      });
    }
  }, [visible, opacity]);

  if (!isMounted) return null;

  const displayConfirmLabel = frozenConfirmLabel.current;

  return (
    <Animated.View
      style={[inlineOverlayStyles.fullScreenRoot, { opacity }]}
      pointerEvents={visible ? "auto" : "none"}
    >
      <Pressable
        style={inlineOverlayStyles.overlay}
        onPress={cancelDisabled ? undefined : onCancel}
      >
        <View style={inlineOverlayStyles.contentWrapper}>
          <Pressable style={inlineOverlayStyles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={inlineOverlayStyles.title}>{frozenTitle.current}</Text>
            <Text style={inlineOverlayStyles.description}>{frozenDescription.current}</Text>
            <View style={inlineOverlayStyles.buttons}>
              <ScalePressable
                style={inlineOverlayStyles.button}
                contentStyle={[inlineOverlayStyles.buttonContent, inlineOverlayStyles.cancelButton]}
                onPress={onCancel}
                disabled={cancelDisabled}
                accessibilityRole="button"
                accessibilityLabel={frozenCancelLabel.current}
              >
                <Text style={inlineOverlayStyles.cancelText}>{frozenCancelLabel.current}</Text>
              </ScalePressable>
              {displayConfirmLabel != null && (
                <ScalePressable
                  style={inlineOverlayStyles.button}
                  contentStyle={[
                    inlineOverlayStyles.buttonContent,
                    inlineOverlayStyles.confirmButton,
                    confirmDisabled && inlineOverlayStyles.buttonDisabled,
                  ]}
                  onPress={frozenOnConfirm.current}
                  disabled={confirmDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={displayConfirmLabel}
                >
                  <Text style={inlineOverlayStyles.confirmText}>{displayConfirmLabel}</Text>
                </ScalePressable>
              )}
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
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
  const { isLoading: authIsLoading } = useAuth();

  // Keep callback refs fresh without listing them as useCallback deps.
  const onBeforeReadRef = useRef(options?.onBeforeRead);
  onBeforeReadRef.current = options?.onBeforeRead;
  const onReadRef = useRef(options?.onRead);
  onReadRef.current = options?.onRead;
  const onCloseRef = useRef(options?.onClose);
  onCloseRef.current = options?.onClose;
  // getChain is accessed directly in renderLetterOverlay() (not via ref) so
  // it always has the latest closure. We still keep a ref for handleOverlayRead.
  const getChainRef = useRef(options?.getChain);
  getChainRef.current = options?.getChain;

  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<OriginLayout | null>(null);
  const [isSelectedSourceHidden, setIsSelectedSourceHidden] = useState(false);
  const [selectedMeta, setSelectedMeta] = useState<LetterOverlayMeta>({});
  const [overlayNavOptions, setOverlayNavOptions] = useState<{
    currentCollectionId?: string | null;
    currentAuthorId?: string | null;
    currentSpaceId?: string | null;
  }>({});
  const [selectedEnvelopeInfo, setSelectedEnvelopeInfo] = useState<EnvelopeInfo | null>(null);
  const [selectedCarouselShadow, setSelectedCarouselShadow] = useState(false);

  // Visibility toggle state
  const [visibilityConfirmTarget, setVisibilityConfirmTarget] = useState<{
    /** All non-anonymous space_letters for the article — each will be updated. */
    spaceLetters: Array<{ spaceId: string; spaceLetterId: string }>;
    newVisibility: "PUBLIC" | "RECIPIENT_ONLY";
  } | null>(null);
  const [isChangingVisibility, setIsChangingVisibility] = useState(false);
  // Info modal shown when the user taps the visibility button on a letter that
  // cannot have its visibility changed (anonymous space send or personal send).
  const [visibilityInfoModal, setVisibilityInfoModal] = useState<
    "anon" | "personal" | "unsent" | null
  >(null);

  // Space letters for the current user — used to show visibility badge and toggle.
  // Guard on !authIsLoading so the request fires only after the auth token is
  // available. Without this gate the query can fire unauthenticated, receive
  // only PUBLIC letters (resolveCallerId returns 200 for anonymous callers),
  // and React Query caches the empty result — preventing a re-fetch later.
  const spaceLettersQuery = useListUserSpaceLetters(userId ?? "", {
    query: {
      enabled: Boolean(userId) && !authIsLoading,
      queryKey: getListUserSpaceLettersQueryKey(userId ?? ""),
    },
  });
  const sendRecordsParams = { senderId: userId ?? "" };
  const sendRecordsQuery = useListSendRecords(sendRecordsParams, {
    query: {
      enabled: Boolean(userId) && !authIsLoading,
      queryKey: getListSendRecordsQueryKey(sendRecordsParams),
    },
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

  const allowChain = options?.allowAncestorChain !== false;
  const ancestorChain = useAncestorChain(
    allowChain ? (selectedArticle?.sourceArticleId ?? null) : null,
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
      // Allow callers to override author presentation (e.g. anonymous spaces).
      authorName:
        selectedMeta.authorName !== undefined
          ? selectedMeta.authorName
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : ((selectedArticle as any).authorNickname ?? null),
      authorId:
        selectedMeta.authorId !== undefined
          ? selectedMeta.authorId
          : (selectedArticle.authorId ?? null),
      collectionName: selectedMeta.collectionName ?? null,
      collectionId: selectedMeta.collectionId ?? null,
      spaceId: selectedMeta.spaceId ?? null,
      date: selectedMeta.date ?? null,
      isRead: selectedMeta.isRead,
    });

    return { chainArticles: artList, chainMetas: metaList, chainInitialIndex: initIdx };
  }, [selectedArticle, ancestorChain, selectedMeta]);

  /**
   * Stable ref holding the chain that was last rendered by renderLetterOverlay.
   * handleOverlayRead reads from here so that getChain-based chains (inbox,
   * custom screens) are reflected correctly in the read callback.
   */
  const effectiveChainRef = useRef<{
    articles: (Article | null)[];
    metas: ChainArticleMeta[];
    initialIndex: number;
  }>({ articles: [], metas: [], initialIndex: 0 });

  const closeOverlay = useCallback(() => {
    setIsSelectedSourceHidden(false);
    setSelectedArticle(null);
    setSelectedOrigin(null);
    setSelectedMeta({});
    setOverlayNavOptions({});
    setSelectedEnvelopeInfo(null);
    setSelectedCarouselShadow(false);
    onCloseRef.current?.();
  }, []);

  const handleOverlayRead = useCallback(
    (chainIdx: number) => {
      const { articles, initialIndex } = effectiveChainRef.current;
      const article = articles[chainIdx];
      if (!article) return;
      const isNonPrimary = chainIdx !== initialIndex;
      onBeforeReadRef.current?.();
      setSelectedArticle(null);
      setSelectedOrigin(null);
      setSelectedMeta({});
      setOverlayNavOptions({});
      setSelectedEnvelopeInfo(null);
      setSelectedCarouselShadow(false);
      if (onReadRef.current) {
        onReadRef.current(article, isNonPrimary);
      } else {
        router.push({
          pathname: "/read" as never,
          params: { articleId: article.id, mode: "re_read" },
        });
      }
    },
    [router],
  );

  const openLetterOverlay = useCallback(
    (article: Article, openOptions?: OpenLetterOverlayOptions) => {
      const meta = openOptions?.meta ?? {};
      setSelectedMeta(meta);
      setIsSelectedSourceHidden(false);
      setOverlayNavOptions({
        currentCollectionId: openOptions?.currentCollectionId,
        currentAuthorId: openOptions?.currentAuthorId,
        currentSpaceId: openOptions?.currentSpaceId,
      });
      setSelectedEnvelopeInfo(openOptions?.envelopeInfo ?? null);
      setSelectedCarouselShadow(openOptions?.originUsesCarouselShadow ?? false);

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

  const updateOverlayArticle = useCallback((article: Article) => {
    setSelectedArticle((current) => (current !== null ? article : null));
  }, []);

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
    // ── Resolve effective chain ──────────────────────────────────────────────
    // If the caller provided getChain, use that (allows reactive external
    // chains like the inbox's replyToArticleId + descendant chain).
    // Otherwise, fall back to the internally-built ancestor chain.
    let effectiveArticles: (Article | null)[];
    let effectiveMetas: ChainArticleMeta[];
    let effectiveInitialIndex: number;

    if (selectedArticle && options?.getChain) {
      const external = options.getChain(selectedArticle);
      if (external) {
        effectiveArticles = external.articles;
        effectiveMetas = external.metas;
        effectiveInitialIndex = external.initialIndex;
      } else {
        effectiveArticles = chainArticles;
        effectiveMetas = chainMetas;
        effectiveInitialIndex = chainInitialIndex;
      }
    } else {
      effectiveArticles = chainArticles;
      effectiveMetas = chainMetas;
      effectiveInitialIndex = chainInitialIndex;
    }

    // Keep the ref updated so handleOverlayRead always sees the right chain.
    effectiveChainRef.current = {
      articles: effectiveArticles,
      metas: effectiveMetas,
      initialIndex: effectiveInitialIndex,
    };

    // ── Visibility button ───────────────────────────────────────────────────
    // Visibility toggle button: only for the current user's own letters.
    const isMyLetter = Boolean(userId && selectedArticle?.authorId === userId);
    // Look up the SpaceLetter entry by article id.
    const sl =
      isMyLetter && selectedArticle
        ? spaceLetterByArticleId.get(selectedArticle.id)
        : undefined;

    let visibilityButton:
      | React.ComponentProps<typeof CardSelectOverlay>["visibilityButton"]
      | undefined;

    if (isMyLetter) {
      const isAnon = sl?.displayName != null;
      const isPub = sl ? sl.visibility === SpaceLetterVisibility.PUBLIC : false;
      visibilityButton = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        icon: (isAnon || sl == null || !isPub ? "users" : "globe") as any,
        label: isAnon || sl == null ? "수신자 공개" : isPub ? "전체 공개" : "수신자 공개",
        disabled: false,
        onPress: async () => {
          if (!selectedArticle) return;
          if (isAnon) {
            setVisibilityInfoModal("anon");
          } else if (sl == null) {
            const records =
              sendRecordsQuery.data ??
              (await sendRecordsQuery.refetch()).data ??
              [];
            setVisibilityInfoModal(
              hasPersonalSend(records as SendRecordWithDetails[], selectedArticle.id)
                ? "personal"
                : "unsent",
            );
          } else {
            handleVisibilityToggle(selectedArticle.id);
          }
        },
      };
    }

    // ── Inline modal for visibility dialogs ─────────────────────────────────
    // Rendered via CardSelectOverlay's inlineModal prop so it appears INSIDE
    // the native Modal window. A sibling native Modal cannot guarantee z-order
    // above an already-presented Modal on all platforms.
    const isConfirmVisible = visibilityConfirmTarget !== null;
    const isInfoVisible = visibilityInfoModal !== null;
    const handleDismiss = () => {
      if (isChangingVisibility) return;
      setVisibilityConfirmTarget(null);
      setVisibilityInfoModal(null);
    };

    let dialogTitle = "";
    let dialogDescription = "";
    let dialogConfirmLabel: string | undefined;
    if (isConfirmVisible) {
      dialogTitle =
        visibilityConfirmTarget!.newVisibility === SpaceLetterVisibility.RECIPIENT_ONLY
          ? "수신자 공개로 변경하시겠습니까?"
          : "전체 공개로 변경하시겠습니까?";
      dialogDescription =
        visibilityConfirmTarget!.newVisibility === SpaceLetterVisibility.RECIPIENT_ONLY
          ? "편지가 내 프로필에서 사라지며, 발신 시점의 수신자만 읽을 수 있게 됩니다."
          : "편지가 내 프로필에 표시되며, Friction 내 모든 사용자가 볼 수 있습니다.";
      dialogConfirmLabel = "변경";
    } else if (isInfoVisible) {
      dialogTitle = "전체 공개로 변경할 수 없어요";
      dialogDescription =
        visibilityInfoModal === "anon"
          ? "익명 공간에 발신된 편지는 수신자 공개로만 설정할 수 있어요"
          : visibilityInfoModal === "personal"
            ? "개인에게 발신된 편지는 수신자 공개로만 설정할 수 있어요"
            : "발신하지 않은 편지는 수신자 공개로만 설정할 수 있어요";
      dialogConfirmLabel = undefined;
    }

    const inlineModalNode = (
      <InlineConfirmDialog
        visible={isConfirmVisible || isInfoVisible}
        title={dialogTitle}
        description={dialogDescription}
        confirmLabel={dialogConfirmLabel}
        onCancel={handleDismiss}
        onConfirm={isConfirmVisible ? confirmVisibilityChange : undefined}
        confirmDisabled={isChangingVisibility}
        cancelDisabled={isChangingVisibility}
      />
    );

    return (
      <CardSelectOverlay
        articles={effectiveArticles}
        metas={effectiveMetas}
        initialIndex={effectiveInitialIndex}
        originLayout={selectedOrigin}
        onClose={closeOverlay}
        onRead={handleOverlayRead}
        onReady={() => setIsSelectedSourceHidden(true)}
        onNavigateToCollection={(id) =>
          router.push({ pathname: "/of-01-detail", params: { id } })
        }
        onNavigateToAuthor={(authorId) =>
          router.push(`/user-profile/${authorId}` as never)
        }
        onNavigateToSpace={(spaceId) =>
          router.push({ pathname: "/of-space-detail" as never, params: { id: spaceId } })
        }
        currentCollectionId={overlayNavOptions.currentCollectionId}
        currentAuthorId={overlayNavOptions.currentAuthorId}
        currentSpaceId={overlayNavOptions.currentSpaceId}
        originUsesCarouselShadow={selectedCarouselShadow}
        envelopeInfo={selectedEnvelopeInfo}
        visibilityButton={visibilityButton}
        inlineModal={inlineModalNode ?? undefined}
        onInlineModalRequestClose={
          isConfirmVisible || isInfoVisible ? handleDismiss : undefined
        }
      />
    );
  };

  return {
    isOverlayActive,
    isSourceHidden,
    selectedArticleId: selectedArticle?.id ?? null,
    openLetterOverlay,
    closeOverlay,
    updateOverlayArticle,
    renderLetterOverlay,
    spaceLetterByArticleId,
  };
}

// Styles for the View-based visibility dialog rendered inside the overlay's
// native Modal window via the `inlineModal` prop. Mirrors
// components/ConfirmModal/ConfirmModal.tsx's tokens (colors/typography/
// spacing/radii) exactly so both dialogs look identical to the user.
const inlineOverlayStyles = StyleSheet.create({
  fullScreenRoot: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  contentWrapper: {
    width: "100%",
    alignItems: "center",
  },
  card: {
    width: "100%",
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  title: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
    textAlign: "center",
  },
  description: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
  buttons: {
    flexDirection: "row",
    marginTop: 20,
    gap: 10,
  },
  button: {
    flex: 1,
    height: 48,
  },
  buttonContent: {
    height: 48,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  cancelButton: {
    backgroundColor: Colors.zinc100,
  },
  confirmButton: {
    backgroundColor: Colors.primaryAction,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  cancelText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc600,
  },
  confirmText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.primaryActionForeground,
  },
});
