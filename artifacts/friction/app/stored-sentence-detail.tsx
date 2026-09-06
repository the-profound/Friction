import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetStoredSentenceQueryKey,
  getListStoredSentencesQueryKey,
  useCreateThought,
  useDeleteStoredSentence,
  useGetStoredSentence,
  useToggleStoredSentenceFavorite,
} from "@workspace/api-client-react";
import HeaderButton from "@/components/shared/HeaderButton";
import ActionSheetModal, { type ActionSheetAction } from "@/components/ActionSheetModal/ActionSheetModal";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, ReaderTokens, Spacing, Typography, readerFontSize } from "@/constants/tokens";
import { useReaderTransition } from "@/contexts/ReaderTransitionContext";
import { useToast } from "@/contexts/ToastContext";
import { useUser } from "@/contexts/UserContext";
import {
  applyStoredSentenceFavoriteResponse,
  optimisticallySetStoredSentenceFavorite,
  rollbackStoredSentenceFavorite,
} from "@/lib/storedSentenceFavoriteCache";
import StoredSentenceCard from "@/components/StoredSentenceCard";

function getPage(position: unknown): number | undefined {
  if (!position || typeof position !== "object" || !("page" in position)) return undefined;
  const page = (position as { page?: unknown }).page;
  return typeof page === "number" && Number.isFinite(page) ? page : undefined;
}

