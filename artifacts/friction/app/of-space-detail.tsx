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
  Animated,
  PanResponder,
  Pressable,
  Dimensions,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useToast } from "@/contexts/ToastContext";
import { normalizeSpaceRouteId } from "@/lib/spaceBasicSettingsAccess";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton from "@/components/shared/HeaderButton";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import CanonicalCardSlot from "@/components/ArticleCardItem/CanonicalCardSlot";
import type { OriginLayout } from "@/components/CardSelectOverlay/CardSelectOverlay";
import { useLetterSelectionOverlay } from "@/hooks/useLetterSelectionOverlay";
import { spaceLetterToViewModel } from "@/hooks/useSpaceLetterCards";
import DotIndicator from "@/components/DotIndicator/DotIndicator";
import { useUser } from "@/contexts/UserContext";
import { getUserScopedSpaceJoinContextQueryKey } from "@/lib/spaceJoinContextQuery";
import {
  useGetSpaceJoinContext,
  useListSpaceRounds,
  getListSpaceRoundsQueryKey,
  useListSpaceLetters,
  getListSpaceLettersQueryKey,
  useUpdateSpace,
  getArticle,
  getGetArticleQueryKey,
  useListSpaceRoundSlots,
  getListSpaceRoundSlotsQueryKey,
  useListAllSpaceScheduledSends,
  getListAllSpaceScheduledSendsQueryKey,
} from "@workspace/api-client-react";
import type {
  SpaceRound,
  SpaceLetter,
  SpaceWithCreatorInfo,
  Article,
  ArticleCover,
  SpaceRoundSlotWithUser,
  SpaceScheduledSendWithLetter,
} from "@workspace/api-client-react";
import { useSelectionScrollRestoration } from "@/hooks/useSelectionScrollRestoration";
import ActionSheetModal from "@/components/ActionSheetModal/ActionSheetModal";
import { SpaceInfoNote } from "@/components/SpaceInfoNote/SpaceInfoNote";
import { SpaceCopy } from "@/constants/spaceCopy";
import { spaceStatusLabel, spaceStatusStyle } from "@/lib/spaceStatusStyle";
import {
  getSpaceLetterAuthorName,
  getSpaceRoundPresentationStatus,
  isKstSlotReservable,
  isOpeningSlotReservable,
  roundStatusLabel,
  sortSpaceRoundSlotsForPresentation,
  shouldDimSpaceRoundLetter,
  sortSpaceRoundsForDetail,
  resolveUpcomingRoundCenterCards,
  doesSpaceLetterOccupyRoundSlot,
  getSpaceLetterPresentationRoundId,
  type SpaceReservationMetadataPresentation,
} from "@/lib/spaceRoundPresentation";
import { toKstCalendarDate } from "@/lib/kstDate";
import { isRecruitmentFull } from "@/lib/spaceRecruitment";

// ─── Space Carousel constants ─────────────────────────────────────────────────
// Card width is derived so that exactly 2 full cards + the centre of the 3rd
// card fall at the right screen edge, regardless of device width.
//   leftPad + cardW + gap + cardW + gap + cardW/2 = screenW
//   2.5 * cardW = screenW - leftPad - 2 * gap
//   cardW = (screenW - leftPad - 2 * gap) / 2.5

const { width: SCREEN_W } = Dimensions.get("window");
const SC_CARD_GAP = 10;
const SC_LEFT_PAD = Spacing.screenPx;
const SC_CARD_W = Math.floor((SCREEN_W - SC_LEFT_PAD - 2 * SC_CARD_GAP) / 2.5);
const SC_CARD_H = SC_CARD_W * (8 / 5);

// The carousel slot (SC_CARD_W) is narrower than the canonical card width that
// CardSelectOverlay renders at (Sizing.cardSlotW). If we rendered the card
// natively at SC_CARD_W, ArticleCardItem would lay its internals out with
// different rounding/minimum-size floors than the overlay's canonical card, so
// the hero transition would visibly swap one card for a differently-laid-out
// one at progress=0.
//
// Instead — matching how the inbox / profile carousels behave, where slot width
// already equals the canonical width — we always render the card at the
// canonical size and shrink it with a pure transform. The carousel card is then
// literally the same pixels as the overlay card at progress=0, so it grows in
// place with no swap and no flash on the way back down.
// ─── Helpers ─────────────────────────────────────────────────────────────────

