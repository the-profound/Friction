import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Modal,
  Animated,
  PanResponder,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import DotIndicator from "@/components/DotIndicator/DotIndicator";
import CardSelectOverlay, { type OriginLayout, type ChainArticleMeta } from "@/components/CardSelectOverlay/CardSelectOverlay";
import { useUser } from "@/contexts/UserContext";
import {
  useGetSpaceJoinContext,
  getGetSpaceJoinContextQueryKey,
  useListSpaceRounds,
  useListSpaceLetters,
  useListSpaceCodeRequests,
  useUpdateSpaceCodeRequest,
  useUpdateSpace,
  ListSpaceCodeRequestsStatus,
  getArticle,
  getGetArticleQueryKey,
} from "@workspace/api-client-react";
import type {
  SpaceRound,
  SpaceLetter,
  SpaceCodeRequestWithRequester,
  SpaceWithCreatorInfo,
  Article,
} from "@workspace/api-client-react";

// ─── Carousel constants (mirrors index.tsx) ───────────────────────────────────

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = Sizing.cardSlotW;
const CARD_H = Sizing.cardH;
const CARD_GAP = Spacing.cardGap;
const SNAP_INTERVAL = CARD_W + CARD_GAP;
const SNAP_THRESHOLD = 48;
const FLING_VELOCITY = 0.5;
const CENTER_OFFSET = (SCREEN_W - CARD_W) / 2;

function getBaseX(idx: number) {
  return -(idx * SNAP_INTERVAL) + CENTER_OFFSET;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function spaceStatusLabel(status: string): string {
  if (status === "ACTIVE") return "진행 중";
  if (status === "RECRUITING") return "모집 중";
  if (status === "ARCHIVED") return "종료";
  return status;
}

function spaceStatusColor(status: string): string {
  if (status === "ACTIVE") return Colors.noticeAccent;
  if (status === "RECRUITING") return Colors.zinc500;
  return Colors.zinc300;
}

function roundStatusLabel(status: string): string {
  if (status === "ACTIVE") return "진행 중";
  if (status === "UPCOMING") return "예정";
  if (status === "COMPLETED") return "완료";
  return status;
}

function roundStatusColor(status: string): string {
  if (status === "ACTIVE") return Colors.noticeAccent;
  if (status === "UPCOMING") return Colors.zinc400;
  return Colors.zinc300;
}

// ─── Space Carousel ───────────────────────────────────────────────────────────
// Mirrors the CarouselGroup pattern from the inbox (index.tsx):
//   Web  → PanResponder + Animated translate
//   Native → horizontal ScrollView with snap

function SpaceCarousel({
  letters,
  isAnonymous,
  onCardPress,
}: {
  letters: SpaceLetter[];
  isAnonymous: boolean;
  onCardPress: (letter: SpaceLetter, layout: OriginLayout) => void;
}) {
  const itemCount = letters.length;
  const [activeIndex, setActiveIndex] = useState(0);

  const cardSlotRefs = useRef<(View | null)[]>([]);

  const activeIndexRef = useRef(0);
  const itemCountRef = useRef(itemCount);
  const translateX = useRef(new Animated.Value(getBaseX(0))).current;
  const swipedRef = useRef(false);

  useEffect(() => {
    itemCountRef.current = itemCount;
    const clamped = Math.min(activeIndexRef.current, itemCount - 1);
    if (clamped !== activeIndexRef.current) {
      activeIndexRef.current = clamped;
      setActiveIndex(clamped);
      translateX.setValue(getBaseX(clamped));
    }
  }, [itemCount, translateX]);

  const snapToRef = useRef((_idx: number) => {});
  snapToRef.current = (idx: number) => {
    const clamped = Math.max(0, Math.min(idx, itemCountRef.current - 1));
    activeIndexRef.current = clamped;
    setActiveIndex(clamped);
    Animated.spring(translateX, {
      toValue: getBaseX(clamped),
      useNativeDriver: false,
      overshootClamping: true,
      tension: 100,
      friction: 20,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        swipedRef.current = false;
        return false;
      },
      onMoveShouldSetPanResponder: (_, g) =>
        itemCountRef.current > 1 &&
        Math.abs(g.dx) > Math.abs(g.dy) &&
        Math.abs(g.dx) > 5,
      onPanResponderGrant: () => {
        translateX.setValue(getBaseX(activeIndexRef.current));
      },
      onPanResponderMove: (_, g) => {
        if (Math.abs(g.dx) > 15) {
          swipedRef.current = true;
        }
        const baseX = getBaseX(activeIndexRef.current);
        const raw = baseX + g.dx;
        const maxX = getBaseX(0);
        const minX = getBaseX(itemCountRef.current - 1);
        const rubber =
          raw > maxX
            ? maxX + (raw - maxX) * 0.3
            : raw < minX
              ? minX + (raw - minX) * 0.3
              : raw;
        translateX.setValue(rubber);
      },
      onPanResponderRelease: (_, g) => {
        const { dx, vx } = g;
        const current = activeIndexRef.current;
        let next = current;
        if (Math.abs(vx) > FLING_VELOCITY) {
          next = vx < 0 ? current + 1 : current - 1;
        } else if (Math.abs(dx) >= SNAP_THRESHOLD) {
          next = dx < 0 ? current + 1 : current - 1;
        }
        snapToRef.current(next);
        setTimeout(() => { swipedRef.current = false; }, 100);
      },
      onPanResponderTerminate: (_, g) => {
        const { dx, vx } = g;
        const current = activeIndexRef.current;
        let next = current;
        if (Math.abs(vx) > FLING_VELOCITY) {
          next = vx < 0 ? current + 1 : current - 1;
        } else if (Math.abs(dx) >= SNAP_THRESHOLD) {
          next = dx < 0 ? current + 1 : current - 1;
        }
        snapToRef.current(next);
        setTimeout(() => { swipedRef.current = false; }, 100);
      },
    }),
  ).current;

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      const index = Math.round(offsetX / SNAP_INTERVAL);
      setActiveIndex(Math.max(0, Math.min(index, itemCount - 1)));
    },
    [itemCount],
  );

  const cards = letters.map((letter, index) => {
    const authorNickname = (letter as any).authorNickname as string | null;
    const displayName = (letter as any).displayName as string | null;
    const title = (letter as any).articleTitle as string | null;
    const authorName = isAnonymous
      ? (displayName ?? "익명")
      : (authorNickname ?? "알 수 없음");

    const handlePress = () => {
      if (Platform.OS === "web" && swipedRef.current) return;
      const slotRef = cardSlotRefs.current[index];
      if (slotRef) {
        slotRef.measureInWindow((x, y, width, height) => {
          onCardPress(letter, { x, y, width, height });
        });
      } else {
        onCardPress(letter, { x: 0, y: 0, width: CARD_W, height: CARD_H });
      }
    };

    return (
      <View
        key={letter.id}
        ref={(ref) => { cardSlotRefs.current[index] = ref; }}
        style={[
          spaceCarouselStyles.cardSlot,
          index < letters.length - 1 && { marginRight: CARD_GAP },
        ]}
      >
        <ArticleCardItem
          title={title ?? "제목 없음"}
          authorName={authorName}
          cover={null}
          isRead={false}
          isActive={index === activeIndex}
          onPress={handlePress}
        />
      </View>
    );
  });

  return (
    <View>
      {Platform.OS === "web" ? (
        <View
          style={[
            spaceCarouselStyles.carouselWindow,
            { userSelect: "none", cursor: "grab" } as object,
          ]}
          {...panResponder.panHandlers}
        >
          <Animated.View
            style={[spaceCarouselStyles.carouselTrack, { transform: [{ translateX }] }]}
          >
            {cards}
          </Animated.View>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={SNAP_INTERVAL}
          snapToAlignment="start"
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={handleScroll}
          contentContainerStyle={spaceCarouselStyles.carouselContent}
          style={spaceCarouselStyles.carouselScroll}
        >
          {cards}
        </ScrollView>
      )}
      <DotIndicator total={letters.length} activeIndex={activeIndex} />
    </View>
  );
}

