import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";

import { Colors, Spacing, Typography } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useUser } from "@/contexts/UserContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import ScalePressable from "@/components/shared/ScalePressable";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import ArticleListItem from "@/components/ArticleListItem/ArticleListItem";
import { LetterPickerSheet } from "@/components/shared/LetterPickerSheet";
import { NeighborPickerModal } from "@/components/shared/NeighborPickerModal";
import { ReplyLetterPickerModal } from "@/components/shared/ReplyLetterPickerModal";
import { SpacePickerModal } from "@/components/shared/SpacePickerModal";
import { CollapsibleDatePicker } from "@/components/shared/CalendarGrid";
import {
  ApiError,
  getListArticlesQueryKey,
  getListInboxQueryKey,
  getListNeighborsQueryKey,
  getListSendRecordsQueryKey,
  getListSpacesQueryKey,
  useListArticles,
  useListInbox,
  useListNeighbors,
  useListSpaces,
  useSendArticle,
} from "@workspace/api-client-react";
import type {
  Article,
  InboxItem,
  NeighborWithUser,
  SendArticleBody,
  SendRecordWithDetails,
  SpaceListItem,
} from "@workspace/api-client-react";
import { canSendToNeighbor, formatDeliveryTime } from "@/lib/deliverySync";
import type { ArticleStatus } from "@/lib/policies";
import {
  buildReplySendTarget,
  filterReadReplyLetters,
  getSendArticleAuthorName,
  resolveInitialSendDefaults,
  resolvePrefillArticleState,
  resolveSendSpaceLetterVisibilitySelection,
} from "@/lib/sendPickerPresentation";
import type { SendSpaceLetterVisibility } from "@/lib/sendPickerPresentation";
import { kstDateAt6, minOpeningSendDate } from "@/lib/kstDate";
import {
  createSubmissionLock,
  runAuthenticatedMutation,
} from "@/lib/authenticatedMutation";

type SendMode = "person" | "reply" | "space";
const sendSubmissionLock = createSubmissionLock();

interface SendInlineProps {
  /** Kept for compatibility with older entry points. Collections are not send targets. */
  targetGroup?: string;
  targetGroupName?: string;
  prefillArticleId?: string;
  prefillNeighborId?: string;
  prefillSpaceId?: string;
  prefillSpaceName?: string;
  returnToId?: string;
  prefillKey?: string | number;
  onSent?: () => void;
  onScheduleSpace: (spaceId: string, articleId: string) => void;
}

function calendarDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function formatCalendarDate(date: Date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const data = error.data as { error?: string } | null;
    if (data?.error) return data.error;
  }
  return error instanceof Error ? error.message : "전송에 실패했어요.";
}