function roundStatusColor(status: string): string {
  if (status === "ACTIVE") return Colors.noticeAccent;
  if (status === "UPCOMING") return Colors.zinc400;
  return Colors.zinc300;
}
function formatPlannedDate(val: Date | string | null | undefined): string {
  if (!val) return "미정";
  const d = typeof val === "string" ? new Date(val) : val;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function scheduleTypeLabel(
  scheduleType: string | null | undefined,
  weekdays: number[] | null | undefined,
  centerInterval: number,
): string {
  if (scheduleType === "WEEKDAY") {
    if (weekdays && weekdays.length > 0) {
      return `요일 지정 (${weekdays.map((w) => WEEKDAY_LABELS[w]).join(", ")})`;
    }
    return "요일 지정";
  }
  if (scheduleType === "N_DAY") {
    return `${centerInterval}일 간격`;
  }
  return `${centerInterval}일 간격`;
}

// ─── Space Carousel ───────────────────────────────────────────────────────────
// Free-scrolling carousel (no snap). 2+ cards visible + 3rd peeking at right edge.
//   Web    → PanResponder + Animated translate, clamps/rubber-bands at bounds
//   Native → horizontal ScrollView, free scroll

const SC_SNAP_STEP = SC_CARD_W + SC_CARD_GAP;

type SpaceCarouselItem =
  | { id: string; letter: SpaceLetter }
  | { id: string; node: React.ReactNode };

function SpaceCarousel({
  letters,
  roundStatus,
  isAnonymous,
  spaceName,
  onCardPress,
  hiddenCardId,
  openingSlot,
  openingSlotAtEnd = false,
  trailingSlots = [],
  orderedItems,
}: {
  letters: SpaceLetter[];
  roundStatus: string;
  isAnonymous: boolean;
  spaceName: string;
  onCardPress: (letter: SpaceLetter, layout: OriginLayout) => void;
  hiddenCardId?: string | null;
  openingSlot?: React.ReactNode;
  openingSlotAtEnd?: boolean;
  trailingSlots?: { id: string; node: React.ReactNode }[];
  /** Used by upcoming rounds to replace cards at their exact slot position. */
  orderedItems?: SpaceCarouselItem[];
}) {
  const carouselItems: SpaceCarouselItem[] =
    orderedItems ??
    [
      ...letters.map((letter) => ({ id: `letter:${letter.id}`, letter })),
      ...trailingSlots,
    ];
  const itemCount = carouselItems.length + (openingSlot ? 1 : 0);
  const cardSlotRefs = useRef<(View | null)[]>([]);
  const swipedRef = useRef(false);

  const [currentIndex, setCurrentIndex] = useState(0);
  // Stable ref so PanResponder (created once) can update state
  const setCurrentIndexRef = useRef(setCurrentIndex);
  setCurrentIndexRef.current = setCurrentIndex;

  // Web snap state
  const scrollOffsetRef = useRef(0);
  const savedOffsetRef = useRef(0);
  const translateX = useRef(new Animated.Value(SC_LEFT_PAD)).current;

  const maxScrollOffset = useCallback(() => {
    const totalW =
      itemCount * SC_CARD_W + Math.max(0, itemCount - 1) * SC_CARD_GAP;
    return Math.max(0, totalW + SC_LEFT_PAD * 2 - SCREEN_W);
  }, [itemCount]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        swipedRef.current = false;
        return false;
      },
      onMoveShouldSetPanResponder: (_, g) =>
        itemCount > 1 &&
        Math.abs(g.dx) > Math.abs(g.dy) &&
        Math.abs(g.dx) > 5,
      onPanResponderGrant: () => {
        savedOffsetRef.current = scrollOffsetRef.current;
        swipedRef.current = false;
      },
      onPanResponderMove: (_, g) => {
        if (Math.abs(g.dx) > 10) swipedRef.current = true;
        const raw = savedOffsetRef.current - g.dx;
        const max = maxScrollOffset();
        const clamped =
          raw < 0
            ? raw * 0.3
            : raw > max
              ? max + (raw - max) * 0.3
              : raw;
        scrollOffsetRef.current = clamped;
        translateX.setValue(SC_LEFT_PAD - clamped);
      },
      onPanResponderRelease: () => {
        const max = maxScrollOffset();
        // No snapping — just clamp to valid scroll range and stay put.
        const clampedOffset = Math.max(0, Math.min(scrollOffsetRef.current, max));
        const activeIndex = Math.max(
          0,
          Math.min(Math.round(clampedOffset / SC_SNAP_STEP), itemCount - 1),
        );
        scrollOffsetRef.current = clampedOffset;
        setCurrentIndexRef.current(activeIndex);
        Animated.spring(translateX, {
          toValue: SC_LEFT_PAD - clampedOffset,
          useNativeDriver: false,
          overshootClamping: true,
          tension: 120,
          friction: 20,
        }).start();
        setTimeout(() => { swipedRef.current = false; }, 100);
      },
      onPanResponderTerminate: () => {
        setTimeout(() => { swipedRef.current = false; }, 100);
      },
    }),
  ).current;

  const carouselCards = carouselItems.map((item, index) => {
    const globalIndex = (openingSlot && !openingSlotAtEnd ? 1 : 0) + index;
    const isLast = globalIndex === itemCount - 1;

    if ("node" in item) {
      return (
        <View
          key={item.id}
          style={[
            spaceCarouselStyles.cardSlot,
            !isLast && { marginRight: SC_CARD_GAP },
          ]}
        >
          {item.node}
        </View>
      );
    }

    const { letter } = item;
    const authorNickname = (letter as any).authorNickname as string | null;
    const displayName = (letter as any).displayName as string | null;
    const title = (letter as any).articleTitle as string | null;
    const authorName = getSpaceLetterAuthorName(
      letter.letterType,
      isAnonymous,
      displayName,
      authorNickname,
    );
    const handlePress = () => {
      if (Platform.OS === "web" && swipedRef.current) return;
      const slotRef = cardSlotRefs.current[index];
      if (slotRef) {
        slotRef.measureInWindow((x, y, width, height) => {
          onCardPress(letter, { x, y, width, height });
        });
      } else {
        onCardPress(letter, { x: 0, y: 0, width: SC_CARD_W, height: SC_CARD_H });
      }
    };

    return (
      <View
        key={item.id}
        ref={(ref) => { cardSlotRefs.current[index] = ref; }}
        style={[
          spaceCarouselStyles.cardSlot,
          !isLast && { marginRight: SC_CARD_GAP },
          (letter.sourceArticleId ?? letter.id) === hiddenCardId && spaceCarouselStyles.cardSlotHidden,
        ]}
      >
        <CanonicalCardSlot width={SC_CARD_W} height={SC_CARD_H}>
          <ArticleCardItem
            title={title ?? "제목 없음"}
            authorName={authorName}
            spaceName={spaceName}
            cover={((letter as any).articleCover ?? null) as ArticleCover | null}
            isRead={shouldDimSpaceRoundLetter(roundStatus, letter.isRead)}
            isActive={true}
            onPress={handlePress}
          />
        </CanonicalCardSlot>
      </View>
    );
  });

  const cards = [
    ...(openingSlot && !openingSlotAtEnd
      ? [
          <View
            key="__opening_slot"
            style={[
              spaceCarouselStyles.cardSlot,
              itemCount > 1 && { marginRight: SC_CARD_GAP },
            ]}
          >
            {openingSlot}
          </View>,
        ]
      : []),
    ...carouselCards,
    ...(openingSlot && openingSlotAtEnd
      ? [
          <View key="__opening_slot" style={spaceCarouselStyles.cardSlot}>
            {openingSlot}
          </View>,
        ]
      : []),
  ];

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
          scrollEventThrottle={16}
          contentContainerStyle={spaceCarouselStyles.carouselContent}
          style={spaceCarouselStyles.carouselScroll}
          onScroll={(e) => {
            const offsetX = e.nativeEvent.contentOffset.x;
            const idx = Math.max(
              0,
              Math.min(Math.round(offsetX / SC_SNAP_STEP), itemCount - 1),
            );
            setCurrentIndex(idx);
          }}
        >
          {cards}
        </ScrollView>
      )}
      <DotIndicator total={itemCount} activeIndex={currentIndex} />
    </View>
  );
}

const spaceCarouselStyles = StyleSheet.create({
  carouselWindow: {
    width: SCREEN_W,
    height: SC_CARD_H,
    overflow: "hidden",
  },
  carouselTrack: {
    flexDirection: "row",
    height: SC_CARD_H,
  },
  carouselScroll: {
    height: SC_CARD_H,
  },
  carouselContent: {
    paddingLeft: SC_LEFT_PAD,
    paddingRight: SC_LEFT_PAD,
  },
  cardSlot: {
    width: SC_CARD_W,
  },
  cardSlotHidden: {
    opacity: 0,
  },
  // ─── Opening slot card (carousel first item) ──────────────────────────────
  openingSlotCard: {
    width: SC_CARD_W,
    height: SC_CARD_H,
  },
  openingSlotCardInner: {
    flex: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    borderStyle: "dashed",
    backgroundColor: Colors.zinc50,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 16,
  },
  openingSlotWriteText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.zinc500,
    textAlign: "center",
  },
  openingSlotEmptyText: {
    fontSize: 13,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 19,
  },
});

// ─── Empty round slots ─────────────────────────────────────────────────────────

function formatSlotDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const plainDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (plainDate) return `${plainDate[1]}.${plainDate[2]}.${plainDate[3]}`;
  const d = toKstCalendarDate(new Date(iso));
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function SpaceRoundSlotCard({
  slot,
  userId,
  now,
  onSchedule,
}: {
  slot: SpaceRoundSlotWithUser;
  userId: string;
  now: Date;
  onSchedule: (slot: SpaceRoundSlotWithUser) => void;
}) {
  const isMySlot = slot.assignedUserId === userId;
  const isPastEmptySlot =
    !!slot.scheduledDate && !isKstSlotReservable(slot.scheduledDate, now);

  return (
    <View
      style={[
        styles.slotCard,
        isMySlot ? styles.slotCardMine : styles.slotCardOther,
      ]}
    >
      <View style={styles.slotCardTop}>
        {isPastEmptySlot ? (
          <Feather name="clock" size={18} color={Colors.zinc300} />
        ) : isMySlot ? (
          <Feather name="edit-3" size={18} color={Colors.zinc500} />
        ) : (
          <Feather name="lock" size={18} color={Colors.zinc300} />
        )}
      </View>
      <View style={styles.slotCardMiddle}>
        <Text style={isMySlot ? styles.slotCardMyText : styles.slotCardOtherText}>
          {isPastEmptySlot ? "글 없음" : isMySlot ? "내 차례" : "추후 공개"}
        </Text>
      </View>
      {isMySlot && !isPastEmptySlot && (
        <ScalePressable
          style={styles.slotCtaOuter}
          contentStyle={styles.slotCta}
          onPress={() => onSchedule(slot)}
        >
          <Text style={styles.slotCtaText}>글 예약하기</Text>
        </ScalePressable>
      )}
      <View style={styles.slotCardFooter}>
        <Text style={styles.slotNickname} numberOfLines={1}>
          {isMySlot ? "나" : (slot.assignedUserNickname ?? "참여자")}
        </Text>
        {slot.scheduledDate ? (
          <Text style={styles.slotDate}>{formatSlotDate(slot.scheduledDate)}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Upcoming Round Slots ─────────────────────────────────────────────────────

function UpcomingRoundSlots({
  slots,
  isLoading,
  letters,
  pendingCenterReservations,
  isPendingCenterLettersFetching,
  isAnonymous,
  spaceName,
  onPressLetter,
  hiddenCardId,
  userId,
  now,
  onSchedule,
  openingSlot,
  openingSlotIsExpired = false,
}: {
  slots: SpaceRoundSlotWithUser[];
  isLoading: boolean;
  letters: SpaceLetter[];
  pendingCenterReservations: {
    spaceLetterId: string;
    reservation?: SpaceReservationMetadataPresentation | null;
  }[];
  isPendingCenterLettersFetching: boolean;
  isAnonymous: boolean;
  spaceName: string;
  onPressLetter: (letter: SpaceLetter, layout: OriginLayout) => void;
  hiddenCardId?: string | null;
  userId: string;
  now: Date;
  onSchedule: (slot: SpaceRoundSlotWithUser) => void;
  openingSlot?: React.ReactNode;
  openingSlotIsExpired?: boolean;
}) {
  if (isLoading || isPendingCenterLettersFetching) {
    return (
      <View style={styles.slotLoadingRow}>
        <ActivityIndicator size="small" color={Colors.zinc300} />
      </View>
    );
  }

  // When no user slots exist yet, render the opening slot (if any) in a
  // horizontal scroll followed by the locked placeholder card. This ensures
  // the opening slot is always first even before slot data is available.
  if (slots.length === 0) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.slotCarouselContent}
      >
        {openingSlot ? (
          <View style={{ marginRight: SC_CARD_GAP }}>
            {openingSlot}
          </View>
        ) : null}
        <View style={[styles.slotCard, styles.slotCardOther, { alignItems: "center", justifyContent: "center", gap: 6 }]}>
          <Feather name="lock" size={20} color={Colors.zinc300} />
          <Text style={styles.lockedText}>회차 시작 후 공개</Text>
        </View>
      </ScrollView>
    );
  }

  const upcomingCards = resolveUpcomingRoundCenterCards(
    letters,
    sortSpaceRoundSlotsForPresentation(slots, now),
    userId,
    pendingCenterReservations,
  );
  const orderedItems: SpaceCarouselItem[] = upcomingCards.map((item) =>
    item.kind === "letter"
      ? { id: `letter:${item.letter.id}`, letter: item.letter }
      : {
          id: `slot:${item.slot.id}`,
          node: (
            <SpaceRoundSlotCard
              slot={item.slot}
              userId={userId}
              now={now}
              onSchedule={onSchedule}
            />
          ),
        },
  );

  return (
    <SpaceCarousel
      letters={[]}
      roundStatus="UPCOMING"
      isAnonymous={isAnonymous}
      spaceName={spaceName}
      onCardPress={onPressLetter}
      hiddenCardId={hiddenCardId}
      openingSlot={openingSlot}
      openingSlotAtEnd={openingSlotIsExpired}
      orderedItems={orderedItems}
    />
  );
}

// ─── Round Section ────────────────────────────────────────────────────────────

function RoundSection({
  round,
  letters,
  spaceStatus,
  isOperator,
  isAnonymous,
  spaceName,
  now,
  onPressLetter,
  pendingCenterReservations,
  isPendingCenterLettersFetching,
  onPressWriteOpening,
  hiddenCardId,
  spaceId,
  userId,
  onScheduleSlot,
}: {
  round: SpaceRound;
  letters: SpaceLetter[];
  spaceStatus: string;
  isOperator: boolean;
  isAnonymous: boolean;
  spaceName: string;
  now: Date;
  onPressLetter: (letter: SpaceLetter, layout: OriginLayout) => void;
  pendingCenterReservations: {
    spaceLetterId: string;
    reservation?: SpaceReservationMetadataPresentation | null;
  }[];
  isPendingCenterLettersFetching: boolean;
  onPressWriteOpening: (round: SpaceRound) => void;
  hiddenCardId?: string | null;
  spaceId: string;
  userId: string;
  onScheduleSlot: (slot: SpaceRoundSlotWithUser) => void;
}) {
  const roundStatus = getSpaceRoundPresentationStatus(round, now);
  const statusColor = roundStatusColor(roundStatus);
  const isUpcoming = roundStatus === "UPCOMING";
  const isSpaceRecruiting = spaceStatus === "RECRUITING";
  const isSpaceArchived = spaceStatus === "ARCHIVED";
  const slotsQuery = useListSpaceRoundSlots(spaceId, round.id, {
    query: {
      enabled: !!spaceId && !!round.id && !isSpaceRecruiting,
      queryKey: getListSpaceRoundSlotsQueryKey(spaceId, round.id),
    },
  });
  const roundSlots = (slotsQuery.data ?? []) as SpaceRoundSlotWithUser[];
  const upcomingOpeningSlotRef = useRef<View | null>(null);

  const openingLetter = letters.find((l) => l.letterType === "OPENING") ?? null;
  const hasOpeningLetter = openingLetter !== null;
  const openingReservationAvailable =
    roundStatus !== "COMPLETED" &&
    !isSpaceArchived &&
    isOpeningSlotReservable(round.startsAt, now);
  const emptyRoundSlots = sortSpaceRoundSlotsForPresentation(
    roundSlots.filter(
      (slot) =>
        !letters.some(
          (letter) => doesSpaceLetterOccupyRoundSlot(letter, slot),
        ),
    ),
    now,
  );
  const trailingSlotCards = emptyRoundSlots.map((slot) => ({
    id: `slot:${slot.id}`,
    node: (
      <SpaceRoundSlotCard
        slot={slot}
        userId={userId}
        now={now}
        onSchedule={onScheduleSlot}
      />
    ),
  }));

  // Placeholder card shown when no opening letter exists yet. The write
  // button is offered only while the opening letter's KST 06:00 deadline is
  // still ahead. This deliberately includes the first six hours of the round's
  // start date, when the period is already ACTIVE but the 06:00 send slot has
  // not yet elapsed.
  const openingPlaceholderNode: React.ReactNode =
    !isSpaceRecruiting
      ? isOperator && !isSpaceArchived
        ? openingReservationAvailable
          ? (
            <ScalePressable
              style={spaceCarouselStyles.openingSlotCard}
              contentStyle={spaceCarouselStyles.openingSlotCardInner}
              onPress={() => onPressWriteOpening(round)}
            >
              <Feather name="edit-3" size={18} color={Colors.zinc400} />
              <Text style={spaceCarouselStyles.openingSlotWriteText}>여는 편지 작성</Text>
            </ScalePressable>
          )
          : (
            <View style={[spaceCarouselStyles.openingSlotCard, spaceCarouselStyles.openingSlotCardInner]}>
              <Feather name="clock" size={18} color={Colors.zinc300} />
              <Text style={spaceCarouselStyles.openingSlotEmptyText}>글 없음</Text>
            </View>
          )
        : (
          <View style={[spaceCarouselStyles.openingSlotCard, spaceCarouselStyles.openingSlotCardInner]}>
            <Feather name="mail" size={18} color={Colors.zinc300} />
            <Text style={spaceCarouselStyles.openingSlotEmptyText}>여는 편지를{"\n"}준비 중이에요</Text>
          </View>
        )
      : null;

  // For SpaceCarousel (ACTIVE/COMPLETED): the opening letter is already the first
  // item in the letters array, so only pass the placeholder when it's missing.
  const openingSlotNode: React.ReactNode =
    !isSpaceRecruiting && !hasOpeningLetter ? openingPlaceholderNode : null;

  // For UpcomingRoundSlots: letters are never shown there, so we must explicitly
  // render the opening letter card (if it exists) OR the placeholder.
  const upcomingOpeningSlotNode: React.ReactNode = isSpaceRecruiting
    ? null
    : hasOpeningLetter && openingLetter
      ? (() => {
          const letter = openingLetter;
          const authorNickname = (letter as any).authorNickname as string | null;
          const displayName = (letter as any).displayName as string | null;
          const title = (letter as any).articleTitle as string | null;
          const authorName = getSpaceLetterAuthorName(
            letter.letterType,
            isAnonymous,
            displayName,
            authorNickname,
          );
           const handleUpcomingOpeningPress = () => {
             const slot = upcomingOpeningSlotRef.current;
             if (slot) {
               slot.measureInWindow((x, y, width, height) => {
                 onPressLetter(letter, { x, y, width, height });
               });
               return;
             }
             onPressLetter(letter, {
               x: 0,
               y: 0,
               width: SC_CARD_W,
               height: SC_CARD_H,
             });
           };
          return (
            <View
              style={
                (letter.sourceArticleId ?? letter.id) === hiddenCardId
                  ? spaceCarouselStyles.cardSlotHidden
                  : undefined
              }
            >
              <CanonicalCardSlot
                ref={upcomingOpeningSlotRef}
                width={SC_CARD_W}
                height={SC_CARD_H}
              >
                <ArticleCardItem
                  title={title ?? "제목 없음"}
                  authorName={authorName}
                  spaceName={spaceName}
                  cover={((letter as any).articleCover ?? null) as ArticleCover | null}
                  isRead={letter.isRead}
                  isActive={true}
                  onPress={handleUpcomingOpeningPress}
                />
              </CanonicalCardSlot>
            </View>
          );
        })()
      : openingPlaceholderNode;

  let letterArea: React.ReactNode;

  if (isUpcoming) {
    letterArea = (
      <UpcomingRoundSlots
        slots={roundSlots}
        isLoading={slotsQuery.isLoading}
        letters={letters}
        pendingCenterReservations={pendingCenterReservations}
        isPendingCenterLettersFetching={isPendingCenterLettersFetching}
        isAnonymous={isAnonymous}
        spaceName={spaceName}
        onPressLetter={onPressLetter}
        hiddenCardId={hiddenCardId}
        userId={userId}
        now={now}
        onSchedule={onScheduleSlot}
        openingSlot={upcomingOpeningSlotNode}
        openingSlotIsExpired={!hasOpeningLetter && !openingReservationAvailable}
      />
    );
  } else if (isSpaceRecruiting) {
    letterArea = (
      <View style={styles.lockedArea}>
        <Feather name="clock" size={20} color={Colors.zinc300} />
        <Text style={styles.lockedText}>공간 시작 후 공개</Text>
      </View>
    );
  } else if (slotsQuery.isLoading) {
    letterArea = (
      <View style={styles.slotLoadingRow}>
        <ActivityIndicator size="small" color={Colors.zinc300} />
      </View>
    );
  } else if (letters.length > 0 || openingSlotNode || trailingSlotCards.length > 0) {
    letterArea = (
      <SpaceCarousel
        letters={letters}
        roundStatus={roundStatus}
        isAnonymous={isAnonymous}
        spaceName={spaceName}
        onCardPress={onPressLetter}
        hiddenCardId={hiddenCardId}
        openingSlot={openingSlotNode}
        openingSlotAtEnd={!hasOpeningLetter && !openingReservationAvailable}
        trailingSlots={trailingSlotCards}
      />
    );
  } else {
    letterArea = null;
  }

  const formatRoundDate = (iso: string) => {
    const d = toKstCalendarDate(new Date(iso));
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };

  const roundDateRange =
    round.startsAt || round.endsAt
      ? [
          round.startsAt ? formatRoundDate(round.startsAt) : null,
          round.endsAt ? formatRoundDate(round.endsAt) : null,
        ]
          .filter(Boolean)
          .join(" ~ ")
      : null;

  return (
    <View style={styles.roundSection}>
      <View style={styles.roundSectionHeader}>
        <View style={styles.roundSectionLeft}>
          <Text style={styles.roundNumberText}>{round.roundNumber}회차</Text>
          <Text style={[styles.roundStatusText, { color: statusColor }]}>
            {roundStatusLabel(roundStatus)}
          </Text>
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
      {roundDateRange ? (
        <Text style={styles.roundDateRange}>{roundDateRange}</Text>
      ) : null}
      {round.description ? (
        <Text style={styles.roundDescription} numberOfLines={2}>
          {round.description}
        </Text>
      ) : null}
      {letterArea ? (
        <View style={styles.roundLetterArea}>{letterArea}</View>
      ) : null}
      {!letterArea && !isUpcoming && !isSpaceRecruiting ? (
        <View style={styles.preparingArea}>
          <Text style={styles.preparingText}>편지 없음</Text>
        </View>
      ) : null}
    </View>
  );
}
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
  const [expanded, setExpanded] = useState(false);
  const [measuredLines, setMeasuredLines] = useState<number | null>(null);
  const hasMore = measuredLines !== null && measuredLines > 3;
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
          cursorColor={Colors.cursorAccent}
          autoFocus
          maxLength={200}
        />
        <View style={styles.descEditButtons}>
          <ScalePressable
            contentStyle={[styles.descEditBtn, styles.descCancelBtn]}
            onPress={() => setIsEditing(false)}
            disabled={saving}
          >
            <Text style={styles.descCancelBtnText}>취소</Text>
          </ScalePressable>
          <ScalePressable
            contentStyle={[styles.descEditBtn, styles.descSaveBtn]}
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

  if (!space.description) {
    return (
      <ScalePressable
        style={styles.descRowOuter}
        contentStyle={styles.descRow}
        onPress={isOperator ? handleStart : undefined}
        disabled={!isOperator}
      >
        <Text style={styles.spaceDescEmpty}>
          {isOperator ? "+ 설명 추가하기" : "설명 없음"}
        </Text>
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

  return (
    <View style={styles.descRowOuter}>
      {/* Hidden measuring text — width-constrained to match visible text */}
      <Text
        style={[styles.spaceDesc, { position: "absolute", opacity: 0, left: 0, right: 0 }]}
        onTextLayout={(e: NativeSyntheticEvent<TextLayoutEventData>) =>
          setMeasuredLines(e.nativeEvent.lines.length)
        }
        aria-hidden
      >
        {space.description}
      </Text>
      <View style={styles.descRow}>
        <Text
          style={styles.spaceDesc}
          numberOfLines={hasMore && !expanded ? 3 : undefined}
        >
          {space.description}
        </Text>
        {isOperator && (
          <ScalePressable onPress={handleStart} hitSlop={8}>
            <Feather
              name="edit-2"
              size={13}
              color={Colors.zinc400}
              style={styles.descEditIcon}
            />
          </ScalePressable>
        )}
      </View>
      {hasMore && (
        <ScalePressable onPress={() => setExpanded((v) => !v)} hitSlop={6}>
          <Text style={styles.descMoreBtn}>
            {expanded ? "접기" : "더보기"}
          </Text>
        </ScalePressable>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SpaceDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, showInviteGuide } = useLocalSearchParams<{ id: string; showInviteGuide?: string }>();
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [now, setNow] = useState(() => new Date());

  // Refresh KST-derived dates while this screen remains open, including the
  // 06:00 reservation cutoff, without making users pull to refresh.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const [showKebabSheet, setShowKebabSheet] = useState(false);

  // ── Track navigation to reader so we can refetch letters on return ───────
  const wentToReaderRef = useRef(false);
  // ── Track navigation to archive screen so we can refetch space state on return ──
  const wentToArchiveRef = useRef(false);
  // ── Track reservation-list navigation so its mutations cannot leave cards stale ──
  const wentToScheduleRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (wentToReaderRef.current) {
        wentToReaderRef.current = false;
        queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(id) });
      }
      if (wentToArchiveRef.current) {
        wentToArchiveRef.current = false;
        queryClient.invalidateQueries({ queryKey: getUserScopedSpaceJoinContextQueryKey(id, userId) });
      }
      if (wentToScheduleRef.current) {
        wentToScheduleRef.current = false;
        queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(id) });
        queryClient.invalidateQueries({
          queryKey: getListAllSpaceScheduledSendsQueryKey(id),
        });
        queryClient.invalidateQueries({
          predicate: (query) => {
            const endpoint = query.queryKey[0];
            return (
              typeof endpoint === "string" &&
              endpoint.startsWith(`/api/spaces/${id}/rounds/`) &&
              endpoint.endsWith("/slots")
            );
          },
        });
      }
    }, [queryClient, id, userId]),
  );

  // ── Card select overlay state ─────────────────────────────────────────────
  // tappedLetterRef: the SpaceLetter tapped last — kept in a ref (not state) so
  // the onRead/onClose callbacks in useLetterSelectionOverlay always have access
  // without triggering an extra render.
  const tappedLetterRef = useRef<SpaceLetter | null>(null);
  // cancelScrollRestorationRef breaks the hook ordering cycle:
  // useLetterSelectionOverlay needs no deps, useSelectionScrollRestoration needs
  // isOverlayActive, onRead needs cancelScrollRestoration — a ref links them.
  const cancelScrollRestorationRef = useRef<(() => void) | null>(null);
  // Ref mirror of selectedArticleId — lets async fetch callbacks guard against
  // the stale-hydration race where letter A's delayed response overwrites B's overlay.
  const selectedArticleIdRef = useRef<string | null>(null);
  const spaceScrollRef = useRef<ScrollView>(null);
  const restoreSpaceScrollOffset = useCallback((offset: number) => {
    spaceScrollRef.current?.scrollTo({ y: offset, animated: false });
  }, []);

  useEffect(() => {
    if (showInviteGuide === "1") {
      Alert.alert(
        "공간이 만들어졌어요 🎉",
        "초대 문구로 초대하거나 아이디로 직접 초대할 수 있어요.",
        [{ text: "확인" }],
      );
    }
  }, [showInviteGuide]);

  const joinContextQuery = useGetSpaceJoinContext(
    id,
    { query: { enabled: !!id && !!userId, queryKey: getUserScopedSpaceJoinContextQueryKey(id, userId) } },
  );

  const roundsQuery = useListSpaceRounds(id, {
    query: { enabled: !!id, queryKey: getListSpaceRoundsQueryKey(id) },
  });

  const lettersQuery = useListSpaceLetters(id, {
    query: { enabled: !!id, queryKey: getListSpaceLettersQueryKey(id) },
  });
  const scheduledSendsQuery = useListAllSpaceScheduledSends(id, {
    query: {
      enabled: !!id && !!userId,
      queryKey: getListAllSpaceScheduledSendsQueryKey(id),
    },
  });

  const joinContext = joinContextQuery.data;
  const space = joinContext?.space;
  const myParticipation = joinContext?.participation;
  const isOperator = myParticipation?.role === "OPERATOR";
  const isArchived = space?.status === "ARCHIVED";
  const isRecruiting = space?.status === "RECRUITING";

  // `participantCount` is the approved, recruitable-participant count. The
  // operator is excluded by the API and never consumes a recruitment place.
  const recruitmentCapacity = space?.maxParticipants ?? null;

  // Capacity-full flag: participant cap reached (independent of status).
  const isCapacityFull = isRecruitmentFull(
    recruitmentCapacity,
    space?.participantCount ?? 0,
  );

  const rounds = (roundsQuery.data ?? []) as SpaceRound[];
  const letters = (lettersQuery.data ?? []) as SpaceLetter[];
  const scheduledSends = (scheduledSendsQuery.data ?? []) as SpaceScheduledSendWithLetter[];
  const pendingCenterReservations = useMemo(
    () =>
      scheduledSends
          .filter((send) => send.status === "PENDING" && send.letterType === "CENTER")
          .map((send) => ({
            spaceLetterId: send.spaceLetterId,
            reservation: send.reservation ?? null,
          })),
    [scheduledSends],
  );

  // Fallback for legacy data: OPENING letters created by the start flow
  // before rounds existed have no spaceRoundId. Group them under round 1 so
  // they don't silently disappear from the detail screen.
  const firstRoundId = useMemo(() => {
    if (rounds.length === 0) return null;
    return [...rounds].sort((a, b) => a.roundNumber - b.roundNumber)[0].id;
  }, [rounds]);

  const lettersByRound = useMemo<Record<string, SpaceLetter[]>>(() => {
    const map: Record<string, SpaceLetter[]> = {};
    for (const letter of letters) {
      const key = getSpaceLetterPresentationRoundId(letter, firstRoundId) ?? "__none__";
      (map[key] ??= []).push(letter);
    }
    for (const key of Object.keys(map)) {
      map[key] = map[key].sort((a, b) => {
        if (a.letterType === "OPENING" && b.letterType !== "OPENING") return -1;
        if (b.letterType === "OPENING" && a.letterType !== "OPENING") return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }
    return map;
  }, [letters, firstRoundId]);

  const isLoading = joinContextQuery.isLoading;
  const isError = joinContextQuery.isError;
  const isRefreshing =
    joinContextQuery.isFetching ||
    roundsQuery.isFetching ||
    lettersQuery.isFetching ||
    scheduledSendsQuery.isFetching;

  const refetchAll = useCallback(async () => {
    await Promise.all([
      joinContextQuery.refetch(),
      roundsQuery.refetch(),
      lettersQuery.refetch(),
      scheduledSendsQuery.refetch(),
    ]);
  }, [joinContextQuery, roundsQuery, lettersQuery, scheduledSendsQuery]);

  const handleDescriptionSaved = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: getUserScopedSpaceJoinContextQueryKey(id, userId),
    });
  }, [queryClient, id, userId]);

  // isAnonymousSpace must be derived before useLetterSelectionOverlay so it
  // can be passed as `allowAncestorChain`. Placed after the data queries and
  // derived values so the hook ordering is deterministic every render.
  const isAnonymousSpace = !!space?.isAnonymous;

  const {
    isOverlayActive,
    isSourceHidden,
    selectedArticleId,
    openLetterOverlay,
    updateOverlayArticle,
    renderLetterOverlay,
  } = useLetterSelectionOverlay(userId, {
    allowAncestorChain: !isAnonymousSpace,
    onRead: (article, isNonPrimary) => {
      cancelScrollRestorationRef.current?.();
      if (!isNonPrimary) {
        // Primary card seeded with id = letter.sourceArticleId ?? letter.id.
        // If the letter had no published article, navigating to a reader is
        // meaningless — bail out.
        if (!tappedLetterRef.current?.sourceArticleId) return;
        wentToReaderRef.current = true;
        router.push({ pathname: "/read" as never, params: { articleId: article.id } });
      } else {
        router.push({ pathname: "/read" as never, params: { articleId: article.id, mode: "re_read" } });
      }
    },
    onClose: () => {
      tappedLetterRef.current = null;
    },
  });
  const {
    handleScroll: handleSelectionScroll,
    captureScrollOffset,
    cancelScrollRestoration,
  } = useSelectionScrollRestoration(isOverlayActive, restoreSpaceScrollOffset);
  // Sync after both hooks have resolved so onRead always sees current cancelScrollRestoration.
  cancelScrollRestorationRef.current = cancelScrollRestoration;
  // Keep selectedArticleIdRef in sync so async hydration can validate it.
  useEffect(() => { selectedArticleIdRef.current = selectedArticleId; }, [selectedArticleId]);

  const handlePressLetter = useCallback(
    (letter: SpaceLetter, layout: OriginLayout) => {
      captureScrollOffset();
      tappedLetterRef.current = letter;
      // Seed the overlay immediately with the carousel's visible title/cover so
      // the open animation never flashes a blank card while the full article loads.
      const seededArticle = {
        id: letter.sourceArticleId ?? letter.id,
        title: (letter as any).articleTitle ?? "제목 없음",
        cover: ((letter as any).articleCover ?? null) as ArticleCover | null,
        sourceArticleId: null,
      } as Article;
      // ViewModel adapter centralises author-name resolution and field separation.
      const vm = spaceLetterToViewModel(letter, space?.name ?? "", isAnonymousSpace);
      const tappedRound = rounds.find((r) => r.id === letter.spaceRoundId);
      const tappedRoundStatus = tappedRound
        ? getSpaceRoundPresentationStatus(tappedRound, now)
        : "ACTIVE";
      openLetterOverlay(seededArticle, {
        fallbackOrigin: layout,
        meta: {
          authorName: vm.authorName ?? null,
          authorId: vm.authorId ?? null,
          // spaceName is the collection-line label for space letters.
          collectionName: vm.spaceName ?? null,
          date: vm.date ?? letter.createdAt,
          isRead: shouldDimSpaceRoundLetter(tappedRoundStatus, letter.isRead),
        },
      });
      // Async fetch to hydrate the overlay with the full article object
      // (includes sourceArticleId for ancestor chain traversal).
      if (letter.sourceArticleId) {
        // Capture the seeded article ID this selection expects. If the user
        // closes and opens a different letter before the fetch resolves, the
        // ref will have advanced and we discard the stale result.
        const expectedId = letter.sourceArticleId ?? letter.id;
        queryClient.fetchQuery({
          queryKey: getGetArticleQueryKey(letter.sourceArticleId),
          queryFn: () => getArticle(letter.sourceArticleId!),
          staleTime: 5 * 60 * 1000,
        }).then((article) => {
          if (selectedArticleIdRef.current === expectedId) {
            updateOverlayArticle(article as Article);
          }
        }).catch(() => {});
      }
    },
    [queryClient, captureScrollOffset, openLetterOverlay, updateOverlayArticle,
     isAnonymousSpace, rounds, now, space?.name],
  );


  const handleCopyInviteCode = useCallback(async () => {
    if (!space?.inviteCode) return;
    await Clipboard.setStringAsync(space.inviteCode);
    showToast({ message: "초대 문구가 복사됐어요", type: "success" });
  }, [space?.inviteCode, showToast]);

  const handlePressWriteOpening = useCallback(
    (round: SpaceRound) => {
      wentToScheduleRef.current = true;
      router.push({
        pathname: "/of-space-schedule-send" as never,
        params: { id, openingRoundId: round.id },
      });
    },
    [router, id],
  );

  const handleScheduleSlot = useCallback(
    (slot: SpaceRoundSlotWithUser) => {
      wentToScheduleRef.current = true;
      router.push({
        pathname: "/of-space-schedule-send" as never,
        params: {
          id,
          slotId: slot.id,
          roundId: slot.spaceRoundId,
          scheduledDate: slot.scheduledDate ?? "",
        },
      });
    },
    [router, id],
  );

  const handleOpenScheduleList = useCallback(() => {
    wentToScheduleRef.current = true;
    router.push({
      pathname: "/of-space-schedule-send" as never,
      params: { id },
    });
  }, [router, id]);

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <HeaderButton
            variant="back"
            onPress={() => router.back()}
            accessibilityLabel="공간에서 돌아가기"
          />
          <View style={styles.headerSideSpacer} />
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
          <HeaderButton
            variant="back"
            onPress={() => router.back()}
            accessibilityLabel="공간에서 돌아가기"
          />
          <View style={styles.headerSideSpacer} />
        </View>
        <View style={styles.centerContainer}>
          <Feather name="alert-circle" size={36} color={Colors.zinc300} />
          <Text style={styles.errorText}>공간을 불러오지 못했어요</Text>
          <ScalePressable style={styles.retryButtonOuter} contentStyle={styles.retryButton} onPress={refetchAll}>
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </ScalePressable>
        </View>
      </View>
    );
  }

  // ─── Non-participant / removed participant ─────────────────────────────────
  // Withdrawn (kicked) participants keep a truthy participation row, so we
  // must also check status here — not just presence — or a removed user
  // could still view this screen.
  if (!myParticipation || myParticipation.status !== "APPROVED") {
    const wasRemoved = myParticipation?.status === "WITHDRAWN";
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <HeaderButton
            variant="back"
            onPress={() => router.back()}
            accessibilityLabel="공간에서 돌아가기"
          />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {space.name}
          </Text>
          <View style={styles.headerSideSpacer} />
        </View>
        <View style={styles.centerContainer}>
          <Feather name="lock" size={36} color={Colors.zinc300} />
          <Text style={styles.errorText}>
            {wasRemoved ? "더 이상 참여할 수 없는 공간이에요" : "참여하지 않은 공간이에요"}
          </Text>
          <Text style={styles.errorSubText}>
            {wasRemoved
              ? "공간장에 의해 공간 참여가 종료됐어요"
              : "초대 문구로 참여 신청 후 공간장 승인을 받으세요"}
          </Text>
          <ScalePressable style={styles.retryButtonOuter} contentStyle={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryButtonText}>돌아가기</Text>
          </ScalePressable>
        </View>
      </View>
    );
  }

  const statusStyle = spaceStatusStyle(space.status);
  const statusText = spaceStatusLabel(space.status);

  // ─── Main content ───────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <HeaderButton
          variant="back"
          onPress={() => router.back()}
          accessibilityLabel="공간에서 돌아가기"
        />
        {isOperator ? (
          <HeaderButton
            variant="menu"
            onPress={() => setShowKebabSheet(true)}
            accessibilityLabel="공간 운영 메뉴 열기"
          />
        ) : (
          <View style={styles.headerSideSpacer} />
        )}
      </View>

      <ScrollView
        ref={spaceScrollRef}
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 80 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        onScroll={handleSelectionScroll}
        scrollEventThrottle={16}
        scrollEnabled={!isOverlayActive}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refetchAll}
            tintColor={Colors.zinc400}
          />
        }
      >
        {/* ── Space info flat section ── */}
        <View style={styles.infoSection}>
          {/* Badge row */}
          <View style={[styles.badgeRow, { marginBottom: 6 }]}>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: statusStyle.backgroundColor,
                  borderColor: statusStyle.borderColor,
                  borderWidth: statusStyle.borderWidth,
                },
              ]}
            >
              <Text style={[styles.statusBadgeText, { color: statusStyle.textColor }]}>
                {statusText}
              </Text>
            </View>
            {isOperator ? (
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>내 공간</Text>
              </View>
            ) : null}
            {space.isAnonymous && (
              <View style={styles.anonBadge}>
                <Feather name="eye-off" size={10} color={Colors.zinc400} />
                <Text style={styles.anonBadgeText}>익명</Text>
              </View>
            )}
          </View>

          {/* Space name — visually dominant title block */}
          <Text style={[styles.spaceName, { marginBottom: 12 }]}>{space.name}</Text>

          {/* Description with expand/collapse */}
          <View style={{ marginBottom: 16 }}>
            <DescriptionSection
              space={space}
              isOperator={isOperator}
              userId={userId}
              onSaved={handleDescriptionSaved}
            />
          </View>

          {/* Unified meta group */}
          <View style={styles.metaGroup}>
            <View style={styles.metaIconRow}>
              <Feather name="users" size={12} color={Colors.zinc400} />
              <Text style={styles.metaIconRowText}>
                참여자 {space.participantCount}
                {recruitmentCapacity != null ? `/${recruitmentCapacity}` : ""}명
                {" · "}편지 {letters.length}개
              </Text>
            </View>

            {(space as any).startsAt ? (
              <View style={styles.metaIconRow}>
                <Feather name="calendar" size={12} color={Colors.zinc400} />
                <Text style={styles.metaIconRowText}>
                  {(() => {
                    const d = new Date((space as any).startsAt);
                    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} 시작`;
                  })()}
                </Text>
              </View>
            ) : null}

            {(space.defaultCenterInterval != null && space.defaultCenterCount != null) ? (
              <View style={styles.metaIconRow}>
                <Feather name="repeat" size={12} color={Colors.zinc400} />
                <Text style={styles.metaIconRowText}>
                  {`${space.defaultCenterInterval}일마다 중심글 ${space.defaultCenterCount}개`}
                </Text>
              </View>
            ) : null}

            {(!space.isAnonymous || isOperator) && space.creatorNickname ? (
              !space.isAnonymous ? (
                <View style={styles.metaIconRow}>
                  <Feather name="user-check" size={12} color={Colors.zinc400} />
                  <Text style={styles.metaIconRowText}>{space.creatorNickname}</Text>
                </View>
              ) : (
                <View style={styles.metaIconRow}>
                  <Feather name="user-check" size={12} color={Colors.zinc400} />
                  <Text style={styles.metaIconRowText}>{space.creatorNickname}</Text>
                </View>
              )
            ) : space.isAnonymous && !isOperator ? (
              <View style={styles.metaIconRow}>
                <Feather name="user-check" size={12} color={Colors.zinc400} />
                <Text style={styles.metaIconRowText}>익명 공간장</Text>
              </View>
            ) : null}
          </View>

          {isOperator && isRecruiting && space.inviteCode ? (
            <View style={[styles.inviteCodeRow, { marginTop: 12 }]}>
              <View style={styles.inviteCodeRowLeft}>
                <Text style={styles.inviteCodeLabel}>초대 문구</Text>
                <ScalePressable
                  style={styles.inviteCodeValuePressable}
                  contentStyle={styles.inviteCodeValuePressableContent}
                  onPress={handleCopyInviteCode}
                  hitSlop={8}
                >
                  <Text style={styles.inviteCodeValue}>{space.inviteCode}</Text>
                </ScalePressable>
              </View>
            </View>
          ) : null}

          {isCapacityFull && !isOperator && (
            <View style={[styles.recruitmentClosedBanner, { marginTop: 12, marginHorizontal: 0 }]}>
              <Feather name="slash" size={13} color={Colors.zinc500} />
              <Text style={styles.recruitmentClosedText}>모집이 마감됐어요</Text>
            </View>
          )}
        </View>

        {/* ── Info / rounds separator ── */}
        <View style={styles.infoSeparator} />

        {/* ── Rounds sections / Recruiting planned info ── */}
        {isRecruiting ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>공간 예정 정보</Text>
            </View>
            <View style={styles.recruitingInfoCard}>
              <View style={styles.recruitingInfoRow}>
                <Text style={styles.recruitingInfoLabel}>시작 예정일</Text>
                <Text style={styles.recruitingInfoValue}>
                  {formatPlannedDate((space as any).plannedStartsAt)}
                </Text>
              </View>
              <View style={styles.recruitingInfoRow}>
                <Text style={styles.recruitingInfoLabel}>예정 회차 수</Text>
                <Text style={styles.recruitingInfoValue}>{space.roundCount}회</Text>
              </View>
              <View style={styles.recruitingInfoRow}>
                <Text style={styles.recruitingInfoLabel}>중심글 간격</Text>
                <Text style={styles.recruitingInfoValue}>
                  {`${space.defaultCenterInterval}일`}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.section}>
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
                {sortSpaceRoundsForDetail(rounds, now).map((round) => (
                    <RoundSection
                      key={round.id}
                      round={round}
                      letters={lettersByRound[round.id] ?? []}
                      spaceStatus={space.status}
                      isOperator={isOperator}
                      isAnonymous={space.isAnonymous}
                      spaceName={space.name}
                      now={now}
                      onPressLetter={handlePressLetter}
                      pendingCenterReservations={pendingCenterReservations}
                      isPendingCenterLettersFetching={scheduledSendsQuery.isFetching}
                      onPressWriteOpening={handlePressWriteOpening}
                      hiddenCardId={selectedArticleId}
                      spaceId={id}
                      userId={userId}
                      onScheduleSlot={handleScheduleSlot}
                    />
                  ))}
              </View>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Operator "공간 시작하기" CTA (RECRUITING state only) ── */}
      {isOperator && isRecruiting && (() => {
        const isOverdue =
          (space as any).plannedStartsAt
            ? new Date((space as any).plannedStartsAt) < new Date()
            : false;
        return (
          <ScalePressable
            style={[styles.floatingBtnOuter, { bottom: insets.bottom + 16 }]}
            contentStyle={[
              styles.floatingBtn,
              isOverdue && styles.floatingBtnUrgent,
            ]}
            onPress={() =>
              router.push({
                pathname: "/of-space-start" as never,
                params: { id },
              })
            }
          >
            <Feather name="play" size={15} color={Colors.white} />
            <Text style={[styles.floatingBtnText, isOverdue && styles.floatingBtnTextUrgent]}>
              공간 시작하기
              {isOverdue ? " (예정일 경과)" : ""}
            </Text>
          </ScalePressable>
        );
      })()}

      {/* ── Participant recruiting notice bar ── */}
      {!isOperator && isRecruiting && (
        <View style={[styles.archivedNoticeBar, { paddingBottom: insets.bottom + 12 }]}>
          <Feather name="clock" size={13} color={Colors.zinc500} />
          <Text style={styles.archivedNoticeText}>공간장이 곧 시작할 예정입니다</Text>
        </View>
      )}

      {/*
        ── "예약 목록" entry point ──
        Shown to every eligible user — operator or participant — once the
        space has left the recruiting stage, regardless of operator role.
        Archived spaces still get the entry point; the destination screen
        itself explains that new reservations/changes are blocked there.
      */}
      {!isRecruiting && (
        <ScalePressable
          style={[styles.floatingBtnOuter, { bottom: insets.bottom + 16 }]}
          contentStyle={styles.floatingBtn}
          onPress={handleOpenScheduleList}
        >
          <Feather name="send" size={15} color={Colors.white} />
          <Text style={styles.floatingBtnText}>{isArchived ? "예약 목록 보기" : "예약 목록"}</Text>
        </ScalePressable>
      )}

      {/* ── Operator kebab action sheet ── */}
      <ActionSheetModal
        visible={showKebabSheet}
        onClose={() => setShowKebabSheet(false)}
        actions={[
          ...(isRecruiting
            ? [
                {
                  label: "기본 설정",
                  onPress: () => {
                    const spaceId = normalizeSpaceRouteId(id);
                    if (!spaceId) {
                      showToast({
                        message: "공간 정보를 확인할 수 없어요. 다시 시도해주세요.",
                        type: "error",
                      });
                      return;
                    }
                    router.push({
                      pathname: "/of-space-basic-settings" as never,
                      params: { id: spaceId },
                    });
                  },
                },
              ]
            : []),
          {
            label: "회차 관리",
            onPress: () =>
              router.push({
                pathname: "/of-space-rounds" as never,
                params: { id, spaceName: space.name },
              }),
          },
          {
            label: "참여자 관리",
            onPress: () =>
              router.push({
                pathname: "/of-space-participants" as never,
                params: { id, spaceName: space.name },
              }),
          },
          ...(!isArchived
            ? [
                {
                  label: "공간 보관",
                  onPress: () => {
                    wentToArchiveRef.current = true;
                    router.push({
                      pathname: "/of-space-archive" as never,
                      params: { id, spaceName: space.name },
                    });
                  },
                },
              ]
            : []),
          {
            label: "취소",
            style: "cancel" as const,
            onPress: () => {},
          },
        ]}
      />

      {/* ── Card select overlay (shared 편지 선택 모드) ── */}
      {renderLetterOverlay()}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const RETRY_BTN_H = 40;

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
  headerSideSpacer: {
    width: Sizing.headerButtonTouchSize,
    height: Sizing.headerButtonTouchSize,
    flexGrow: 0,
    flexShrink: 0,
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
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 18,
    marginTop: -4,
  },
  retryButtonOuter: {
    marginTop: 4,
    height: RETRY_BTN_H,
    alignSelf: "center",
  },
  retryButton: {
    paddingHorizontal: 20,
    backgroundColor: Colors.zinc900,
    borderRadius: 10,
    flexGrow: 0,
    height: "100%",
    justifyContent: "center",
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

  // ─── Info flat section ─────────────────────────────────────────────────────
  infoSection: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 4,
    paddingBottom: 16,
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
    fontSize: 12,
    fontWeight: "600",
  },
  roleBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: "#92323D",
  },
  roleBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
    color: Colors.white,
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
    fontSize: 12,
    color: Colors.zinc500,
  },
  spaceName: {
    fontFamily: Platform.select({ ios: "Pretendard-Black", default: "Pretendard-Black" }),
    fontSize: 26,
    fontWeight: "900" as const,
    color: Colors.zinc900,
    lineHeight: 32,
    letterSpacing: -0.3,
  },
  metaGroup: {
    gap: 5,
  },
  metaIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaIconRowText: {
    ...Typography.captionMedium,
    fontSize: 12,
    color: Colors.zinc500,
  },
  infoSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.zinc200,
    marginTop: 4,
  },
  descMoreBtn: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    marginTop: 4,
  },
  descRowOuter: {
    minHeight: 20,
  },
  descRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
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
    color: Colors.zinc400, // typography-ok: empty-description placeholder
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
    fontSize: 12,
    fontWeight: "600",
    color: Colors.zinc500,
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
    color: Colors.zinc500,
  },
  // ─── Rounds list ───────────────────────────────────────────────────────────
  roundsList: {
    gap: 24,
  },
  roundSection: {
    gap: 10,
    paddingTop: 2,
    paddingBottom: 4,
  },
  roundSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
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
    fontSize: 12,
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
    color: Colors.zinc600,
    flex: 1,
  },
  roundLetterCount: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  roundDateRange: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    paddingHorizontal: Spacing.screenPx,
    marginTop: -4,
  },
  roundDescription: {
    ...Typography.body,
    fontSize: 12,
    color: Colors.zinc500,
    lineHeight: 17,
    paddingHorizontal: Spacing.screenPx,
    marginTop: -4,
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
    marginHorizontal: Spacing.screenPx,
    backgroundColor: Colors.zinc100,
    borderRadius: 10,
  },
  lockedText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc400, // typography-ok: locked/disabled state
  },

  // ─── Slot carousel ────────────────────────────────────────────────────────
  slotLoadingRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  slotCarouselContent: {
    paddingLeft: SC_LEFT_PAD,
    paddingRight: SC_LEFT_PAD,
    gap: SC_CARD_GAP,
  },
  slotCard: {
    width: SC_CARD_W,
    height: SC_CARD_H,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    justifyContent: "space-between",
  },
  slotCardMine: {
    backgroundColor: Colors.zinc100,
    borderColor: Colors.zinc300,
  },
  slotCardOther: {
    backgroundColor: Colors.zinc50,
    borderColor: Colors.zinc200,
  },
  slotCardTop: {
    alignItems: "flex-start",
  },
  slotCardMiddle: {
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-start",
    paddingTop: 8,
  },
  slotCardMyText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc700,
  },
  slotCardOtherText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  slotCtaOuter: {
    marginBottom: 8,
  },
  slotCta: {
    backgroundColor: Colors.zinc900,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: "center",
  },
  slotCtaText: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.white,
  },
  slotCardFooter: {
    gap: 2,
  },
  slotNickname: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  slotDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },

  preparingArea: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    marginHorizontal: Spacing.screenPx,
  },
  preparingText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
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

  // ─── Recruiting info card ──────────────────────────────────────────────────
  recruitingInfoCard: {
    marginHorizontal: Spacing.screenPx,
    backgroundColor: Colors.zinc50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
    overflow: "hidden",
    gap: 0,
  },
  recruitingInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc200,
  },
  recruitingInfoLabel: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc800,
    flex: 1,
  },
  recruitingInfoValue: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc600,
    textAlign: "right",
  },

  // ─── Floating button ───────────────────────────────────────────────────────
  floatingBtnOuter: {
    position: "absolute",
    alignSelf: "center",
  },
  floatingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 13,
    backgroundColor: Colors.zinc900,
    borderRadius: 999,
  },
  floatingBtnUrgent: {
    backgroundColor: Colors.noticeAccent,
  },
  floatingBtnText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
  floatingBtnTextUrgent: {
    color: Colors.white,
  },

  // ─── Archived notice bar ────────────────────────────────────────────────────
  archivedNoticeBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 12,
    backgroundColor: Colors.zinc50,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc200,
  },
  archivedNoticeText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },

  // ─── Invite code inline row ────────────────────────────────────────────────
  inviteCodeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc200,
  },
  inviteCodeRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flex: 1,
  },
  inviteCodeLabel: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc800,
    flex: 1,
  },
  inviteCodeValue: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc600,
    letterSpacing: 1.5,
    textAlign: "right",
    textDecorationLine: "underline",
  },
  inviteCodeValuePressable: {
    flexShrink: 1,
    alignSelf: "stretch",
  },
  inviteCodeValuePressableContent: {
    alignItems: "flex-end",
    justifyContent: "center",
    paddingLeft: 8,
  },
});
