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
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import ScalePressable from "@/components/shared/ScalePressable";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import CardSelectOverlay, { type OriginLayout, type ChainArticleMeta } from "@/components/CardSelectOverlay/CardSelectOverlay";
import DotIndicator from "@/components/DotIndicator/DotIndicator";
import { useUser } from "@/contexts/UserContext";
import {
  useGetSpaceJoinContext,
  getGetSpaceJoinContextQueryKey,
  useListSpaceRounds,
  getListSpaceRoundsQueryKey,
  useListSpaceLetters,
  getListSpaceLettersQueryKey,
  useUpdateSpace,
  getArticle,
  getGetArticleQueryKey,
  useListSpaceRoundSlots,
  getListSpaceRoundSlotsQueryKey,
} from "@workspace/api-client-react";
import type {
  SpaceRound,
  SpaceLetter,
  SpaceWithCreatorInfo,
  Article,
  ArticleCover,
  SpaceRoundSlotWithUser,
} from "@workspace/api-client-react";
import { useAncestorChain } from "@/hooks/useAncestorChain";
import ActionSheetModal from "@/components/ActionSheetModal/ActionSheetModal";
import { SpaceInfoNote } from "@/components/SpaceInfoNote/SpaceInfoNote";
import { SpaceCopy } from "@/constants/spaceCopy";
import { spaceStatusLabel, spaceStatusStyle } from "@/lib/spaceStatusStyle";
import {
  roundStatusLabel,
  shouldDimSpaceRoundLetter,
  sortSpaceRoundsNewestFirst,
} from "@/lib/spaceRoundPresentation";

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
const SC_CANON_W = Sizing.cardSlotW;
const SC_CANON_H = Sizing.cardH;
const SC_SCALE = SC_CARD_W / SC_CANON_W;

/**
 * Renders `children` (sized to the canonical card box) visually scaled down to
 * fill exactly SC_CARD_W x SC_CARD_H. RN's `scale` is centre-origin, so the
 * inner box is offset by half the size difference to keep both centres aligned;
 * the outer box clips anything outside the scaled result.
 */
function ScaledCardSlot({ children }: { children: React.ReactNode }) {
  return (
    <View style={scaledSlotStyles.outer}>
      <View style={scaledSlotStyles.inner}>{children}</View>
    </View>
  );
}

const scaledSlotStyles = StyleSheet.create({
  outer: {
    width: SC_CARD_W,
    height: SC_CARD_H,
    overflow: "hidden",
  },
  inner: {
    position: "absolute",
    left: (SC_CARD_W - SC_CANON_W) / 2,
    top: (SC_CARD_H - SC_CANON_H) / 2,
    width: SC_CANON_W,
    height: SC_CANON_H,
    transform: [{ scale: SC_SCALE }],
  },
});

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
// Card-snapping carousel. 2+ cards visible + 3rd peeking at right edge.
//   Web  → PanResponder + Animated translate, snaps to card boundary on release
//   Native → horizontal ScrollView with snapToInterval

const SC_SNAP_STEP = SC_CARD_W + SC_CARD_GAP;