const spaceCarouselStyles = StyleSheet.create({
  carouselWindow: {
    width: SCREEN_W,
    height: CARD_H,
    overflow: "hidden",
  },
  carouselTrack: {
    flexDirection: "row",
    height: CARD_H,
  },
  carouselScroll: {
    height: CARD_H,
  },
  carouselContent: {
    paddingHorizontal: CENTER_OFFSET,
  },
  cardSlot: {
    width: CARD_W,
  },
});

// ─── Round Section ────────────────────────────────────────────────────────────

function RoundSection({
  round,
  letters,
  spaceStatus,
  isOperator,
  isAnonymous,
  onPressLetter,
  onPressWriteOpening,
}: {
  round: SpaceRound;
  letters: SpaceLetter[];
  spaceStatus: string;
  isOperator: boolean;
  isAnonymous: boolean;
  onPressLetter: (letter: SpaceLetter, layout: OriginLayout) => void;
  onPressWriteOpening: (round: SpaceRound) => void;
}) {
  const statusColor = roundStatusColor(round.status);
  const isUpcoming = round.status === "UPCOMING";
  const isSpaceRecruiting = spaceStatus === "RECRUITING";
  const isSpaceArchived = spaceStatus === "ARCHIVED";

  const hasOpeningLetter = letters.some((l) => l.letterType === "OPENING");

  // Opening-letter CTA/notice: shown when active and opening letter is missing,
  // regardless of whether other letter types (CENTER/REPLY) exist.
  const openingArea: React.ReactNode =
    !isUpcoming && !isSpaceRecruiting && !hasOpeningLetter && !isSpaceArchived
      ? isOperator
        ? (
          <ScalePressable
            style={styles.writeOpeningBtn}
            onPress={() => onPressWriteOpening(round)}
          >
            <Feather name="plus" size={14} color={Colors.zinc600} />
            <Text style={styles.writeOpeningBtnText}>여는 편지 작성</Text>
          </ScalePressable>
        )
        : (
          <View style={styles.preparingArea}>
            <Text style={styles.preparingText}>여는 편지를 준비 중이에요</Text>
          </View>
        )
      : null;

  let letterArea: React.ReactNode;

  if (isUpcoming) {
    letterArea = (
      <View style={styles.lockedArea}>
        <Feather name="lock" size={20} color={Colors.zinc300} />
        <Text style={styles.lockedText}>회차 시작 후 공개</Text>
      </View>
    );
  } else if (isSpaceRecruiting) {
    letterArea = (
      <View style={styles.lockedArea}>
        <Feather name="clock" size={20} color={Colors.zinc300} />
        <Text style={styles.lockedText}>공간 시작 후 공개</Text>
      </View>
    );
  } else if (letters.length > 0) {
    letterArea = (
      <SpaceCarousel
        letters={letters}
        isAnonymous={isAnonymous}
        onCardPress={onPressLetter}
      />
    );
  } else {
    letterArea = null;
  }

  return (
    <View style={styles.roundSection}>
      <View style={styles.roundSectionHeader}>
        <View style={styles.roundSectionLeft}>
          <View style={[styles.roundStatusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.roundStatusText, { color: statusColor }]}>
            {roundStatusLabel(round.status)}
          </Text>
          <Text style={styles.roundNumberText}>{round.roundNumber}회차</Text>
          {round.title ? (
            <Text style={styles.roundTitleText} numberOfLines={1}>
              {round.title}
            </Text>
          ) : null}
        </View>
        {!isUpcoming && !isSpaceRecruiting && letters.length > 0 && (
          <Text style={styles.roundLetterCount}>{letters.length}편</Text>
        )}
      </View>
      {round.description ? (
        <Text style={styles.roundDescription} numberOfLines={2}>
          {round.description}
        </Text>
      ) : null}
      {openingArea ? (
        <View style={styles.roundOpeningArea}>{openingArea}</View>
      ) : null}
      {letterArea ? (
        <View style={styles.roundLetterArea}>{letterArea}</View>
      ) : null}
      {!openingArea && !letterArea && !isUpcoming && !isSpaceRecruiting ? (
        <View style={styles.preparingArea}>
          <Text style={styles.preparingText}>편지 없음</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Code Request Item ────────────────────────────────────────────────────────

function CodeRequestItem({
  item,
  onApprove,
  onReject,
  processing,
  recruitmentClosed,
}: {
  item: SpaceCodeRequestWithRequester;
  onApprove: () => void;
  onReject: () => void;
  processing: boolean;
  recruitmentClosed: boolean;
}) {
  return (
    <View style={styles.codeRequestItem}>
      <View style={styles.codeRequestLeft}>
        <View style={styles.codeRequestAvatarPlaceholder}>
          <Feather name="user" size={14} color={Colors.zinc500} />
        </View>
        <View style={styles.codeRequestMeta}>
          <Text style={styles.codeRequestNickname} numberOfLines={1}>
            {item.requesterNickname ?? "알 수 없음"}
          </Text>
          <Text style={styles.codeRequestCode}>
            코드: {item.codeRequest.code}
          </Text>
        </View>
      </View>
      <View style={styles.codeRequestActions}>
        <ScalePressable
          style={[styles.actionBtn, styles.rejectBtn]}
          onPress={onReject}
          disabled={processing}
        >
          <Text style={styles.rejectBtnText}>거절</Text>
        </ScalePressable>
        <ScalePressable
          style={[
            styles.actionBtn,
            styles.approveBtn,
            recruitmentClosed && styles.approveBtnDisabled,
          ]}
          onPress={recruitmentClosed ? undefined : onApprove}
          disabled={processing || recruitmentClosed}
        >
          <Text style={styles.approveBtnText}>
            {processing ? "처리 중" : recruitmentClosed ? "마감" : "승인"}
          </Text>
        </ScalePressable>
      </View>
    </View>
  );
}

// ─── Android Rejection Reason Modal ──────────────────────────────────────────

function RejectReasonModal({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const insets = useSafeAreaInsets();

  const handleConfirm = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      Alert.alert("알림", "거절 사유를 입력해주세요.");
      return;
    }
    onConfirm(trimmed);
    setReason("");
  };

  const handleCancel = () => {
    setReason("");
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={modalStyles.backdrop}>
        <View style={[modalStyles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={modalStyles.title}>거절 사유 입력</Text>
          <Text style={modalStyles.subtitle}>
            사유를 입력해주세요. 현재는 운영자에게만 기록됩니다.
          </Text>
          <TextInput
            style={modalStyles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="거절 사유를 입력하세요"
            placeholderTextColor={Colors.zinc400}
            multiline
            autoFocus
            maxLength={200}
          />
          <View style={modalStyles.btnRow}>
            <ScalePressable style={[modalStyles.btn, modalStyles.cancelBtn]} onPress={handleCancel}>
              <Text style={modalStyles.cancelBtnText}>취소</Text>
            </ScalePressable>
            <ScalePressable style={[modalStyles.btn, modalStyles.confirmBtn]} onPress={handleConfirm}>
              <Text style={modalStyles.confirmBtnText}>거절</Text>
            </ScalePressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Description section ──────────────────────────────────────────────────────

function DescriptionSection({
  space,
  isOperator,
  userId,
  onSaved,
}: {
  space: SpaceWithCreatorInfo;
  isOperator: boolean;
  userId: string;
  onSaved: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const updateSpace = useUpdateSpace();

  const handleStart = useCallback(() => {
    setDraft(space.description ?? "");
    setIsEditing(true);
  }, [space.description]);

  const handleSave = useCallback(() => {
    Alert.alert(
      "설명 변경",
      "저장하면 현재 참여자 모두에게 변경된 설명이 바로 보입니다.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "저장",
          onPress: async () => {
            setSaving(true);
            try {
              await updateSpace.mutateAsync({
                id: space.id,
                data: { description: draft.trim() || null },
              });
              setIsEditing(false);
              onSaved();
            } catch {
              Alert.alert("오류", "저장에 실패했어요. 다시 시도해주세요.");
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  }, [space.id, draft, updateSpace, onSaved]);

  if (isEditing) {
    return (
      <View style={styles.descEditContainer}>
        <TextInput
          style={styles.descInput}
          value={draft}
          onChangeText={setDraft}
          multiline
          placeholder="공간 설명을 입력해주세요"
          placeholderTextColor={Colors.zinc400}
          autoFocus
          maxLength={200}
        />
        <View style={styles.descEditButtons}>
          <ScalePressable
            style={[styles.descEditBtn, styles.descCancelBtn]}
            onPress={() => setIsEditing(false)}
            disabled={saving}
          >
            <Text style={styles.descCancelBtnText}>취소</Text>
          </ScalePressable>
          <ScalePressable
            style={[styles.descEditBtn, styles.descSaveBtn]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.descSaveBtnText}>
              {saving ? "저장 중..." : "저장"}
            </Text>
          </ScalePressable>
        </View>
      </View>
    );
  }

  return (
    <ScalePressable
      style={styles.descRow}
      onPress={isOperator ? handleStart : undefined}
      disabled={!isOperator}
    >
      {space.description ? (
        <Text style={styles.spaceDesc}>{space.description}</Text>
      ) : (
        <Text style={styles.spaceDescEmpty}>
          {isOperator ? "+ 설명 추가하기" : "설명 없음"}
        </Text>
      )}
      {isOperator && (
        <Feather
          name="edit-2"
          size={13}
          color={Colors.zinc400}
          style={styles.descEditIcon}
        />
      )}
    </ScalePressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SpaceDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useUser();
  const queryClient = useQueryClient();

  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);

  // ── Card select overlay state ─────────────────────────────────────────────
  const [tapLetter, setTapLetter] = useState<SpaceLetter | null>(null);
  const [tapLetterOrigin, setTapLetterOrigin] = useState<OriginLayout | null>(null);
  const [tapArticle, setTapArticle] = useState<Article | null>(null);

  const joinContextQuery = useGetSpaceJoinContext(
    id,
    { userId },
    { query: { enabled: !!id && !!userId } },
  );

  const roundsQuery = useListSpaceRounds(id, {
    query: { enabled: !!id },
  });

  const lettersQuery = useListSpaceLetters(id, {
    query: { enabled: !!id },
  });

  const joinContext = joinContextQuery.data;
  const space = joinContext?.space;
  const myParticipation = joinContext?.participation;
  const isOperator = myParticipation?.role === "OPERATOR";
  const isArchived = space?.status === "ARCHIVED";
  const isRecruiting = space?.status === "RECRUITING";

  // Recruitment is closed when the space is no longer in RECRUITING status
  // OR when the participant cap has been reached.
  const recruitmentClosed =
    space?.status !== "RECRUITING" ||
    !!(space?.maxParticipants && space.participantCount >= space.maxParticipants);

  const codeRequestsQuery = useListSpaceCodeRequests(
    id,
    { status: ListSpaceCodeRequestsStatus.PENDING },
    { query: { enabled: !!id && isOperator } },
  );

  const updateCodeRequest = useUpdateSpaceCodeRequest();

  const rounds = (roundsQuery.data ?? []) as SpaceRound[];
  const letters = (lettersQuery.data ?? []) as SpaceLetter[];
  const codeRequests = (
    codeRequestsQuery.data ?? []
  ) as SpaceCodeRequestWithRequester[];

  const lettersByRound = useMemo<Record<string, SpaceLetter[]>>(() => {
    const map: Record<string, SpaceLetter[]> = {};
    for (const letter of letters) {
      const key = letter.spaceRoundId ?? "__none__";
      (map[key] ??= []).push(letter);
    }
    return map;
  }, [letters]);

  const isLoading = joinContextQuery.isLoading;
  const isError = joinContextQuery.isError;
  const isRefreshing =
    joinContextQuery.isFetching ||
    roundsQuery.isFetching ||
    lettersQuery.isFetching ||
    (isOperator && codeRequestsQuery.isFetching);

  const refetchAll = useCallback(async () => {
    await Promise.all([
      joinContextQuery.refetch(),
      roundsQuery.refetch(),
      lettersQuery.refetch(),
      isOperator ? codeRequestsQuery.refetch() : Promise.resolve(),
    ]);
  }, [joinContextQuery, roundsQuery, lettersQuery, codeRequestsQuery, isOperator]);

  const handleDescriptionSaved = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: getGetSpaceJoinContextQueryKey(id, { userId }),
    });
  }, [queryClient, id, userId]);

  const handleApprove = useCallback(
    async (requestId: string) => {
      if (processingRequestId) return;
      setProcessingRequestId(requestId);
      try {
        await updateCodeRequest.mutateAsync({
          id,
          requestId,
          data: { status: "APPROVED" },
        });
        await codeRequestsQuery.refetch();
      } catch {
        Alert.alert("오류", "승인에 실패했어요. 다시 시도해주세요.");
      } finally {
        setProcessingRequestId(null);
      }
    },
    [processingRequestId, updateCodeRequest, id, codeRequestsQuery],
  );

  const handleReject = useCallback(
    (requestId: string) => {
      if (processingRequestId) return;
      if (Platform.OS === "ios") {
        Alert.prompt(
          "거절 사유",
          "사유를 입력해주세요. 현재는 운영자에게만 기록됩니다.",
          async (reason) => {
            if (reason === undefined) return;
            const trimmed = reason.trim();
            if (!trimmed) {
              Alert.alert("알림", "거절 사유를 입력해주세요.");
              return;
            }
            setProcessingRequestId(requestId);
            try {
              await updateCodeRequest.mutateAsync({
                id,
                requestId,
                data: { status: "REJECTED", rejectionReason: trimmed },
              });
              await codeRequestsQuery.refetch();
            } catch {
              Alert.alert("오류", "거절에 실패했어요. 다시 시도해주세요.");
            } finally {
              setProcessingRequestId(null);
            }
          },
          "plain-text",
        );
      } else {
        setRejectTargetId(requestId);
      }
    },
    [processingRequestId, updateCodeRequest, id, codeRequestsQuery],
  );

  const handleRejectConfirm = useCallback(
    async (reason: string) => {
      const requestId = rejectTargetId;
      if (!requestId) return;
      setRejectTargetId(null);
      setProcessingRequestId(requestId);
      try {
        await updateCodeRequest.mutateAsync({
          id,
          requestId,
          data: { status: "REJECTED", rejectionReason: reason },
        });
        await codeRequestsQuery.refetch();
      } catch {
        Alert.alert("오류", "거절에 실패했어요. 다시 시도해주세요.");
      } finally {
        setProcessingRequestId(null);
      }
    },
    [rejectTargetId, updateCodeRequest, id, codeRequestsQuery],
  );

  const handlePressLetter = useCallback(
    (letter: SpaceLetter, layout: OriginLayout) => {
      setTapLetter(letter);
      setTapLetterOrigin(layout);
      setTapArticle(null);
      if (letter.sourceArticleId) {
        queryClient.fetchQuery({
          queryKey: getGetArticleQueryKey(letter.sourceArticleId),
          queryFn: () => getArticle(letter.sourceArticleId!),
          staleTime: 5 * 60 * 1000,
        }).then((article) => {
          setTapArticle(article as Article);
        }).catch(() => {});
      }
    },
    [queryClient],
  );

  const handleOverlayClose = useCallback(() => {
    setTapLetter(null);
    setTapLetterOrigin(null);
    setTapArticle(null);
  }, []);

  const handleOverlayRead = useCallback(() => {
    const letter = tapLetter;
    setTapLetter(null);
    setTapLetterOrigin(null);
    setTapArticle(null);
    if (!letter?.sourceArticleId) return;
    router.push({
      pathname: "/read" as never,
      params: { articleId: letter.sourceArticleId },
    });
  }, [tapLetter, router]);

  const handlePressWriteOpening = useCallback(
    (_round: SpaceRound) => {
      router.push({
        pathname: "/of-space-schedule-send" as never,
        params: { id },
      });
    },
    [router, id],
  );

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <ScalePressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={20} color={Colors.zinc600} />
          </ScalePressable>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator color={Colors.zinc400} />
        </View>
      </View>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────────────
  if (isError || !space) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <ScalePressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={20} color={Colors.zinc600} />
          </ScalePressable>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.centerContainer}>
          <Feather name="alert-circle" size={36} color={Colors.zinc300} />
          <Text style={styles.errorText}>공간을 불러오지 못했어요</Text>
          <ScalePressable style={styles.retryButton} onPress={refetchAll}>
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </ScalePressable>
        </View>
      </View>
    );
  }

  // ─── Non-participant ────────────────────────────────────────────────────────
  if (!myParticipation) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <ScalePressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={20} color={Colors.zinc600} />
          </ScalePressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {space.name}
          </Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.centerContainer}>
          <Feather name="lock" size={36} color={Colors.zinc300} />
          <Text style={styles.errorText}>참여하지 않은 공간이에요</Text>
          <Text style={styles.errorSubText}>
            초대 코드로 참여 신청 후 운영자 승인을 받으세요
          </Text>
          <ScalePressable style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryButtonText}>돌아가기</Text>
          </ScalePressable>
        </View>
      </View>
    );
  }

  const statusColor = spaceStatusColor(space.status);
  const statusText = spaceStatusLabel(space.status);

  // ─── Main content ───────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Android rejection reason modal */}
      <RejectReasonModal
        visible={!!rejectTargetId}
        onCancel={() => setRejectTargetId(null)}
        onConfirm={handleRejectConfirm}
      />

      {/* Header */}
      <View style={styles.header}>
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {space.name}
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refetchAll}
            tintColor={Colors.zinc400}
          />
        }
      >
        {/* ── Space info card ── */}
        <View style={styles.infoCard}>
          <View style={styles.badgeRow}>
            <View style={[styles.statusBadge, { borderColor: statusColor }]}>
              <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                {statusText}
              </Text>
            </View>
            {isArchived && (
              <View style={[styles.statusBadge, { borderColor: Colors.zinc300 }]}>
                <Text style={[styles.statusBadgeText, { color: Colors.zinc400 }]}>
                  종료됨
                </Text>
              </View>
            )}
            <Text style={styles.roleBadge}>
              {isOperator ? "운영자" : "참여자"}
            </Text>
            {space.isAnonymous && (
              <View style={styles.anonBadge}>
                <Feather name="eye-off" size={10} color={Colors.zinc400} />
                <Text style={styles.anonBadgeText}>익명</Text>
              </View>
            )}
          </View>

          <Text style={styles.spaceName}>{space.name}</Text>

          <DescriptionSection
            space={space}
            isOperator={isOperator}
            userId={userId}
            onSaved={handleDescriptionSaved}
          />

          <View style={styles.metaRow}>
            <Feather name="users" size={13} color={Colors.zinc400} />
            <Text style={styles.metaText}>
              {space.participantCount}
              {space.maxParticipants ? `/${space.maxParticipants}명` : "명"}
            </Text>
            <View style={styles.metaDot} />
            <Feather name="repeat" size={13} color={Colors.zinc400} />
            <Text style={styles.metaText}>{space.roundCount}회차 계획</Text>
          </View>
        </View>

        {/* ── Rounds sections ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>회차</Text>
          </View>
          {roundsQuery.isLoading ? (
            <View style={styles.sectionLoading}>
              <ActivityIndicator size="small" color={Colors.zinc400} />
            </View>
          ) : rounds.length === 0 ? (
            <View style={styles.emptySection}>
              <Text style={styles.emptySectionText}>
                {isOperator ? "아직 회차가 없어요" : "진행 중인 회차가 없어요"}
              </Text>
            </View>
          ) : (
            <View style={styles.roundsList}>
              {rounds.map((round) => (
                <RoundSection
                  key={round.id}
                  round={round}
                  letters={lettersByRound[round.id] ?? []}
                  spaceStatus={space.status}
                  isOperator={isOperator}
                  isAnonymous={space.isAnonymous}
                  onPressLetter={handlePressLetter}
                  onPressWriteOpening={handlePressWriteOpening}
                />
              ))}
            </View>
          )}
        </View>

        {/* ── Code requests (operator only) ── */}
        {isOperator && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>참여 요청</Text>
              {codeRequests.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{codeRequests.length}</Text>
                </View>
              )}
            </View>
            {recruitmentClosed && (
              <View style={styles.recruitmentClosedBanner}>
                <Feather name="slash" size={13} color={Colors.zinc500} />
                <Text style={styles.recruitmentClosedText}>모집이 마감되었어요</Text>
              </View>
            )}
            {codeRequestsQuery.isLoading ? (
              <View style={styles.sectionLoading}>
                <ActivityIndicator size="small" color={Colors.zinc400} />
              </View>
            ) : codeRequests.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.emptySectionText}>
                  대기 중인 요청이 없어요
                </Text>
              </View>
            ) : (
              <View style={styles.codeRequestList}>
                {codeRequests.map((item) => (
                  <CodeRequestItem
                    key={item.codeRequest.id}
                    item={item}
                    onApprove={() => handleApprove(item.codeRequest.id)}
                    onReject={() => handleReject(item.codeRequest.id)}
                    processing={processingRequestId === item.codeRequest.id}
                    recruitmentClosed={recruitmentClosed}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── Invite code (operator only) ── */}
        {isOperator && space.inviteCode && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>초대 코드</Text>
            </View>
            <View style={styles.inviteCodeCard}>
              <Text style={styles.inviteCode}>{space.inviteCode}</Text>
              <Text style={styles.inviteCodeHint}>
                참여자에게 이 코드를 공유하세요
              </Text>
            </View>
          </View>
        )}

        {/* ── Operator management actions ── */}
        {isOperator && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>운영 관리</Text>
            </View>
            <View style={styles.operatorActions}>
              <ScalePressable
                style={styles.operatorActionRow}
                onPress={() =>
                  router.push({
                    pathname: "/of-space-rounds" as never,
                    params: { id, spaceName: space.name },
                  })
                }
              >
                <View style={styles.operatorActionLeft}>
                  <View style={styles.operatorActionIcon}>
                    <Feather name="layers" size={15} color={Colors.zinc600} />
                  </View>
                  <Text style={styles.operatorActionText}>회차 관리</Text>
                </View>
                <Feather name="chevron-right" size={16} color={Colors.zinc400} />
              </ScalePressable>

              {!isArchived && (
                <>
                  <View style={styles.operatorDivider} />
                  <ScalePressable
                    style={styles.operatorActionRow}
                    onPress={() =>
                      router.push({
                        pathname: "/of-space-schedule-send" as never,
                        params: { id },
                      })
                    }
                  >
                    <View style={styles.operatorActionLeft}>
                      <View style={styles.operatorActionIcon}>
                        <Feather name="send" size={15} color={Colors.zinc600} />
                      </View>
                      <Text style={styles.operatorActionText}>글 예약 발송</Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={Colors.zinc400} />
                  </ScalePressable>
                </>
              )}

              {!isArchived && (
                <>
                  <View style={styles.operatorDivider} />
                  <ScalePressable
                    style={styles.operatorActionRow}
                    onPress={() =>
                      router.push({
                        pathname: "/of-space-archive" as never,
                        params: { id, spaceName: space.name },
                      })
                    }
                  >
                    <View style={styles.operatorActionLeft}>
                      <View style={styles.operatorActionIcon}>
                        <Feather name="archive" size={15} color={Colors.zinc400} />
                      </View>
                      <Text style={[styles.operatorActionText, { color: Colors.zinc400 }]}>
                        공간 보관
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={Colors.zinc300} />
                  </ScalePressable>
                </>
              )}
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Card select overlay ── */}
      {(() => {
        if (!tapLetter) return null;
        const authorNickname = (tapLetter as any).authorNickname as string | null;
        const displayName = (tapLetter as any).displayName as string | null;
        const authorName = space.isAnonymous
          ? (displayName ?? "익명")
          : (authorNickname ?? "알 수 없음");
        const meta: ChainArticleMeta = {
          authorName,
          date: tapLetter.createdAt,
          collectionName: space.name,
        };
        return (
          <CardSelectOverlay
            articles={[tapArticle]}
            metas={[meta]}
            initialIndex={0}
            originLayout={tapLetterOrigin}
            onClose={handleOverlayClose}
            onRead={handleOverlayRead}
          />
        );
      })()}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 8,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: Spacing.screenPx,
  },
  errorText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
  },
  errorSubText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
    textAlign: "center",
    lineHeight: 18,
    marginTop: -4,
  },
  retryButton: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.zinc900,
    borderRadius: 10,
  },
  retryButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },

  // ─── Info card ─────────────────────────────────────────────────────────────
  infoCard: {
    marginHorizontal: Spacing.screenPx,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: Colors.zinc50,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    padding: 20,
    gap: 10,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusBadgeText: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "600",
  },
  roleBadge: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
  },
  anonBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: Colors.zinc100,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  anonBadgeText: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
  },
  spaceName: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    lineHeight: 26,
  },
  descRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    minHeight: 20,
  },
  spaceDesc: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    flex: 1,
    lineHeight: 20,
  },
  spaceDescEmpty: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
    flex: 1,
  },
  descEditIcon: {
    marginTop: 2,
  },
  descEditContainer: {
    gap: 8,
  },
  descInput: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
    borderWidth: 1,
    borderColor: Colors.zinc300,
    borderRadius: 10,
    padding: 12,
    minHeight: 80,
    textAlignVertical: "top",
    backgroundColor: Colors.white,
  },
  descEditButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  descEditBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  descCancelBtn: {
    backgroundColor: Colors.zinc100,
  },
  descCancelBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc600,
    fontWeight: "600",
  },
  descSaveBtn: {
    backgroundColor: Colors.zinc900,
  },
  descSaveBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.white,
    fontWeight: "600",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
    marginTop: 2,
  },
  metaText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.zinc300,
  },

  // ─── Section ───────────────────────────────────────────────────────────────
  section: {
    marginTop: 20,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.screenPx,
  },
  sectionLabel: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "600",
    color: Colors.zinc400,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  sectionLoading: {
    paddingVertical: 20,
    alignItems: "center",
  },
  emptySection: {
    marginHorizontal: Spacing.screenPx,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
  },
  emptySectionText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
  },
  countBadge: {
    backgroundColor: Colors.noticeAccentSoft,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: "center",
  },
  countBadgeText: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.noticeAccent,
    fontWeight: "600",
  },

  // ─── Rounds list ───────────────────────────────────────────────────────────
  roundsList: {
    gap: 16,
    paddingHorizontal: Spacing.screenPx,
  },
  roundSection: {
    gap: 10,
    backgroundColor: Colors.zinc50,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    paddingTop: 14,
    paddingBottom: 14,
    overflow: "hidden",
  },
  roundSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
  },
  roundSectionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  roundStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  roundStatusText: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "600",
  },
  roundNumberText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc800,
  },
  roundTitleText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    flex: 1,
  },
  roundLetterCount: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
  },
  roundDescription: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc400,
    lineHeight: 17,
    paddingHorizontal: 14,
    marginTop: -4,
  },
  roundOpeningArea: {
    marginTop: 2,
  },
  roundLetterArea: {
    marginTop: 2,
  },

  // ─── Locked / preparing areas ───────────────────────────────────────────────
  lockedArea: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    gap: 6,
    marginHorizontal: 14,
    backgroundColor: Colors.zinc100,
    borderRadius: 10,
  },
  lockedText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
  },
  preparingArea: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    marginHorizontal: 14,
  },
  preparingText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400,
  },
  writeOpeningBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.zinc300,
    borderStyle: "dashed",
    backgroundColor: Colors.white,
  },
  writeOpeningBtnText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc600,
    fontWeight: "600",
  },

  // ─── Recruitment closed banner ──────────────────────────────────────────────
  recruitmentClosedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: Spacing.screenPx,
    backgroundColor: Colors.zinc100,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recruitmentClosedText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },

  // ─── Code request items ────────────────────────────────────────────────────
  codeRequestList: {
    marginHorizontal: Spacing.screenPx,
    gap: 8,
  },
  codeRequestItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    padding: 14,
    gap: 10,
  },
  codeRequestLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  codeRequestAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  codeRequestMeta: {
    flex: 1,
    gap: 2,
  },
  codeRequestNickname: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc800,
  },
  codeRequestCode: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
  },
  codeRequestActions: {
    flexDirection: "row",
    gap: 6,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  rejectBtn: {
    backgroundColor: Colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
  },
  rejectBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
    fontWeight: "600",
  },
  approveBtn: {
    backgroundColor: Colors.zinc900,
  },
  approveBtnDisabled: {
    backgroundColor: Colors.zinc300,
  },
  approveBtnText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.white,
    fontWeight: "600",
  },

  // ─── Operator actions ──────────────────────────────────────────────────────
  operatorActions: {
    marginHorizontal: Spacing.screenPx,
    backgroundColor: Colors.zinc50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    overflow: "hidden",
  },
  operatorActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  operatorActionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  operatorActionIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
  },
  operatorActionText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc800,
  },
  operatorDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.zinc200,
    marginLeft: 58,
  },

  // ─── Invite code card ──────────────────────────────────────────────────────
  inviteCodeCard: {
    marginHorizontal: Spacing.screenPx,
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    padding: 16,
    alignItems: "center",
    gap: 6,
  },
  inviteCode: {
    ...Typography.bodySemiBold,
    fontSize: 24,
    color: Colors.zinc900,
    letterSpacing: 3,
  },
  inviteCodeHint: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
});

// ─── Modal Styles ─────────────────────────────────────────────────────────────

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingTop: 20,
    gap: 12,
  },
  title: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  subtitle: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    lineHeight: 18,
    marginTop: -4,
  },
  input: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc800,
    borderWidth: 1,
    borderColor: Colors.zinc300,
    borderRadius: 10,
    padding: 12,
    minHeight: 80,
    textAlignVertical: "top",
    backgroundColor: Colors.zinc50,
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  btn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelBtn: {
    backgroundColor: Colors.zinc100,
  },
  cancelBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc600,
  },
  confirmBtn: {
    backgroundColor: Colors.zinc900,
  },
  confirmBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
});