export default function StoredSentenceDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const sentenceId = typeof id === "string" ? id : "";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { userId } = useUser();
  const { showToast } = useToast();
  const { startFadeToBlack } = useReaderTransition();
  const queryClient = useQueryClient();
  const query = useGetStoredSentence(sentenceId, { query: { retry: false } });
  const toggleFavorite = useToggleStoredSentenceFavorite();
  const deleteSentence = useDeleteStoredSentence();
  const createThought = useCreateThought();
  const [menuVisible, setMenuVisible] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionLock = useRef(false);

  const sentence = query.data;
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const cardWidth = Math.max(1, Math.min(width - Spacing.screenPx * 2, 680));
  const bodySize = readerFontSize(ReaderTokens.typeScale.bodyCqi, cardWidth);
  const sourceSize = readerFontSize(ReaderTokens.typeScale.captionCqi, cardWidth);
  const page = getPage(sentence?.position);
  const source = sentence
    ? sentence.sourceText?.trim() || [
        `${sentence.articleAuthorName?.trim() || "저자 미상"}, <${sentence.articleTitle?.trim() || "제목 없는 원문"}>`,
        page === undefined ? "저장 위치 없음" : `${page + 1}면`,
      ].join(" · ")
    : "";
  const busy = actionLock.current || toggleFavorite.isPending || deleteSentence.isPending || createThought.isPending;

  const runAction = useCallback(async (work: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setActionError(null);
    try {
      await work();
    } finally {
      actionLock.current = false;
    }
  }, []);

  const handleCopy = useCallback(() => {
    if (!sentence) return;
    void runAction(async () => {
      try {
        if (Platform.OS === "web") await navigator.clipboard.writeText(sentence.text);
        else await Clipboard.setStringAsync(sentence.text);
        showToast({ message: "문장을 복사했어요.", type: "success" });
      } catch {
        setActionError("복사에 실패했어요. 다시 시도해주세요.");
        showToast({ message: "복사에 실패했어요.", type: "error" });
      }
    });
  }, [runAction, sentence, showToast]);

  const handleFavorite = useCallback(() => {
    if (!sentence || actionLock.current || toggleFavorite.isPending) return;
    void runAction(async () => {
      const nextFavorite = !sentence.isFavorite;
      const { snapshot } = await optimisticallySetStoredSentenceFavorite(
        queryClient,
        userId,
        sentence,
        nextFavorite,
      );
      try {
        const updated = await toggleFavorite.mutateAsync({
          id: sentence.id,
          data: { isFavorite: nextFavorite },
        });
        applyStoredSentenceFavoriteResponse(queryClient, userId, updated);
        await queryClient.invalidateQueries({ queryKey: getListStoredSentencesQueryKey({ userId }) });
        showToast({ message: updated.isFavorite ? "즐겨찾기에 추가했어요." : "즐겨찾기에서 해제했어요.", type: "success" });
      } catch {
        rollbackStoredSentenceFavorite(queryClient, snapshot);
        setActionError("즐겨찾기 변경에 실패했어요. 다시 시도해주세요.");
        showToast({ message: "즐겨찾기 변경에 실패했어요.", type: "error" });
      }
    });
  }, [queryClient, runAction, sentence, showToast, toggleFavorite, userId]);

  const handleQuote = useCallback(() => {
    if (!sentence) return;
    void runAction(async () => {
      const quoteSource = sentence.sourceText?.trim()
        || (sentence.articleTitle ? `<${sentence.articleTitle}>${page === undefined ? "" : `, ${page + 1}면`}` : "");
      const quote = quoteSource
        ? `> ${sentence.text.trim()}\n>\n> ${quoteSource}`
        : `> ${sentence.text.trim()}\n`;
      try {
        const thought = await createThought.mutateAsync({
          data: {
            content: `# \n\n${quote}`,
            createdFrom: "quoted",
            sourceArticleId: sentence.articleId ?? undefined,
            sourceStoredSentenceId: sentence.id,
          },
        });
        router.push({ pathname: "/on-01a", params: { id: thought.id } });
      } catch {
        setActionError("메모 생성에 실패했어요. 다시 시도해주세요.");
        showToast({ message: "메모 생성에 실패했어요.", type: "error" });
      }
    });
  }, [createThought, page, router, runAction, sentence, showToast]);

  const handleDelete = useCallback(() => {
    if (!sentence) return;
    void runAction(async () => {
      try {
        await deleteSentence.mutateAsync({ id: sentence.id });
        queryClient.removeQueries({ queryKey: getGetStoredSentenceQueryKey(sentence.id) });
        await queryClient.invalidateQueries({ queryKey: getListStoredSentencesQueryKey({ userId }) });
        showToast({ message: "문장을 삭제했어요.", type: "success" });
        router.back();
      } catch {
        setDeleteConfirmVisible(false);
        setActionError("삭제에 실패했어요. 다시 시도해주세요.");
        showToast({ message: "삭제에 실패했어요.", type: "error" });
      }
    });
  }, [deleteSentence, queryClient, router, runAction, sentence, showToast, userId]);

  const actions = useMemo<ActionSheetAction[]>(() => sentence ? [
    { label: "복사하기", onPress: handleCopy, disabled: busy },
    { label: sentence.isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가", onPress: handleFavorite, disabled: busy },
    { label: "인용하여 메모 작성", onPress: handleQuote, disabled: busy },
    ...(sentence.articleId ? [{
      label: "원본으로 이동",
      disabled: busy,
      onPress: () => startFadeToBlack(() => router.push({ pathname: "/read", params: { articleId: sentence.articleId!, mode: "re_read" } })),
    }] : []),
    { label: "삭제", style: "destructive" as const, disabled: busy, onPress: () => setDeleteConfirmVisible(true) },
    { label: "취소", style: "cancel" as const, onPress: () => undefined },
  ] : [], [busy, handleCopy, handleFavorite, handleQuote, router, sentence, startFadeToBlack]);

  const renderState = () => {
    if (!sentenceId || query.isError) {
      return (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>{!sentenceId ? "문장을 찾을 수 없어요" : "문장을 불러오지 못했어요"}</Text>
          <Text style={styles.stateDescription}>삭제되었거나 더 이상 접근할 수 없는 문장일 수 있어요.</Text>
          {sentenceId ? (
            <ScalePressable style={styles.retryButton} contentStyle={styles.retryButtonContent} onPress={() => query.refetch()}>
              <Text style={styles.retryButtonText}>다시 시도</Text>
            </ScalePressable>
          ) : null}
        </View>
      );
    }
    if (query.isLoading || !sentence) {
      return <View style={styles.state}><ActivityIndicator color={Colors.noticeAccent} /><Text style={styles.stateDescription}>문장을 불러오는 중...</Text></View>;
    }
    return (
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <StoredSentenceCard
          style={{ width: cardWidth }}
          text={sentence.text}
          source={source}
          date={new Date(sentence.createdAt).toLocaleDateString("ko-KR")}
          isFavorite={sentence.isFavorite}
          bodyFontSize={bodySize}
          sourceFontSize={sourceSize}
        />
        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
      </ScrollView>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <HeaderButton variant="back" onPress={() => router.back()} />
        <Text style={styles.headerTitle}>수집 문장</Text>
        <HeaderButton variant="menu" onPress={() => setMenuVisible(true)} disabled={!sentence || busy} busy={busy} />
      </View>
      {renderState()}
      <ActionSheetModal visible={menuVisible} actions={actions} onClose={() => setMenuVisible(false)} />
      <ConfirmModal
        visible={deleteConfirmVisible}
        title="문장 삭제"
        description="이 문장을 삭제하시겠어요?"
        confirmLabel={deleteSentence.isPending ? "삭제 중..." : "삭제"}
        cancelLabel="취소"
        destructive
        destructiveFilled
        confirmDisabled={deleteSentence.isPending}
        cancelDisabled={deleteSentence.isPending}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  header: {
    height: 68,
    paddingHorizontal: Spacing.screenPx,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { ...Typography.bodySemiBold, fontSize: 17, color: Colors.zinc900 },
  scrollContent: { alignItems: "center", paddingTop: 16, paddingHorizontal: Spacing.screenPx },
  actionError: { ...Typography.caption, color: Colors.noticeAccent, marginTop: 18, textAlign: "center" },
  state: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: Spacing.screenPx, gap: 10 },
  stateTitle: { ...Typography.bodySemiBold, fontSize: 17, color: Colors.zinc900, textAlign: "center" },
  stateDescription: { ...Typography.body, fontSize: 14, lineHeight: 20, color: Colors.zinc500, textAlign: "center" },
  retryButton: { width: 112, height: 44, flexGrow: 0, flexShrink: 0, marginTop: 8 },
  retryButtonContent: {
    width: 112,
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 22,
    backgroundColor: Colors.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: { ...Typography.bodySemiBold, color: Colors.primaryActionForeground, fontSize: 14 },
});