function SpaceCarousel({
  letters,
  roundStatus,
  isAnonymous,
  spaceName,
  onCardPress,
  hiddenCardId,
  openingSlot,
}: {
  letters: SpaceLetter[];
  roundStatus: string;
  isAnonymous: boolean;
  spaceName?: string | null;
  onCardPress: (letter: SpaceLetter, layout: OriginLayout) => void;
  hiddenCardId?: string | null;
  openingSlot?: React.ReactNode;
}) {
  const itemCount = letters.length + (openingSlot ? 1 : 0);
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
        // Snap to nearest card boundary, then clamp to valid scroll range
        const rawOffset = Math.max(0, Math.min(scrollOffsetRef.current, max));
        const snapIndex = Math.max(
          0,
          Math.min(Math.round(rawOffset / SC_SNAP_STEP), itemCount - 1),
        );
        // Clamp snap target to max so we never animate past content end
        const snapOffset = Math.min(snapIndex * SC_SNAP_STEP, max);
        // Derive actual index from the clamped offset in case it differs
        const actualIndex = Math.max(
          0,
          Math.min(Math.round(snapOffset / SC_SNAP_STEP), itemCount - 1),
        );
        scrollOffsetRef.current = snapOffset;
        setCurrentIndexRef.current(actualIndex);
        Animated.spring(translateX, {
          toValue: SC_LEFT_PAD - snapOffset,
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

  const letterCards = letters.map((letter, index) => {
    const authorNickname = (letter as any).authorNickname as string | null;
    const displayName = (letter as any).displayName as string | null;
    const title = (letter as any).articleTitle as string | null;
    const authorName = isAnonymous
      ? (displayName ?? "익명")
      : (authorNickname ?? "알 수 없음");

    const globalIndex = (openingSlot ? 1 : 0) + index;
    const isLast = globalIndex === itemCount - 1;

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
        key={letter.id}
        ref={(ref) => { cardSlotRefs.current[index] = ref; }}
        style={[
          spaceCarouselStyles.cardSlot,
          !isLast && { marginRight: SC_CARD_GAP },
          letter.id === hiddenCardId && spaceCarouselStyles.cardSlotHidden,
        ]}
      >
        <ScaledCardSlot>
          <ArticleCardItem
            title={title ?? "제목 없음"}
            authorName={authorName}
            collectionName={spaceName ?? undefined}
            cover={((letter as any).articleCover ?? null) as ArticleCover | null}
            isRead={shouldDimSpaceRoundLetter(roundStatus, letter.isRead)}
            isActive={true}
            onPress={handlePress}
          />
        </ScaledCardSlot>
      </View>
    );
  });

  const cards = [
    ...(openingSlot
      ? [
          <View
            key="__opening_slot"
            style={[
              spaceCarouselStyles.cardSlot,
              letters.length > 0 && { marginRight: SC_CARD_GAP },
            ]}
          >
            {openingSlot}
          </View>,
        ]
      : []),
    ...letterCards,
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
          snapToInterval={SC_SNAP_STEP}
          snapToAlignment="start"
          decelerationRate="fast"
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

// ─── Upcoming Round Slots ─────────────────────────────────────────────────────

function UpcomingRoundSlots({
  spaceId,
  round,
  userId,
  isAnonymous,
  onSchedule,
  openingSlot,
}: {
  spaceId: string;
  round: SpaceRound;
  userId: string;
  isAnonymous: boolean;
  onSchedule: (slot: SpaceRoundSlotWithUser) => void;
  openingSlot?: React.ReactNode;
}) {
  const slotsQuery = useListSpaceRoundSlots(spaceId, round.id, {
    query: {
      enabled: !!spaceId && !!round.id,
      queryKey: getListSpaceRoundSlotsQueryKey(spaceId, round.id),
    },
  });
  const slots = (slotsQuery.data ?? []) as SpaceRoundSlotWithUser[];

  if (slotsQuery.isLoading) {
    return (
      <View style={styles.slotLoadingRow}>
        <ActivityIndicator size="small" color={Colors.zinc300} />
      </View>
    );
  }

  const formatSlotDate = (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };

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
      {slots
        .slice()
        .sort((a, b) => {
          if (a.scheduledDate && b.scheduledDate) {
            return a.scheduledDate < b.scheduledDate ? -1 : a.scheduledDate > b.scheduledDate ? 1 : 0;
          }
          if (a.scheduledDate) return -1;
          if (b.scheduledDate) return 1;
          return a.slotOrder - b.slotOrder;
        })
        .map((slot) => {
          const isMySlot = slot.assignedUserId === userId;
          const showNickname = !isAnonymous || isMySlot;
          return (
            <View
              key={slot.id}
              style={[
                styles.slotCard,
                isMySlot ? styles.slotCardMine : styles.slotCardOther,
              ]}
            >
              <View style={styles.slotCardTop}>
                {isMySlot ? (
                  <Feather name="edit-3" size={18} color={Colors.zinc500} />
                ) : (
                  <Feather name="lock" size={18} color={Colors.zinc300} />
                )}
              </View>
              <View style={styles.slotCardMiddle}>
                {isMySlot ? (
                  <Text style={styles.slotCardMyText}>내 차례</Text>
                ) : (
                  <Text style={styles.slotCardOtherText}>추후 공개</Text>
                )}
              </View>
              {isMySlot && (
                <ScalePressable
                  style={styles.slotCtaOuter}
                  contentStyle={styles.slotCta}
                  onPress={() => onSchedule(slot)}
                >
                  <Text style={styles.slotCtaText}>글 예약하기</Text>
                </ScalePressable>
              )}
              <View style={styles.slotCardFooter}>
                {showNickname && (
                  <Text style={styles.slotNickname} numberOfLines={1}>
                    {isMySlot ? "나" : (slot.assignedUserNickname ?? "멤버")}
                  </Text>
                )}
                {slot.scheduledDate ? (
                  <Text style={styles.slotDate}>
                    {formatSlotDate(slot.scheduledDate)}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
    </ScrollView>
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
  onPressLetter,
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
  spaceName?: string | null;
  onPressLetter: (letter: SpaceLetter, layout: OriginLayout) => void;
  onPressWriteOpening: (round: SpaceRound) => void;
  hiddenCardId?: string | null;
  spaceId: string;
  userId: string;
  onScheduleSlot: (slot: SpaceRoundSlotWithUser) => void;
}) {
  const statusColor = roundStatusColor(round.status);
  const isUpcoming = round.status === "UPCOMING";
  const isSpaceRecruiting = spaceStatus === "RECRUITING";
  const isSpaceArchived = spaceStatus === "ARCHIVED";

  const openingLetter = letters.find((l) => l.letterType === "OPENING") ?? null;
  const hasOpeningLetter = openingLetter !== null;

  // Placeholder card shown when no opening letter exists yet. The write
  // button is only offered while the round is still UPCOMING — once it has
  // started (ACTIVE) or finished (COMPLETED), the reservation screen no
  // longer accepts a new opening-letter booking for it, so showing a
  // pressable button here would deep-link into a dead end. Show an
  // explanatory notice instead.
  const openingPlaceholderNode: React.ReactNode =
    !isSpaceRecruiting
      ? isOperator && !isSpaceArchived
        ? isUpcoming
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
              <Text style={spaceCarouselStyles.openingSlotEmptyText}>이미 회차가{"\n"}시작했어요!</Text>
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
          const authorName = isAnonymous
            ? (displayName ?? "익명")
            : (authorNickname ?? "알 수 없음");
          return (
            <ScaledCardSlot>
              <ArticleCardItem
                title={title ?? "제목 없음"}
                authorName={authorName}
                collectionName={spaceName ?? undefined}
                cover={((letter as any).articleCover ?? null) as ArticleCover | null}
                isRead={letter.isRead}
                isActive={true}
                onPress={() =>
                  onPressLetter(letter, { x: 0, y: 0, width: SC_CARD_W, height: SC_CARD_H })
                }
              />
            </ScaledCardSlot>
          );
        })()
      : openingPlaceholderNode;

  let letterArea: React.ReactNode;

  if (isUpcoming) {
    letterArea = (
      <UpcomingRoundSlots
        spaceId={spaceId}
        round={round}
        userId={userId}
        isAnonymous={isAnonymous}
        onSchedule={onScheduleSlot}
        openingSlot={upcomingOpeningSlotNode}
      />
    );
  } else if (isSpaceRecruiting) {
    letterArea = (
      <View style={styles.lockedArea}>
        <Feather name="clock" size={20} color={Colors.zinc300} />
        <Text style={styles.lockedText}>공간 시작 후 공개</Text>
      </View>
    );
  } else if (letters.length > 0 || openingSlotNode) {
    letterArea = (
      <SpaceCarousel
        letters={letters}
        roundStatus={round.status}
        isAnonymous={isAnonymous}
        spaceName={spaceName}
        onCardPress={onPressLetter}
        hiddenCardId={hiddenCardId}
        openingSlot={openingSlotNode}
      />
    );
  } else {
    letterArea = null;
  }

  const formatRoundDate = (iso: string) => {
    const d = new Date(iso);
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
            {roundStatusLabel(round.status)}
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

  const [showKebabSheet, setShowKebabSheet] = useState(false);

  // ── Track navigation to reader so we can refetch letters on return ───────
  const wentToReaderRef = useRef(false);
  // ── Track navigation to archive screen so we can refetch space state on return ──
  const wentToArchiveRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (wentToReaderRef.current) {
        wentToReaderRef.current = false;
        queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(id) });
      }
      if (wentToArchiveRef.current) {
        wentToArchiveRef.current = false;
        queryClient.invalidateQueries({ queryKey: getGetSpaceJoinContextQueryKey(id, { userId }) });
      }
    }, [queryClient, id, userId]),
  );

  // ── Card select overlay state ─────────────────────────────────────────────
  const [tapLetter, setTapLetter] = useState<SpaceLetter | null>(null);
  const [tapLetterOrigin, setTapLetterOrigin] = useState<OriginLayout | null>(null);
  const [tapArticle, setTapArticle] = useState<Article | null>(null);

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
    { userId },
    { query: { enabled: !!id && !!userId, queryKey: getGetSpaceJoinContextQueryKey(id, { userId }) } },
  );

  const roundsQuery = useListSpaceRounds(id, {
    query: { enabled: !!id, queryKey: getListSpaceRoundsQueryKey(id) },
  });

  const lettersQuery = useListSpaceLetters(id, {
    query: { enabled: !!id, queryKey: getListSpaceLettersQueryKey(id) },
  });

  const joinContext = joinContextQuery.data;
  const space = joinContext?.space;
  const myParticipation = joinContext?.participation;
  const isOperator = myParticipation?.role === "OPERATOR";
  const isArchived = space?.status === "ARCHIVED";
  const isRecruiting = space?.status === "RECRUITING";

  // Recruitment is closed when the space is no longer in RECRUITING status
  // OR when the participant cap has been reached.
  const effectiveMax = space?.maxParticipants != null
    ? (space.operatorParticipates ? space.maxParticipants - 1 : space.maxParticipants)
    : null;

  // Capacity-full flag: participant cap reached (independent of status).
  const isCapacityFull = !!(effectiveMax != null && (space?.participantCount ?? 0) >= effectiveMax);

  const rounds = (roundsQuery.data ?? []) as SpaceRound[];
  const letters = (lettersQuery.data ?? []) as SpaceLetter[];

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
      const key =
        letter.spaceRoundId ??
        (letter.letterType === "OPENING" && firstRoundId ? firstRoundId : "__none__");
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
    lettersQuery.isFetching;

  const refetchAll = useCallback(async () => {
    await Promise.all([
      joinContextQuery.refetch(),
      roundsQuery.refetch(),
      lettersQuery.refetch(),
    ]);
  }, [joinContextQuery, roundsQuery, lettersQuery]);

  const handleDescriptionSaved = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: getGetSpaceJoinContextQueryKey(id, { userId }),
    });
  }, [queryClient, id, userId]);

  const handlePressLetter = useCallback(
    (letter: SpaceLetter, layout: OriginLayout) => {
      setTapLetter(letter);
      setTapLetterOrigin(layout);
      // The carousel response already has the title and cover visible to the
      // user. Seed the overlay with that exact presentation immediately so its
      // origin-scale animation never flashes a loading card or a refetched cover.
      setTapArticle({
        id: letter.sourceArticleId ?? letter.id,
        title: (letter as any).articleTitle ?? "제목 없음",
        cover: ((letter as any).articleCover ?? null) as ArticleCover | null,
        sourceArticleId: null,
      } as Article);
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

  // ── Article chain for the overlay (shared with 수신함/프로필) ──────────────
  // In anonymous spaces we skip ancestor traversal so real author identities
  // in the reply chain are never exposed.
  const isAnonymousSpace = !!space?.isAnonymous;
  const ancestorChain = useAncestorChain(
    isAnonymousSpace ? null : tapArticle?.sourceArticleId,
    queryClient,
  );

  const { chainArticles, chainMetas, chainInitialIndex } = useMemo(() => {
    if (!tapLetter) {
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
              authorName: (slot.article as any).authorNickname ?? null,
              authorId: slot.article.authorId ?? null,
              collectionName: slot.article.collectionName ?? null,
              collectionId: slot.article.collectionId ?? null,
              date: slot.article.letterAt ?? null,
            }
          : {},
      );
    }

    const initIdx = artList.length;
    const authorNickname = (tapLetter as any).authorNickname as string | null;
    const displayName = (tapLetter as any).displayName as string | null;
    const authorName = isAnonymousSpace
      ? (displayName ?? "익명")
      : (authorNickname ?? "알 수 없음");
    // Keep the entry presentation pinned to the exact carousel cover. The
    // fetched article is still used for its sourceArticleId above, but it must
    // not replace the card during the opening animation.
    artList.push({
      ...(tapArticle ?? {}),
      id: tapLetter.sourceArticleId ?? tapLetter.id,
      title: (tapLetter as any).articleTitle ?? "제목 없음",
      cover: ((tapLetter as any).articleCover ?? null) as ArticleCover | null,
    } as Article);
    metaList.push({
      authorName,
      date: tapLetter.createdAt,
      collectionName: space?.name ?? null,
    });

    return { chainArticles: artList, chainMetas: metaList, chainInitialIndex: initIdx };
  }, [tapLetter, tapArticle, ancestorChain, isAnonymousSpace, space?.name]);

  const handleOverlayRead = useCallback(
    (chainIdx: number) => {
      const isTapped = chainIdx === chainInitialIndex;
      const article = chainArticles[chainIdx];
      const letter = tapLetter;
      setTapLetter(null);
      setTapLetterOrigin(null);
      setTapArticle(null);
      if (isTapped) {
        if (!letter?.sourceArticleId) return;
        wentToReaderRef.current = true;
        router.push({
          pathname: "/read" as never,
          params: { articleId: letter.sourceArticleId },
        });
        return;
      }
      if (!article) return;
      router.push({
        pathname: "/read" as never,
        params: { articleId: article.id, mode: "re_read" },
      });
    },
    [tapLetter, chainArticles, chainInitialIndex, router],
  );

  const handleCopyInviteCode = useCallback(async () => {
    if (!space?.inviteCode) return;
    await Clipboard.setStringAsync(space.inviteCode);
    showToast({ message: "초대 문구가 복사됐어요", type: "success" });
  }, [space?.inviteCode, showToast]);

  const handlePressWriteOpening = useCallback(
    (round: SpaceRound) => {
      router.push({
        pathname: "/of-space-schedule-send" as never,
        params: { id, openingRoundId: round.id },
      });
    },
    [router, id],
  );

  const handleScheduleSlot = useCallback(
    (slot: SpaceRoundSlotWithUser) => {
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
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        {isOperator ? (
          <ScalePressable
            onPress={() => setShowKebabSheet(true)}
            hitSlop={12}
            style={styles.kebabBtnOuter}
            contentStyle={styles.kebabBtn}
          >
            <Feather name="more-horizontal" size={20} color={Colors.zinc600} />
          </ScalePressable>
        ) : (
          <View style={{ width: 28 }} />
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 80 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
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
                {effectiveMax != null ? `/${effectiveMax}` : ""}명
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

            {(!space.isAnonymous || isOperator) && (space as any).creatorNickname ? (
              <View style={styles.metaIconRow}>
                <Feather name="user-check" size={12} color={Colors.zinc400} />
                <Text style={styles.metaIconRowText}>{(space as any).creatorNickname}</Text>
              </View>
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
                {sortSpaceRoundsNewestFirst(rounds).map((round) => (
                    <RoundSection
                      key={round.id}
                      round={round}
                      letters={lettersByRound[round.id] ?? []}
                      spaceStatus={space.status}
                      isOperator={isOperator}
                      isAnonymous={space.isAnonymous}
                      spaceName={space.name}
                      onPressLetter={handlePressLetter}
                      onPressWriteOpening={handlePressWriteOpening}
                      hiddenCardId={tapLetter?.id ?? null}
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
          onPress={() =>
            router.push({
              pathname: "/of-space-schedule-send" as never,
              params: { id },
            })
          }
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
      {tapLetter && (
        <CardSelectOverlay
          articles={chainArticles}
          metas={chainMetas}
          initialIndex={chainInitialIndex}
          originLayout={tapLetterOrigin}
          onClose={handleOverlayClose}
          onRead={handleOverlayRead}
        />
      )}
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
  kebabBtnOuter: {
    width: 28,
    height: 28,
  },
  kebabBtn: {
    alignItems: "center",
    justifyContent: "center",
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