export function SendInline({
  targetGroup: _targetGroup,
  targetGroupName: _targetGroupName,
  prefillArticleId,
  prefillNeighborId,
  prefillSpaceId,
  prefillSpaceName,
  returnToId: _returnToId,
  prefillKey,
  onSent,
  onScheduleSpace,
}: SendInlineProps) {
  const navBottom = useNavBarBottomSafeArea();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { prepareAuthSession } = useAuth();
  const { showToast } = useToast();

  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [selectedArticleKey, setSelectedArticleKey] = useState<
    string | number | undefined
  >(undefined);
  const [selectedArticleVerified, setSelectedArticleVerified] = useState(false);
  const [mode, setMode] = useState<SendMode>("person");
  const [selectedNeighbor, setSelectedNeighbor] =
    useState<NeighborWithUser | null>(null);
  const [selectedReplyInbox, setSelectedReplyInbox] =
    useState<InboxItem | null>(null);
  const [selectedSpace, setSelectedSpace] = useState<SpaceListItem | null>(
    null,
  );
  const [spaceLetterVisibility, setSpaceLetterVisibility] =
    useState<SendSpaceLetterVisibility>("PUBLIC");
  const [deliveryDate, setDeliveryDate] = useState(() => minOpeningSendDate());

  const [letterPickerVisible, setLetterPickerVisible] = useState(false);
  const [neighborPickerVisible, setNeighborPickerVisible] = useState(false);
  const [replyPickerVisible, setReplyPickerVisible] = useState(false);
  const [spacePickerVisible, setSpacePickerVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [envelopePromptVisible, setEnvelopePromptVisible] = useState(false);
  const [pendingIsEnvelope, setPendingIsEnvelope] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [retryEnvelope, setRetryEnvelope] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const initialDefaultsPendingRef = useRef(false);

  const articleQueryParams = {
    authorId: userId ?? "",
    status: "LETTER" as const,
  };
  const articlesQuery = useListArticles(articleQueryParams, {
    query: {
      enabled: !!userId,
      queryKey: getListArticlesQueryKey(articleQueryParams),
    },
  });
  const articles = (articlesQuery.data ?? []) as Article[];
  const neighborQueryParams = { userId: userId ?? "" };
  const neighborsQuery = useListNeighbors(neighborQueryParams, {
    query: {
      enabled: !!userId,
      queryKey: getListNeighborsQueryKey(neighborQueryParams),
    },
  });
  const neighbors = (neighborsQuery.data ?? []) as NeighborWithUser[];
  const inboxQueryParams = { recipientId: userId ?? "" };
  const inboxQuery = useListInbox(inboxQueryParams, {
    query: {
      enabled: !!userId,
      queryKey: getListInboxQueryKey(inboxQueryParams),
    },
  });
  const replyCandidates = useMemo(
    () => filterReadReplyLetters((inboxQuery.data ?? []) as InboxItem[]),
    [inboxQuery.data],
  );
  const sendArticle = useSendArticle();
  const spacesQuery = useListSpaces(
    { userId },
    {
      query: {
        enabled: !!userId,
        queryKey: getListSpacesQueryKey({ userId }),
      },
    },
  );
  const prefillArticleState = resolvePrefillArticleState({
    prefillArticleId,
    articles,
    isLoading: articlesQuery.isFetching,
    isError: articlesQuery.isError,
  });
  const currentSelectedArticle =
    selectedArticle && selectedArticleKey === prefillKey
      ? selectedArticle
      : null;
  const displayedArticle =
    currentSelectedArticle ??
    (prefillArticleState.kind === "ready" ? prefillArticleState.article : null);

  // A route can reuse this mounted screen. Retire the previous selection and
  // its reply defaults before reconciling the next entry snapshot.
  useEffect(() => {
    setSelectedArticle(null);
    setSelectedArticleKey(undefined);
    setSelectedArticleVerified(false);
    setSelectedReplyInbox(null);
    setMode("person");
    setConfirmVisible(false);
    setEnvelopePromptVisible(false);
    setRetryEnvelope(null);
    setSendError(null);
    initialDefaultsPendingRef.current = false;
  }, [prefillKey]);

  // Preserve all existing entry points while applying their preselection once
  // their corresponding server list has arrived. Cached route snapshots are
  // display-only until this background verification settles successfully.
  useEffect(() => {
    if (
      !prefillArticleId ||
      !userId ||
      articlesQuery.isFetching ||
      articlesQuery.isError
    )
      return;
    const found = articles.find((article) => article.id === prefillArticleId);
    if (found) {
      setSelectedArticle(found);
      setSelectedArticleKey(prefillKey);
      setSelectedArticleVerified(true);
      initialDefaultsPendingRef.current = true;
    } else {
      setSelectedArticle(null);
      setSelectedArticleKey(undefined);
      setSelectedArticleVerified(false);
      setSelectedReplyInbox(null);
    }
  }, [
    articles,
    articlesQuery.isError,
    articlesQuery.isFetching,
    prefillArticleId,
    prefillKey,
    userId,
  ]);

  useEffect(() => {
    if (!prefillNeighborId) return;
    const found = neighbors.find(
      (neighbor) => neighbor.neighborUserId === prefillNeighborId,
    );
    if (found) {
      setMode("person");
      setSelectedNeighbor(found);
    }
  }, [neighbors, prefillKey, prefillNeighborId]);

  useEffect(() => {
    if (!prefillSpaceId) return;
    setMode("space");
    setSelectedSpace((current) =>
      current?.id === prefillSpaceId
        ? current
        : ({
            id: prefillSpaceId,
            name: prefillSpaceName || "공간",
            status: "ACTIVE",
          } as SpaceListItem),
    );
  }, [prefillKey, prefillSpaceId, prefillSpaceName]);

  // Replace route-prefill snapshots with the current server policy before the
  // user confirms a send. The server still enforces the same rule atomically.
  useEffect(() => {
    if (!selectedSpace) return;
    const currentSpace = ((spacesQuery.data ?? []) as SpaceListItem[]).find(
      (space) => space.id === selectedSpace.id,
    );
    if (!currentSpace) return;
    const policyChanged =
      selectedSpace.isAnonymous !== currentSpace.isAnonymous;
    setSelectedSpace(currentSpace);
    if (policyChanged) {
      setSpaceLetterVisibility((previousVisibility) =>
        resolveSendSpaceLetterVisibilitySelection({
          previousSpace: selectedSpace,
          previousVisibility,
          nextSpace: currentSpace,
        }),
      );
    }
  }, [selectedSpace?.id, selectedSpace?.isAnonymous, spacesQuery.data]);

  // Only an entry-point source article can provide automatic defaults. A
  // manually chosen reply must remain empty until the user picks a letter.
  useEffect(() => {
    if (
      !initialDefaultsPendingRef.current ||
      !selectedArticle ||
      inboxQuery.isLoading
    )
      return;
    if (prefillNeighborId || prefillSpaceId) {
      initialDefaultsPendingRef.current = false;
      return;
    }
    const defaults = resolveInitialSendDefaults(
      selectedArticle,
      replyCandidates,
    );
    setMode(defaults.mode);
    setSelectedReplyInbox(defaults.replyInbox);
    initialDefaultsPendingRef.current = false;
  }, [
    inboxQuery.isLoading,
    prefillNeighborId,
    prefillSpaceId,
    replyCandidates,
    selectedArticle,
  ]);

  // Re-evaluate on every render so a screen kept open across the 06:00 KST
  // cutoff cannot keep accepting the previous day's date.
  const earliestDate = minOpeningSendDate();
  const spacePolicyReady =
    mode !== "space" || typeof selectedSpace?.isAnonymous === "boolean";
  const canSend = Boolean(
    currentSelectedArticle &&
    selectedArticleVerified &&
    spacePolicyReady &&
    ((mode === "person" && selectedNeighbor) ||
      (mode === "reply" && selectedReplyInbox) ||
      (mode === "space" && selectedSpace)),
  );
  const targetLabel =
    mode === "person"
      ? "받는 사람"
      : mode === "reply"
        ? "답장할 편지"
        : "보낼 공간";
  const targetValue =
    mode === "person"
      ? (selectedNeighbor?.user?.nickname ?? null)
      : mode === "reply"
        ? (selectedReplyInbox?.article?.title ?? null)
        : (selectedSpace?.name ?? null);

  const selectMode = useCallback((nextMode: SendMode) => {
    setMode(nextMode);
    setSendError(null);
    if (nextMode !== "person") setSelectedNeighbor(null);
    if (nextMode !== "reply") {
      setSelectedReplyInbox(null);
    }
    if (nextMode !== "space") {
      setSelectedSpace(null);
      setSpaceLetterVisibility("PUBLIC");
    }
  }, []);

  const handleSend = useCallback(
    async (isEnvelope = false) => {
      if (!displayedArticle || !canSend || !sendSubmissionLock.tryAcquire())
        return;
      setIsSubmitting(true);
      setSendError(null);

      try {
        const body: SendArticleBody = {
          senderId: userId,
          articleId: displayedArticle.id,
          targetType: mode,
          deliveryDate: calendarDateKey(deliveryDate),
          ...(mode === "person"
            ? {
                recipientId: selectedNeighbor!.neighborUserId,
                ...(isEnvelope ? { isEnvelope: true } : {}),
              }
            : mode === "reply"
              ? buildReplySendTarget(selectedReplyInbox!)
              : {
                  spaceId: selectedSpace!.id,
                  spaceLetterVisibility: selectedSpace!.isAnonymous
                    ? "RECIPIENT_ONLY"
                    : spaceLetterVisibility,
                }),
        };
        const result = await runAuthenticatedMutation<SendRecordWithDetails>({
          prepareSession: prepareAuthSession,
          mutate: () => sendArticle.mutateAsync({ data: body }),
        });
        setConfirmVisible(false);
        setRetryEnvelope(null);
        const returnedDate = result.deliveryDate
          ? new Date(`${result.deliveryDate}T06:00:00+09:00`)
          : kstDateAt6(deliveryDate);
        const arrivalTime = formatDeliveryTime(returnedDate);
        queryClient.invalidateQueries({
          queryKey: getListSendRecordsQueryKey({ senderId: userId }),
        });
        showToast({
          message:
            mode === "person"
              ? `${selectedNeighbor!.user?.nickname ?? "받는 사람"}에게 발신됐어요 · ${arrivalTime} 도착 예정`
              : mode === "reply"
                ? `답장을 발신했어요 · ${arrivalTime} 도착 예정`
                : `'${selectedSpace!.name}'에 발신됐어요 · ${arrivalTime} 도착 예정`,
          type: "success",
        });
        setSelectedArticle(null);
        setSelectedNeighbor(null);
        setSelectedReplyInbox(null);
        setSelectedSpace(null);
        onSent?.();
      } catch (error) {
        setConfirmVisible(false);
        setRetryEnvelope(isEnvelope);
        setSendError(getErrorMessage(error));
      } finally {
        sendSubmissionLock.release();
        setIsSubmitting(false);
      }
    },
    [
      canSend,
      deliveryDate,
      mode,
      onSent,
      queryClient,
      prepareAuthSession,
      displayedArticle,
      selectedArticle,
      selectedNeighbor,
      selectedReplyInbox,
      selectedSpace,
      spaceLetterVisibility,
      showToast,
      userId,
    ],
  );

  const confirmDescription = useMemo(() => {
    if (!selectedArticle || !targetValue) return "";
    const destination =
      mode === "person"
        ? `${targetValue}님에게`
        : mode === "reply"
          ? `'${targetValue}'에`
          : `'${targetValue}'에`;
    const visibilityDescription =
      mode === "space"
        ? `\n공개 범위: ${spaceLetterVisibility === "PUBLIC" ? "공개" : "비공개"}`
        : "";
    return `'${selectedArticle.title || "제목 없음"}'을(를)\n${destination} ${formatCalendarDate(
      deliveryDate,
    )} 오전 6시에 보내시겠어요?${visibilityDescription}`;
  }, [deliveryDate, mode, selectedArticle, spaceLetterVisibility, targetValue]);

  const openSendConfirmation = useCallback(() => {
    if (!canSend) return;
    if (mode === "space" && selectedSpace && displayedArticle) {
      onScheduleSpace(selectedSpace.id, displayedArticle.id);
      return;
    }
    if (mode === "person") {
      setPendingIsEnvelope(false);
      setEnvelopePromptVisible(true);
    } else {
      setConfirmVisible(true);
    }
  }, [
    canSend,
    displayedArticle,
    mode,
    onScheduleSpace,
    selectedSpace,
  ]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentInner, { paddingBottom: 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>보낼 편지</Text>
          {displayedArticle ? (
            <ArticleListItem
              articleId={displayedArticle.id}
              title={displayedArticle.title || "제목 없음"}
              authorName={getSendArticleAuthorName(displayedArticle)}
              cover={displayedArticle.cover}
              selected
              onPress={() => setLetterPickerVisible(true)}
              accessibilityLabel={`${displayedArticle.title || "제목 없음"} 편지 변경`}
            />
          ) : prefillArticleState.kind === "loading" ? (
            <View
              style={styles.articleLoading}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="선택한 편지를 불러오는 중"
              accessibilityState={{ busy: true }}
            >
              <ActivityIndicator size="small" color={Colors.zinc500} />
              <Text style={styles.placeholder}>
                선택한 편지를 불러오는 중...
              </Text>
            </View>
          ) : prefillArticleState.kind === "error" ||
            prefillArticleState.kind === "missing" ? (
            <View
              style={styles.articleLoadError}
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.articleLoadErrorText}>
                {prefillArticleState.kind === "error"
                  ? "선택한 편지를 불러오지 못했어요."
                  : "선택한 편지를 찾을 수 없어요."}
              </Text>
              <ScalePressable
                style={styles.articleRetryOuter}
                contentStyle={styles.articleRetry}
                onPress={() => articlesQuery.refetch()}
                accessibilityRole="button"
                accessibilityLabel="선택한 편지 다시 불러오기"
              >
                <Text style={styles.retryText}>다시 불러오기</Text>
              </ScalePressable>
            </View>
          ) : (
            <ScalePressable
              style={styles.articlePlaceholderOuter}
              contentStyle={styles.articlePlaceholder}
              onPress={() => setLetterPickerVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="보낼 편지를 선택하세요"
            >
              <Text style={styles.placeholder}>보낼 편지를 선택하세요</Text>
              <Feather name="chevron-right" size={18} color={Colors.zinc400} />
            </ScalePressable>
          )}
        </View>

        {mode === "space" && selectedSpace ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>공개 범위</Text>
            {!spacePolicyReady ? (
              <View
                style={styles.visibilityLoading}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="공간 공개 범위를 확인하는 중"
                accessibilityState={{ busy: true }}
              >
                <ActivityIndicator size="small" color={Colors.zinc500} />
                <Text style={styles.visibilityDescription}>
                  공간 공개 범위를 확인하는 중...
                </Text>
              </View>
            ) : (
              <>
                <View
                  style={styles.visibilityRow}
                  accessibilityRole="radiogroup"
                  accessibilityLabel="공간 편지 공개 범위"
                >
                  {(
                    [
                      ["PUBLIC", "공개", "공간 참여자가 볼 수 있어요"],
                      [
                        "RECIPIENT_ONLY",
                        "비공개",
                        "편지를 받은 사람만 볼 수 있어요",
                      ],
                    ] as const
                  ).map(([value, label, description]) => {
                    const selected = spaceLetterVisibility === value;
                    const disabled = selectedSpace.isAnonymous;
                    return (
                      <ScalePressable
                        key={value}
                        testID={`space-visibility-${value.toLowerCase()}`}
                        style={styles.visibilityButtonOuter}
                        contentStyle={[
                          styles.visibilityButton,
                          selected && styles.visibilityButtonSelected,
                          disabled && styles.visibilityButtonDisabled,
                        ]}
                        disabled={disabled}
                        onPress={() => {
                          setSpaceLetterVisibility(value);
                          setSendError(null);
                        }}
                        accessibilityRole="radio"
                        accessibilityLabel={`${label}, ${description}`}
                        accessibilityState={{ selected, disabled }}
                      >
                        <View
                          style={[
                            styles.radioCircle,
                            selected && styles.radioCircleSelected,
                          ]}
                        >
                          {selected ? <View style={styles.radioDot} /> : null}
                        </View>
                        <View style={styles.visibilityTextWrap}>
                          <Text style={styles.visibilityLabel}>{label}</Text>
                          <Text style={styles.visibilityDescription}>
                            {description}
                          </Text>
                        </View>
                      </ScalePressable>
                    );
                  })}
                </View>
                {selectedSpace.isAnonymous ? (
                  <View
                    style={styles.visibilityNotice}
                    accessible
                    accessibilityRole="text"
                  >
                    <Feather name="lock" size={15} color={Colors.zinc500} />
                    <Text style={styles.visibilityNoticeText}>
                      익명 공간은 참여자의 익명성을 위해 비공개로 고정돼요.
                    </Text>
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>보내기 종류</Text>
          <View style={styles.modeRow}>
            {(
              [
                ["person", "사람", "user"],
                ["reply", "답장", "corner-up-left"],
                ["space", "공간", "layers"],
              ] as const
            ).map(([value, label, icon]) => {
              const active = mode === value;
              return (
                <ScalePressable
                  key={value}
                  style={styles.modeButtonOuter}
                  contentStyle={[
                    styles.modeButton,
                    active && styles.modeButtonActive,
                  ]}
                  onPress={() => selectMode(value)}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: active }}
                >
                  <Feather
                    name={icon}
                    size={17}
                    color={active ? Colors.primaryAction : Colors.zinc600}
                  />
                  <Text
                    style={[styles.modeText, active && styles.modeTextActive]}
                  >
                    {label}
                  </Text>
                </ScalePressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{targetLabel}</Text>
          <ScalePressable
            style={styles.targetButtonOuter}
            contentStyle={styles.targetButton}
            onPress={() => {
              if (mode === "person") setNeighborPickerVisible(true);
              if (mode === "reply") setReplyPickerVisible(true);
              if (mode === "space") setSpacePickerVisible(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${targetLabel} 선택`}
          >
            <Feather
              name={
                mode === "person"
                  ? "user"
                  : mode === "reply"
                    ? "corner-up-left"
                    : "layers"
              }
              size={18}
              color={targetValue ? Colors.zinc900 : Colors.zinc500}
            />
            <Text
              style={[
                styles.targetText,
                targetValue && styles.targetTextActive,
              ]}
              numberOfLines={2}
            >
              {targetValue ?? `${targetLabel}를 선택하세요`}
            </Text>
            <Feather name="chevron-right" size={18} color={Colors.zinc400} />
          </ScalePressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>수신일</Text>
          <Text style={styles.sectionHint}>
            선택한 날짜 오전 6시에 도착해요.
          </Text>
          <CollapsibleDatePicker
            value={deliveryDate}
            onChange={(date) => {
              if (date >= earliestDate) {
                setDeliveryDate(date);
                setSendError(null);
              }
            }}
            onOpen={() => {
              const nextEarliest = minOpeningSendDate();
              if (deliveryDate < nextEarliest) {
                setDeliveryDate(nextEarliest);
                return nextEarliest;
              }
            }}
            isDateDisabled={(date) => date < earliestDate}
            canGoPrevMonth={(year, month) =>
              new Date(year, month + 1, 0) >= earliestDate
            }
            formatButtonLabel={(date) => formatCalendarDate(date)}
            triggerIcon="calendar"
            triggerStyle={styles.dateTrigger}
            triggerTextStyle={styles.dateTriggerText}
          />
        </View>

        {sendError ? (
          <View style={styles.errorBox} accessibilityLiveRegion="polite">
            <View style={styles.errorTextWrap}>
              <Feather
                name="alert-circle"
                size={18}
                color={Colors.noticeAccent}
              />
              <Text style={styles.errorText}>{sendError}</Text>
            </View>
            <ScalePressable
              style={styles.retryButtonOuter}
              contentStyle={styles.retryButton}
              onPress={() => handleSend(retryEnvelope ?? false)}
              disabled={isSubmitting}
              accessibilityState={{
                disabled: isSubmitting,
                busy: isSubmitting,
              }}
              accessibilityRole="button"
              accessibilityLabel="전송 다시 시도"
            >
              <Text style={styles.retryText}>다시 시도</Text>
            </ScalePressable>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: navBottom }]}>
        <SubmitButton
          style={styles.sendButton}
          disabledStyle={styles.sendButtonDisabled}
          contentStyle={styles.sendButtonContent}
          textStyle={styles.sendButtonText}
          disabledTextStyle={styles.sendButtonTextDisabled}
          onPress={openSendConfirmation}
          pending={isSubmitting}
          disabled={!canSend || prefillArticleState.kind === "loading"}
          label="보내기"
          pendingLabel="보내는 중..."
          renderIcon={({ disabled }) => (
            <Feather
              name="send"
              size={16}
              color={disabled ? Colors.zinc400 : Colors.white}
            />
          )}
        />
      </View>

      <LetterPickerSheet
        visible={letterPickerVisible}
        onClose={() => setLetterPickerVisible(false)}
        articles={articles}
        isLoading={articlesQuery.isLoading}
        isError={articlesQuery.isError}
        onRefetch={() => articlesQuery.refetch()}
        selectedId={selectedArticle?.id ?? null}
        onSelect={(article) => {
          const found = articles.find((item) => item.id === article.id);
          if (found) {
            initialDefaultsPendingRef.current = false;
            setSelectedArticle(found);
            setSelectedArticleKey(prefillKey);
            setSelectedArticleVerified(true);
          }
        }}
      />

      <NeighborPickerModal
        visible={neighborPickerVisible}
        onClose={() => setNeighborPickerVisible(false)}
        userId={userId}
        selectedNeighborId={selectedNeighbor?.neighborUserId ?? null}
        onSelect={(neighbor) => {
          setSelectedNeighbor(neighbor);
          setSendError(null);
        }}
      />
      <ReplyLetterPickerModal
        visible={replyPickerVisible}
        onClose={() => setReplyPickerVisible(false)}
        userId={userId}
        selectedInboxId={selectedReplyInbox?.id ?? null}
        onSelect={(item) => {
          setSelectedReplyInbox(item);
          setSendError(null);
        }}
      />
      <SpacePickerModal
        visible={spacePickerVisible}
        onClose={() => setSpacePickerVisible(false)}
        userId={userId}
        selectedSpaceId={selectedSpace?.id ?? null}
        onSelect={(space) => {
          setSpaceLetterVisibility((previousVisibility) =>
            resolveSendSpaceLetterVisibilitySelection({
              previousSpace: selectedSpace,
              previousVisibility,
              nextSpace: space,
            }),
          );
          setSelectedSpace(space);
          setSendError(null);
        }}
      />

      <ConfirmModal
        visible={envelopePromptVisible}
        title="봉투에 담아 발신할까요?"
        description="받는 사람이 봉투를 직접 개봉한 뒤 편지를 읽게 됩니다."
        confirmLabel="봉투로 보내기"
        cancelLabel="그냥 보내기"
        onConfirm={() => {
          setPendingIsEnvelope(true);
          setEnvelopePromptVisible(false);
          setConfirmVisible(true);
        }}
        onCancel={() => {
          setPendingIsEnvelope(false);
          setEnvelopePromptVisible(false);
          setConfirmVisible(true);
        }}
        onBackdropPress={() => setEnvelopePromptVisible(false)}
      />
      <ConfirmModal
        visible={confirmVisible}
        title="보내기"
        description={confirmDescription}
        confirmLabel="보내기"
        cancelLabel="취소"
        confirmDisabled={isSubmitting}
        cancelDisabled={isSubmitting}
        onConfirm={() => handleSend(pendingIsEnvelope)}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  content: { flex: 1 },
  contentInner: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 18,
    gap: 26,
  },
  section: { gap: 10 },
  sectionTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  sectionHint: { ...Typography.caption, color: Colors.zinc500, marginTop: -3 },
  articlePlaceholderOuter: { minHeight: 58 },
  articlePlaceholder: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.zinc50,
  },
  placeholder: {
    ...Typography.body,
    flex: 1,
    fontSize: 14,
    color: Colors.zinc500,
  },
  articleLoading: {
    height: 104,
    marginHorizontal: Spacing.screenPx,
    marginBottom: Spacing.cardGap,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: Colors.zinc50,
  },
  articleLoadError: {
    minHeight: 104,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: Colors.zinc50,
  },
  articleLoadErrorText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
  },
  articleRetryOuter: {
    height: 40,
    alignSelf: "flex-start",
    flexGrow: 0,
    flexShrink: 0,
  },
  articleRetry: {
    height: 40,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 9,
    backgroundColor: Colors.noticeAccent,
  },
  modeRow: { flexDirection: "row", gap: 8 },
  modeButtonOuter: { flex: 1, minHeight: 48 },
  modeButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
  },
  modeButtonActive: {
    borderColor: Colors.primaryAction,
    backgroundColor: Colors.noticeAccentSoft,
  },
  modeText: { ...Typography.bodySemiBold, fontSize: 14, color: Colors.zinc600 },
  modeTextActive: { color: Colors.primaryAction },
  targetButtonOuter: { minHeight: 58 },
  targetButton: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.zinc50,
  },
  targetText: {
    ...Typography.body,
    flex: 1,
    fontSize: 14,
    color: Colors.zinc500,
  },
  targetTextActive: { color: Colors.zinc900, fontWeight: "600" },
  visibilityRow: { gap: 8 },
  visibilityLoading: {
    height: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: Colors.zinc50,
  },
  visibilityButtonOuter: {
    width: "100%",
    height: 62,
    flexGrow: 0,
    flexShrink: 0,
  },
  visibilityButton: {
    width: "100%",
    height: 62,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
  },
  visibilityButtonSelected: {
    borderColor: Colors.noticeAccent,
    backgroundColor: Colors.zinc50,
  },
  visibilityButtonDisabled: { opacity: 0.72 },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.zinc300,
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 0,
    flexShrink: 0,
  },
  radioCircleSelected: {
    borderColor: Colors.noticeAccent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.noticeAccent,
  },
  visibilityTextWrap: { flex: 1, gap: 2 },
  visibilityLabel: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc900,
  },
  visibilityDescription: { ...Typography.caption, color: Colors.zinc500 },
  visibilityNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    paddingHorizontal: 2,
  },
  visibilityNoticeText: {
    ...Typography.caption,
    flex: 1,
    color: Colors.zinc500,
  },
  dateTrigger: { backgroundColor: Colors.zinc50 },
  dateTriggerText: { color: Colors.zinc900 },
  errorBox: {
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e9b8bd",
    backgroundColor: "#fff7f7",
  },
  errorTextWrap: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  errorText: {
    ...Typography.body,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.noticeAccent,
  },
  retryButtonOuter: { alignSelf: "flex-start", minHeight: 40 },
  retryButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 9,
    backgroundColor: Colors.noticeAccent,
  },
  retryText: { ...Typography.bodySemiBold, fontSize: 13, color: Colors.white },
  footer: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  sendButton: {
    backgroundColor: Colors.primaryAction,
    paddingVertical: 16,
    borderRadius: 12,
  },
  sendButtonContent: { gap: 8 },
  sendButtonDisabled: { backgroundColor: Colors.zinc100 },
  sendButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.primaryActionForeground,
  },
  sendButtonTextDisabled: { color: Colors.zinc400 },
});
