import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  Easing,
  Dimensions,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import RAnimated, {
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
  withSpring,
  runOnJS,
  cancelAnimation,
  interpolate,
  Easing as REasing,
  type SharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
import { getLetterSelectionReadAction } from "@/lib/policies";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import EnvelopeFrontCard from "@/components/EnvelopeCard/EnvelopeFrontCard";
import {
  EnvelopePocketFront,
  EnvelopeFlapClosed,
  EnvelopeFlapOpen,
} from "@/components/EnvelopeCard/EnvelopeLayers";
import { calculateCardReturnDistance } from "./returnDistance";
import ScalePressable from "@/components/shared/ScalePressable";
import type { Article } from "@workspace/api-client-react";
import {
  advanceVisualGate,
  isCurrentVisualReady,
  type VisualGate,
} from "./visualReadiness";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const CARD_W = Sizing.cardSlotW;
const CARD_H = Sizing.cardH;
// ArticleCardItem's own natural radius at canonical width (no cardRadius/
// cardWidth override) — see ArticleCardItem.tsx. Reused here so the hero
// card's open-state radius (progress === 1) always matches it exactly.
const CANONICAL_CARD_RADIUS = 16;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const OVERLAY_GAP = 16;
const SLOT_W = CARD_W + OVERLAY_GAP;

const CAROUSEL_SNAP_THRESHOLD = CARD_W * 0.28;
const CAROUSEL_FLING_VX = 0.45;
const OPEN_MIN_DURATION = 150;
const OPEN_MAX_DURATION = 280;
const OPEN_DURATION_PER_PIXEL = 0.2;
const CLOSE_MIN_DURATION = 150;
const CLOSE_MAX_DURATION = 320;
const CLOSE_DURATION_PER_PIXEL = 0.25;

const REANIMATED_TRANSITION_EASING = REasing.out(REasing.poly(4));
const DISMISS_FADE_DURATION = 100;
const DISMISS_RESISTANCE_DISTANCE = 180;

// Reanimated spring configs, ported 1:1 from the legacy Animated.spring
// {tension, friction} values (Rebound-style springs use the same underlying
// model as Reanimated's {stiffness, damping} at mass:1 — tension↔stiffness,
// friction↔damping).
const SPRING_SWIPE_BACK = { stiffness: 200, damping: 20, mass: 1 };
const SPRING_CAROUSEL_SNAP = { stiffness: 100, damping: 20, mass: 1, overshootClamping: true };
const SPRING_CAROUSEL_RESET = { stiffness: 100, damping: 20, mass: 1 };
// PanResponder's gestureState.vx/vy are in px/ms; RNGH's velocityX/velocityY
// are in px/s. Divide by this to compare against the original px/ms thresholds.
const VELOCITY_UNIT_SCALE = 1000;

function getCoverImageUrl(article: Article | null | undefined): string | null {
  const cover = article?.cover;
  return cover?.type === "image" && cover.imageUrl ? cover.imageUrl : null;
}

const getOpenDuration = (distance: number) =>
  Math.round(
    Math.min(
      OPEN_MAX_DURATION,
      Math.max(OPEN_MIN_DURATION, OPEN_MIN_DURATION + distance * OPEN_DURATION_PER_PIXEL),
    ),
  );

const getCloseDuration = (distance: number) =>
  Math.round(
    Math.min(
      CLOSE_MAX_DURATION,
      Math.max(CLOSE_MIN_DURATION, CLOSE_MIN_DURATION + distance * CLOSE_DURATION_PER_PIXEL),
    ),
  );

export interface OriginLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChainArticleMeta {
  authorName?: string | null;
  authorId?: string | null;
  collectionName?: string | null;
  collectionId?: string | null;
  /** Space id backing the same displayed collectionName, when the letter came from a Space. */
  spaceId?: string | null;
  date?: string | Date | null;
  /** Mirrors the dimmed state of the card that opened the overlay. */
  isRead?: boolean;
  /** Article-level completion history, independent of the current delivery. */
  hasReadBefore?: boolean;
}

/** @deprecated Use ChainArticleMeta */
export type AdjacentMeta = ChainArticleMeta;

export interface EnvelopeInfo {
  senderName?: string | null;
  senderLocation?: string | null;
  recipientName?: string | null;
  onOpen: () => Promise<void>;
}

type EnvelopePhase = "sealed" | "opening" | "revealed";

function formatDate(visibleAt: string | Date): string {
  const utcMs = new Date(visibleAt).getTime();
  const kstDate = new Date(utcMs + KST_OFFSET_MS);
  const month = kstDate.getUTCMonth() + 1;
  const day = kstDate.getUTCDate();
  return `${month}월 ${day}일`;
}

/**
 * One carousel slot's opacity, driven by the Reanimated `progress` shared
 * value (UI thread). Extracted to its own component because `useAnimatedStyle`
 * is a hook and each mapped slot needs its own stable call site.
 * Equivalent to the old `i === initialIndex ? 1 : progressDetailsOpacity`.
 */
function CarouselSlotFrame({
  progress,
  isInitial,
  style,
  children,
}: {
  progress: SharedValue<number>;
  isInitial: boolean;
  style: unknown;
  children: React.ReactNode;
}) {
  const animatedStyle = useAnimatedStyle(
    () => ({
      opacity: isInitial ? 1 : interpolate(progress.value, [0, 0.55, 1], [0, 0, 1]),
    }),
    [isInitial],
  );
  return (
    <RAnimated.View style={[style as never, animatedStyle]}>{children}</RAnimated.View>
  );
}
interface CardSelectOverlayProps {
  articles: (Article | null)[];
  metas: ChainArticleMeta[];
  initialIndex: number;
  originLayout: OriginLayout | null;
  onClose: () => void;
  onRead: (index: number) => void;
  /**
   * Called after the origin-sized overlay card has had one frame to mount.
   * Parents use this to hide the source card without leaving a blank handoff
   * frame between the source tree and the Modal portal.
   */
  onReady?: () => void;
  onNavigateToCollection?: (id: string) => void;
  onNavigateToAuthor?: (authorId: string) => void;
  onNavigateToSpace?: (spaceId: string) => void;
  /** Prevents the info bar from navigating back to the screen's current entity. */
  currentCollectionId?: string | null;
  currentAuthorId?: string | null;
  currentSpaceId?: string | null;
  /**
   * The inbox carousel uses the restrained carousel shadow at the source.
   * Cross-fade from that source token to the selection token on the same hero
   * progress, so the return handoff cannot pop a different shadow into view.
   */
  originUsesCarouselShadow?: boolean;
  /**
   * The origin card's resting corner radius (on-screen pixels) when it
   * diverges from the natural canonical-scaled ratio (e.g. a CanonicalCardSlot
   * with an explicit radius override). When set, the hero card's own radius
   * is interpolated against `progress` so it already matches this value the
   * instant the close animation finishes, instead of the underlying static
   * slot popping to a different radius once the Modal unmounts. The open-state
   * (progress === 1) radius is always the untouched natural canonical value —
   * only omit this to keep every other caller's existing behavior.
   */
  originCardRadius?: number;
  /**
   * When provided, the item at initialIndex is a sealed envelope.
   * The overlay shows the envelope front face first and plays an opening
   * animation when the user taps "개봉하기".
   */
  envelopeInfo?: EnvelopeInfo | null;
  /**
   * When provided and the item is not a sealed envelope, renders a secondary
   * action button to the LEFT of the "읽기" CTA so both actions share the bar.
   * Typical use: a visibility toggle button (🌐 / 👥) on the records tab.
   */
  visibilityButton?: {
    icon: React.ComponentProps<typeof Feather>["name"];
    label: string;
    disabled: boolean;
    onPress: () => void;
  } | null;
  /**
   * Optional content rendered inside the CardSelectOverlay's native Modal window.
   * Use this for confirm/info dialogs that must appear above the overlay backdrop —
   * sibling RN Modals cannot guarantee z-order over a previously-presented Modal.
   * Render as an absolute-fill View overlay (not a nested RN Modal).
   */
  inlineModal?: React.ReactNode;
  /**
   * When an inline dialog is active, Android's hardware Back button fires the
   * Modal's onRequestClose. Provide this handler (with any in-flight guard)
   * so Back dismisses the dialog instead of closing the whole overlay.
   * When omitted, Back falls through to the normal overlay close.
   */
  onInlineModalRequestClose?: () => void;
}

export default function CardSelectOverlay({
  articles,
  metas,
  initialIndex,
  originLayout,
  onClose,
  onRead,
  onReady,
  onNavigateToCollection,
  onNavigateToAuthor,
  onNavigateToSpace,
  currentCollectionId,
  currentAuthorId,
  currentSpaceId,
  originUsesCarouselShadow = false,
  originCardRadius,
  envelopeInfo,
  visibilityButton,
  inlineModal,
  onInlineModalRequestClose,
}: CardSelectOverlayProps) {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const count = articles.length;
  const isOpen = count > 0;

  // ── Frozen refs for close animation ───────────────────────────────────────
  const frozenArticles = useRef<(Article | null)[]>(articles);
  const frozenMetas = useRef<ChainArticleMeta[]>(metas);
  if (isOpen) {
    frozenArticles.current = articles;
    frozenMetas.current = metas;
  }
  const displayArticles = frozenArticles.current;
  const displayMetas = frozenMetas.current;

  const frozenOrigin = useRef(originLayout);
  if (originLayout) frozenOrigin.current = originLayout;
  const displayOrigin = frozenOrigin.current;

  // ── Info bar scroll state ─────────────────────────────────────────────────
  const [infoBarOverflowing, setInfoBarOverflowing] = useState(false);
  const [infoBarAtEnd, setInfoBarAtEnd] = useState(false);
  const infoScrollX = useRef(0);
  const infoContentW = useRef(0);
  const infoViewW = useRef(0);

  const handleInfoContentSizeChange = useCallback((contentW: number) => {
    infoContentW.current = contentW;
    const overflows = contentW > infoViewW.current + 1;
    setInfoBarOverflowing(overflows);
    if (!overflows) setInfoBarAtEnd(false);
    else setInfoBarAtEnd(infoScrollX.current + infoViewW.current >= contentW - 1);
  }, []);

  const handleInfoLayout = useCallback((viewW: number) => {
    infoViewW.current = viewW;
    const overflows = infoContentW.current > viewW + 1;
    setInfoBarOverflowing(overflows);
    if (!overflows) setInfoBarAtEnd(false);
    else setInfoBarAtEnd(infoScrollX.current + viewW >= infoContentW.current - 1);
  }, []);

  const handleInfoScroll = useCallback((x: number) => {
    infoScrollX.current = x;
    setInfoBarAtEnd(x + infoViewW.current >= infoContentW.current - 1);
  }, []);

  const showGradient = infoBarOverflowing && !infoBarAtEnd;

  // ── Geometry ─────────────────────────────────────────────────────────────
  const reservedBelow = 64;
  const cardTopVisual = topInset + Math.round(SCREEN_H * 0.025);
  const buttonBlock = 56 + 16 + bottomInset + 16;
  const availableH = SCREEN_H - cardTopVisual - buttonBlock - reservedBelow;
  const maxScaleH = availableH / CARD_H;
  const maxScaleW = (SCREEN_W - 48) / CARD_W;
  const finalScale = Math.max(1.0, Math.min(1.1, maxScaleW, maxScaleH));

  const scaledW = CARD_W * finalScale;
  const scaledH = CARD_H * finalScale;
  const finalCenterX = SCREEN_W / 2;
  const finalCenterY = cardTopVisual + scaledH / 2;
  const cardBoxLeft = finalCenterX - CARD_W / 2;
  const infoBoxLeft = finalCenterX - scaledW / 2;
  const boxTop = finalCenterY - CARD_H / 2;

  const originScale =
    displayOrigin?.width ? displayOrigin.width / CARD_W : 1;
  const originCenterX = displayOrigin
    ? displayOrigin.x + displayOrigin.width / 2
    : finalCenterX;
  const originCenterY = displayOrigin
    ? displayOrigin.y + displayOrigin.height / 2
    : finalCenterY;
  const startTx = originCenterX - finalCenterX;
  const startTy = originCenterY - finalCenterY;

  const detailsTop = cardTopVisual + scaledH + 14;

  // ── Animated values ───────────────────────────────────────────────────────
  // The hero grow/shrink progress, the swipe-to-dismiss offset, the carousel
  // drag offset, and the details fade all run on the UI thread via
  // Reanimated shared values, driven by react-native-gesture-handler
  // (Gesture.Pan) instead of the legacy PanResponder + Animated API.
  const progress = useSharedValue(0);
  const swipeY = useSharedValue(0);
  const carouselX = useSharedValue(0);
  const detailsFade = useSharedValue(1);
  const verticalDismissActiveRef = useRef(false);
  const detailsDismissCapturedRef = useRef(false);

  // When the origin slot pins a resting radius that diverges from the
  // natural canonical-scaled ratio (see `originCardRadius` doc above), keep
  // the hero card's on-screen radius equal to that exact value at
  // progress === 0 and to the untouched natural canonical radius at
  // progress === 1, interpolating in between on the UI thread so the close
  // animation's last frame already matches the static slot underneath —
  // no pop once the Modal unmounts and the real slot takes over.
  const hasOriginCardRadius = originCardRadius != null;
  const cardRadiusOverride = useDerivedValue(() => {
    if (!hasOriginCardRadius) return 0;
    const scale = interpolate(progress.value, [0, 1], [originScale, finalScale]);
    const onScreenRadius = interpolate(
      progress.value,
      [0, 1],
      [originCardRadius as number, CANONICAL_CARD_RADIUS * finalScale],
    );
    return onScreenRadius / scale;
  });

  // ── Envelope animation values ─────────────────────────────────────────────
  const [envelopePhase, setEnvelopePhase] = useState<EnvelopePhase>("sealed");
  const [envelopeOpening, setEnvelopeOpening] = useState(false);
  const ctaButtonOpacity = useRef(new Animated.Value(1)).current;
  // flipProgress 0→1: 0–0.5 = Layer-1 (back) rotateY 0→−90, 0.5–1 = front stack rotateY 90→0
  const flipProgress = useRef(new Animated.Value(0)).current;
  // flapOpenProgress 0→1: top flap (Layer 3) rotateX 0→−168 (lifts up, top-hinged)
  const flapOpenProgress = useRef(new Animated.Value(0)).current;
  // envelopeSlideProgress 0→1: entire front stack slides down off screen
  const envelopeSlideProgress = useRef(new Animated.Value(0)).current;
  // revealProgress 0→1: inner letter card scales up after envelope has left
  const revealProgress = useRef(new Animated.Value(0)).current;
  const letterScale = useRef(new Animated.Value(1)).current;
  const letterOpacity = useRef(new Animated.Value(0)).current;

  // Interpolated 3-D transforms
  const frontRotY = flipProgress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["0deg", "-90deg", "-90deg"],
  });
  const backRotY = flipProgress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["90deg", "90deg", "0deg"],
  });
  const flapRotX = flapOpenProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-168deg"],
  });
  // The flap starts on top of the card (white, covering it). As it rotates open
  // (rotateX 0deg → -168deg) it passes through -90deg, where it is edge-on to the
  // viewer and momentarily invisible — exactly aligned with the envelope's top edge.
  // That crossover (progress = 90/168 ≈ 0.536) is where front/back faces meet in 3D,
  // so we swap the white top flap for the gray bottom flap at that instant. The swap
  // is hidden because the flap has zero projected height there.
  const FLAP_EDGE_ON = 90 / 168; // ≈ 0.5357
  const flapTopOpacity = flapOpenProgress.interpolate({
    inputRange: [0, FLAP_EDGE_ON - 0.001, FLAP_EDGE_ON],
    outputRange: [1, 1, 0],
  });
  const flapBottomOpacity = flapOpenProgress.interpolate({
    inputRange: [0, FLAP_EDGE_ON - 0.001, FLAP_EDGE_ON],
    outputRange: [0, 0, 1],
  });
  // The ONE letter card: tucked inside the envelope small, scales to full size
  // (1.0) after the envelope body has slid away. revealProgress drives the growth.
  const innerLetterScale = revealProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1],
  });
  const innerLetterTransY = revealProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });
  // Front stack slides down off screen after flap opens
  const envelopeSlideY = envelopeSlideProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCREEN_H + CARD_H],
  });

  // ── Carousel state ────────────────────────────────────────────────────────
  const [rendered, setRendered] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const closingRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const countRef = useRef(count);
  const gestureDirRef = useRef<null | "h" | "v">(null);
  const openedRef = useRef(false);
  const openSessionRef = useRef(0);
  const modalShownSessionRef = useRef(0);
  const cardLayoutSessionRef = useRef(0);
  const readyNotifiedSessionRef = useRef(0);
  const visualReadySessionRef = useRef(0);
  const visualGateRef = useRef<VisualGate>({
    key: "",
    token: 0,
    session: 0,
    slotIndex: -1,
    imageUrl: null,
  });

  countRef.current = displayArticles.length;

  // ── Derived animated styles (UI thread, driven by `progress`) ─────────────
  // The hero card's own translate/scale. Nested inside the gesture-owned
  // outer `cardContainer` (which carries only the `swipeY` dismiss offset),
  // so the rendered transform is identical to the old single combined
  // [translateX, translateY(progress+swipeY), scale] array: translation
  // amounts add regardless of which node applies them, and neither node
  // scales the other's contribution.
  const cardHeroAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [startTx, 0]) },
      { translateY: interpolate(progress.value, [0, 1], [startTy, 0]) },
      { scale: interpolate(progress.value, [0, 1], [originScale, finalScale]) },
    ],
  }));
  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  // Multiplies with the drag-driven `detailsFade` shared value via
  // nested-view opacity composition rather than a single combined style,
  // since progress and detailsFade are updated independently (hero
  // open/close vs. gesture-driven drags).
  const progressDetailsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.55, 1], [0, 0, 1]),
  }));
  // Vertical-dismiss drag offset applied to the card container.
  const cardSwipeYAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: swipeY.value }],
  }));
  // Horizontal carousel drag offset applied to the carousel track.
  const carouselXAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: carouselX.value }],
  }));
  // Fade applied while dragging (either direction) via cardPanGesture /
  // detailsPanGesture, composed multiplicatively with progressDetailsAnimatedStyle.
  const ctaFadeAnimatedStyle = useAnimatedStyle(() => ({
    opacity: detailsFade.value,
  }));
  // ── Open / close lifecycle ────────────────────────────────────────────────

  const startOpenSpringWhenReady = useCallback(() => {
    const session = openSessionRef.current;
    if (!openedRef.current) return;
    // React Native's Modal is presented asynchronously. On web the mounted
    // card's layout is sufficient; native needs both the portal show event and
    // the card's actual layout before it can replace the source slot.
    if (
      (Platform.OS !== "web" && modalShownSessionRef.current !== session) ||
      cardLayoutSessionRef.current !== session ||
      visualReadySessionRef.current !== session ||
      readyNotifiedSessionRef.current === session
    ) {
      return;
    }

    readyNotifiedSessionRef.current = session;
    onReadyRef.current?.();

    requestAnimationFrame(() => {
      if (
        !openedRef.current ||
        openSessionRef.current !== session ||
        readyNotifiedSessionRef.current !== session
      ) {
        return;
      }
      progress.value = withTiming(1, {
        duration: getOpenDuration(
          Math.hypot(startTx, startTy) +
            Math.abs(finalScale - originScale) * CARD_W,
        ),
        easing: REANIMATED_TRANSITION_EASING,
      });
    });
  }, [progress]);

  const handleModalShow = useCallback(() => {
    modalShownSessionRef.current = openSessionRef.current;
    startOpenSpringWhenReady();
  }, [startOpenSpringWhenReady]);

  const handleOriginCardLayout = useCallback(() => {
    cardLayoutSessionRef.current = openSessionRef.current;
    startOpenSpringWhenReady();
  }, [startOpenSpringWhenReady]);

  const initialImageUrl = getCoverImageUrl(displayArticles[initialIndex]);
  const initialVisualKey = `${initialIndex}:${displayArticles[initialIndex]?.id ?? "loading"}:${initialImageUrl ?? ""}`;

  // This ref is intentionally updated during render: image callbacks need the
  // committed card's current identity, not values captured by an earlier slot.
  // It has no visual side effects and is only read by asynchronous callbacks.
  if (visualGateRef.current.key !== initialVisualKey) {
    visualGateRef.current = advanceVisualGate(visualGateRef.current, {
      key: initialVisualKey,
      session: openedRef.current ? openSessionRef.current : 0,
      slotIndex: initialIndex,
      imageUrl: initialImageUrl,
    });
  }

  const handleCardVisualReady = useCallback(
    (session: number, token: number, slotIndex: number, imageUrl: string) => {
      // Image callbacks can arrive after a close/reopen or after an ancestor
      // slot changes the initial index. Never let an old card unlock a new
      // source-to-modal handoff.
      if (
        !openedRef.current ||
        openSessionRef.current !== session ||
        !isCurrentVisualReady(visualGateRef.current, {
          session,
          token,
          slotIndex,
          imageUrl,
        })
      ) {
        return;
      }
      visualReadySessionRef.current = session;
      startOpenSpringWhenReady();
    },
    [startOpenSpringWhenReady],
  );

  const resetEnvelopeAnim = useCallback(() => {
    const phase: EnvelopePhase = envelopeInfo ? "sealed" : "revealed";
    setEnvelopePhase(phase);
    setEnvelopeOpening(false);
    ctaButtonOpacity.setValue(1);
    flipProgress.setValue(0);
    flapOpenProgress.setValue(0);
    envelopeSlideProgress.setValue(0);
    revealProgress.setValue(0);
    letterScale.setValue(1);
    letterOpacity.setValue(envelopeInfo ? 0 : 1);
  }, [envelopeInfo, flipProgress, flapOpenProgress, envelopeSlideProgress, revealProgress, letterScale, letterOpacity]);

  useEffect(() => {
    if (isOpen) {
      openSessionRef.current += 1;
      const session = openSessionRef.current;
      openedRef.current = true;
      modalShownSessionRef.current = Platform.OS === "web" ? session : 0;
      cardLayoutSessionRef.current = 0;
      readyNotifiedSessionRef.current = 0;
      visualReadySessionRef.current = initialImageUrl ? 0 : session;
      visualGateRef.current = advanceVisualGate(visualGateRef.current, {
        key: initialVisualKey,
        session,
        slotIndex: initialIndex,
        imageUrl: initialImageUrl,
      });
      activeIndexRef.current = initialIndex;
      carouselX.value = -initialIndex * SLOT_W;
      detailsFade.value = 1;
      setActiveIndex(initialIndex);
      setRendered(true);
      closingRef.current = false;
      swipeY.value = 0;
      progress.value = 0;
      resetEnvelopeAnim();
    } else {
      openedRef.current = false;
      if (rendered && !closingRef.current) {
        setRendered(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // A fetched article can replace a seeded card while the overlay is open.
  // Reset readiness when its actual cover URL changes so the source is never
  // hidden while the replacement image is still blank.
  useEffect(() => {
    if (!openedRef.current || !rendered) return;
    const session = openSessionRef.current;
    if (visualGateRef.current.session !== session) return;
    visualReadySessionRef.current = initialImageUrl ? 0 : session;
    startOpenSpringWhenReady();
  }, [initialVisualKey, rendered, initialImageUrl, startOpenSpringWhenReady]);

  // ── Adjust carousel position when ancestors are prepended during loading ──
  const prevInitialIndexRef = useRef(initialIndex);
  useEffect(() => {
    const prev = prevInitialIndexRef.current;
    prevInitialIndexRef.current = initialIndex;
    if (!openedRef.current || !rendered || closingRef.current) return;
    const delta = initialIndex - prev;
    if (delta !== 0) {
      const newActive = activeIndexRef.current + delta;
      activeIndexRef.current = newActive;
      carouselX.value = -newActive * SLOT_W;
      setActiveIndex(newActive);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIndex]);

  // ── Close animation ───────────────────────────────────────────────────────
  const runCloseRef = useRef(() => {});
  runCloseRef.current = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    openedRef.current = false;
    const initIdx = prevInitialIndexRef.current;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const finishClose = () => {
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      // Guard against double-invocation (animation callback + fallback timer).
      if (!closingRef.current) return;
      setRendered(false);
      setIsClosing(false);
      closingRef.current = false;
      onClose();
    };
    const finishCloseWithIndex = (idx: number) => {
      activeIndexRef.current = idx;
      finishClose();
    };

    // Snapshot all transform values before calculating one shared duration.
    // This keeps the return path straight while allowing a farther source slot
    // to take longer than one that is already nearby.
    // `progress`, `swipeY`, and `carouselX` are all Reanimated shared values:
    // cancel any in-flight animation and read `.value` synchronously instead
    // of the legacy Animated.Value `stopAnimation` callback pattern.
    cancelAnimation(progress);
    cancelAnimation(swipeY);
    cancelAnimation(carouselX);
    const currentProgress = progress.value;
    const currentSwipeY = swipeY.value;
    const currentCarouselX = carouselX.value;

    const closeDuration = getCloseDuration(calculateCardReturnDistance({
      startTx,
      startTy,
      originScale,
      finalScale,
      cardWidth: CARD_W,
      progress: currentProgress,
      swipeY: currentSwipeY,
      carouselX: currentCarouselX,
      carouselTargetX: -initIdx * SLOT_W,
    }));

    // Fallback: if the animation callback never fires (race condition or
    // JS scheduler jitter), guarantee cleanup within ~420 ms.
    fallbackTimer = setTimeout(finishClose, CLOSE_MAX_DURATION + 100);

    // Always include the track, even when the active index already equals
    // the initial index: it can sit between snap points after a drag.
    carouselX.value = withTiming(-initIdx * SLOT_W, {
      duration: closeDuration,
      easing: REANIMATED_TRANSITION_EASING,
    });
    swipeY.value = withTiming(
      0,
      { duration: closeDuration, easing: REANIMATED_TRANSITION_EASING },
      (finished) => {
        if (finished) runOnJS(finishCloseWithIndex)(initIdx);
      },
    );

    // Same duration/curve as the pair above, run on the UI thread.
    progress.value = withTiming(
      0,
      { duration: closeDuration, easing: REANIMATED_TRANSITION_EASING },
      (finished) => {
        if (finished) runOnJS(finishClose)();
      },
    );
  };
  const requestClose = useCallback(() => runCloseRef.current(), []);

  // ── Envelope opening animation ────────────────────────────────────────────
  const handleEnvelopeOpen = useCallback(() => {
    if (envelopeOpening || !envelopeInfo) return;
    setEnvelopeOpening(true);
    setEnvelopePhase("opening");
    Animated.timing(ctaButtonOpacity, { toValue: 0, duration: 200, useNativeDriver: false }).start();

    Animated.sequence([
      // Phase 1 (620 ms): rotateY flip — Layer 1 (back) turns away, closed front appears
      Animated.timing(flipProgress, {
        toValue: 1,
        duration: 620,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      }),
      // Brief pause so user sees the sealed front + wax seal
      Animated.delay(280),
      // Phase 2 (1000 ms): top flap (Layer 3) lifts up around its top hinge
      Animated.timing(flapOpenProgress, {
        toValue: 1,
        duration: 1000,
        easing: Easing.out(Easing.poly(3)),
        useNativeDriver: false,
      }),
      // Brief pause so user sees the open envelope
      Animated.delay(0),
      // Phase 3 (480 ms): entire envelope slides down off screen
      Animated.timing(envelopeSlideProgress, {
        toValue: 1,
        duration: 480,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      // Brief pause before letter scales up
      Animated.delay(60),
      // Phase 4 (460 ms): inner letter scales up to full size
      Animated.timing(revealProgress, {
        toValue: 1,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start(() => {
      // Phase 4: hand off to the real reading card (identical end state = seamless)
      letterOpacity.setValue(1);
      letterScale.setValue(1);
      setEnvelopePhase("revealed");
      setEnvelopeOpening(false);
      // Fire server update — don't await, failure is non-critical
      envelopeInfo.onOpen().catch(console.warn);
    });
  }, [envelopeOpening, envelopeInfo, flipProgress, flapOpenProgress, revealProgress, letterOpacity, letterScale]);

  // ── Gesture-driven horizontal carousel + vertical dismiss ─────────────────
  const beginVerticalDismiss = useCallback(() => {
    if (verticalDismissActiveRef.current) return;
    verticalDismissActiveRef.current = true;
    detailsFade.value = withTiming(0, {
      duration: DISMISS_FADE_DURATION,
      easing: REasing.out(REasing.quad),
    });
  }, [detailsFade]);

  const restoreDetailsAfterDismiss = useCallback(() => {
    verticalDismissActiveRef.current = false;
    detailsFade.value = withTiming(1, {
      duration: 120,
      easing: REasing.out(REasing.quad),
    });
  }, [detailsFade]);

  const applyDismissResistance = (distance: number) => {
    const positiveDistance = Math.max(0, distance);
    return (
      (positiveDistance * DISMISS_RESISTANCE_DISTANCE) /
      (DISMISS_RESISTANCE_DISTANCE + positiveDistance)
    );
  };

  // Card container gesture: horizontal carousel drag + vertical dismiss drag.
  // Direction is decided on the first move sample past a 4px threshold (the
  // PanResponder's onMoveShouldSetPanResponder was unreachable dead code,
  // since onStartShouldSetPanResponder always returned true and captured the
  // responder before any movement — the onPanResponderMove re-check below was
  // the actual, load-bearing disambiguation logic, so it is what we port).
  // `.runOnJS(true)` matches the pattern in app/read.tsx and PreviewPager:
  // gesture *recognition* stays on the native UI thread (RNGH), while this
  // callback runs on the JS thread so refs can be mutated directly and
  // withTiming/withSpring still animate the shared values on the UI thread.
  const cardPanGesture = useMemo(
    () =>
      Gesture.Pan()
        // Matches the JS-side 4px direction-decision threshold below (see
        // app/read.tsx's `.minDistance(8)` for the same "keep existing
        // sensitivity, ported at the native-recognizer level" idiom) so a
        // plain tap on the card (handled by ArticleCardItem's own Pressable)
        // is never swallowed by an over-eager native gesture activation.
        .minDistance(4)
        .runOnJS(true)
        .onBegin(() => {
          gestureDirRef.current = null;
          verticalDismissActiveRef.current = false;
        })
        .onUpdate((e) => {
          const dx = e.translationX;
          const dy = e.translationY;
          if (!gestureDirRef.current) {
            if (countRef.current > 1 && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 4) {
              gestureDirRef.current = "h";
              detailsFade.value = withTiming(0, { duration: 120 });
            } else if (Math.abs(dy) > 4) {
              gestureDirRef.current = "v";
              beginVerticalDismiss();
            }
          }
          if (gestureDirRef.current === "h") {
            const baseX = -activeIndexRef.current * SLOT_W;
            const raw = baseX + dx;
            const maxX = 0;
            const minX = -(countRef.current - 1) * SLOT_W;
            const rubber = raw > maxX ? maxX + (raw - maxX) * 0.3 : raw < minX ? minX + (raw - minX) * 0.3 : raw;
            carouselX.value = rubber;
          } else if (gestureDirRef.current === "v") {
            if (dy > 0) swipeY.value = applyDismissResistance(dy);
          }
        })
        .onEnd((e) => {
          if (gestureDirRef.current === "h") {
            const dx = e.translationX;
            const vx = e.velocityX / VELOCITY_UNIT_SCALE;
            const cur = activeIndexRef.current;
            const n = countRef.current;
            let newIdx = cur;
            if (Math.abs(vx) > CAROUSEL_FLING_VX) newIdx = vx < 0 ? cur + 1 : cur - 1;
            else if (Math.abs(dx) >= CAROUSEL_SNAP_THRESHOLD) newIdx = dx < 0 ? cur + 1 : cur - 1;
            newIdx = Math.max(0, Math.min(n - 1, newIdx));
            const changed = newIdx !== activeIndexRef.current;
            activeIndexRef.current = newIdx;
            if (changed) setActiveIndex(newIdx);
            carouselX.value = withSpring(-newIdx * SLOT_W, SPRING_CAROUSEL_SNAP);
            setTimeout(() => {
              detailsFade.value = withTiming(1, { duration: 120 });
            }, 80);
          } else if (gestureDirRef.current === "v") {
            const dy = e.translationY;
            const vy = e.velocityY / VELOCITY_UNIT_SCALE;
            if (dy > 80 || vy > 0.8) runCloseRef.current();
            else {
              swipeY.value = withSpring(0, SPRING_SWIPE_BACK);
              restoreDetailsAfterDismiss();
            }
          } else {
            swipeY.value = withSpring(0, SPRING_SWIPE_BACK);
          }
          gestureDirRef.current = null;
        })
        .onFinalize((_e, success) => {
          // Mirrors onPanResponderTerminate: only fires when the gesture was
          // interrupted (e.g. app backgrounded) rather than normally released
          // — onEnd above already handled the normal-release case, and must
          // not be fought here (in particular, a drag-triggered close is
          // already animating swipeY/progress toward 0 on its own timing).
          if (!success) {
            swipeY.value = withSpring(0, SPRING_SWIPE_BACK);
            restoreDetailsAfterDismiss();
            carouselX.value = withSpring(-activeIndexRef.current * SLOT_W, SPRING_CAROUSEL_RESET);
            gestureDirRef.current = null;
          }
        }),
    [beginVerticalDismiss, restoreDetailsAfterDismiss, carouselX, swipeY, detailsFade],
  );

  // ── Vertical-only pan for details area ───────────────────────────────────
  const detailsPanGesture = useMemo(
    () =>
      Gesture.Pan()
        // This view's child is a horizontal ScrollView (the date/author info
        // row). The old PanResponder deferred to it for horizontal drags via
        // `onMoveShouldSetPanResponder` returning false when `|dx| >= |dy|`;
        // the RNGH equivalent for "only claim the gesture for a
        // vertical-dominant downward drag, else let the ScrollView handle
        // it" is failOffsetX/activeOffsetY at the native-recognizer level
        // (see PreviewPager.tsx's activeOffsetX/failOffsetY for the same
        // idiom, applied to the other axis here). Reuses the same 8px
        // magnitude as the JS-side capture check below.
        .activeOffsetY([-Number.MAX_VALUE, 8])
        .failOffsetX([-8, 8])
        .runOnJS(true)
        .onBegin(() => {
          detailsDismissCapturedRef.current = false;
          verticalDismissActiveRef.current = false;
        })
        .onUpdate((e) => {
          const dx = e.translationX;
          const dy = e.translationY;
          if (!detailsDismissCapturedRef.current) {
            if (dy > 8 && Math.abs(dy) > Math.abs(dx)) {
              detailsDismissCapturedRef.current = true;
            } else {
              return;
            }
          }
          if (dy > 0) {
            beginVerticalDismiss();
            swipeY.value = applyDismissResistance(dy);
          }
        })
        .onEnd((e) => {
          if (!detailsDismissCapturedRef.current) return;
          const dy = e.translationY;
          const vy = e.velocityY / VELOCITY_UNIT_SCALE;
          if (dy > 80 || vy > 0.8) runCloseRef.current();
          else {
            swipeY.value = withSpring(0, SPRING_SWIPE_BACK);
            restoreDetailsAfterDismiss();
          }
        })
        .onFinalize((_e, success) => {
          if (!success && detailsDismissCapturedRef.current) {
            swipeY.value = withSpring(0, SPRING_SWIPE_BACK);
            restoreDetailsAfterDismiss();
          }
          detailsDismissCapturedRef.current = false;
        }),
    [beginVerticalDismiss, restoreDetailsAfterDismiss, swipeY],
  );

  // ── Active card info ──────────────────────────────────────────────────────
  const activeMeta = displayMetas[activeIndex] ?? {};
  const { authorName, authorId, collectionName, collectionId, spaceId, date } = activeMeta;
  const readAction = getLetterSelectionReadAction(
    activeMeta.isRead,
    activeMeta.hasReadBefore,
  );
  const dateLabel = date ? formatDate(date) : "";
  const canTapCollection = !!(
    collectionId &&
    collectionId !== currentCollectionId &&
    onNavigateToCollection
  );
  const canTapSpace = !!(
    spaceId &&
    spaceId !== currentSpaceId &&
    onNavigateToSpace
  );
  const canTapAuthor = !!(
    authorId &&
    authorId !== currentAuthorId &&
    onNavigateToAuthor
  );
  const fadeOverlayOpacity = useSharedValue(0);
  const fadeOverlayStyle = useAnimatedStyle(() => ({ opacity: fadeOverlayOpacity.value }));

  // Reset fade overlay when the Modal closes so it starts fresh next time.
  useEffect(() => {
    if (!rendered) {
      fadeOverlayOpacity.value = 0;
    }
  }, [rendered, fadeOverlayOpacity]);

  const isEnvelopeSealed = !!envelopeInfo && envelopePhase !== "revealed";
  const detailsFadeAnimatedStyle = useAnimatedStyle(
    () => ({ opacity: isEnvelopeSealed ? 0 : detailsFade.value }),
    [isEnvelopeSealed],
  );

  const runReadTransition = useCallback((callback: (index: number) => void) => {
    const idx = activeIndexRef.current;
    fadeOverlayOpacity.value = withTiming(
      1,
      { duration: 700, easing: REasing.in(REasing.ease) },
      (finished) => {
        if (finished) runOnJS(callback)(idx);
      },
    );
  }, [fadeOverlayOpacity]);

  const handleRead = useCallback(() => {
    runReadTransition(onRead);
  }, [onRead, runReadTransition]);

  // The cover is a selection-mode surface, not a read action. Reading is
  // intentionally available only through the explicit "읽기" CTA below.
  const handleCardTap = useCallback(() => undefined, []);

  // ── Envelope overlay — rendered absolutely over the card at initialIndex ──
  const renderEnvelopeLayer = (slotIndex: number) => {
    if (!envelopeInfo || slotIndex !== initialIndex) return null;
    if (envelopePhase === "revealed") return null;

    // The closed flap artwork is full-card sized (triangle base on the card's
    // top edge). It rotates around that top edge, so the hinge pivot is half the
    // card height (translateY −FLAP_PIVOT, rotateX, translateY +FLAP_PIVOT).
    const FLAP_PIVOT = CARD_H / 2;

    // Inside layer renders as two overlapping Views switched by opacity:
    //   • rounded-top version: visible while closed flap is showing (flapTopOpacity)
    //   • square-top version:  visible once open flap appears   (flapBottomOpacity)
    // This avoids animating individual corner radii, which React Native Web
    // does not reliably support for Animated.Value.
    const INSIDE_RADIUS = 16;

    const envArticle = displayArticles[initialIndex] ?? null;
    const envMeta = displayMetas[initialIndex] ?? {};
    const envImageUrl = getCoverImageUrl(envArticle);
    const envVisualGate = visualGateRef.current;

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">

        {/* JSX z-order (bottom → top), per the implementation guide
            (뒤집어진 이후, 봉투 표지 제외 / from top): 닫힌 봉투 덮개 → 봉투 포켓
            → 편지 카드 → 열린 봉투 덮개 → 봉투 안쪽. So bottom → top here is:
              1) 봉투 안쪽 (inside)        — envelope back, gray
              2) 열린 봉투 덮개 (open flap) — gray inner face, revealed at edge-on
              3) 편지 카드 (letter card)    — flips with body, scales up, does NOT slide
              4) 봉투 포켓 (pocket)         — white, V-notch top
              5) 닫힌 봉투 덮개 (closed flap)— white outer + wax seal, rotates open
              6) 봉투 표지 (cover)          — flips away at the start, then gone
            The closed flap rotates (rotateX) and is swapped for the static open
            flap at the exact edge-on instant (progress ≈ 0.536) where it is flat
            and invisible, so the swap reads as one continuous flap. The open flap
            sits below the card, so as the body slides down it never covers it. */}

        {/* 1) 봉투 안쪽 — inner back face (flips + slides). Rendered as a
            code View (not PNG) so the top border-radius can be animated:
            full radius while closed flap is showing, snaps to 0 at the
            open-flap swap so the seam with the open flap is seamless. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { transform: [{ translateY: envelopeSlideY }] }]}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ perspective: 1200 }, { rotateY: backRotY }] },
            ]}
          >
            {/* 닫힌 덮개 표시 중: 상단 모서리 둥글게 */}
            <Animated.View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: CARD_W,
                height: CARD_H,
                backgroundColor: "#f3f3f3",
                borderRadius: INSIDE_RADIUS,
                opacity: flapTopOpacity,
              }}
            />
            {/* 열린 덮개 표시 중: 상단 모서리 직각 */}
            <Animated.View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: CARD_W,
                height: CARD_H,
                backgroundColor: "#f3f3f3",
                borderBottomLeftRadius: INSIDE_RADIUS,
                borderBottomRightRadius: INSIDE_RADIUS,
                opacity: flapBottomOpacity,
              }}
            />
          </Animated.View>
        </Animated.View>

        {/* 2) 열린 봉투 덮개 — open flap inner face. Static image (drawn in final
            opened state, no rotateX). Revealed at the edge-on swap. Sits BELOW
            the card. Shifted up by FLAP_PIVOT so the seal + triangle dangle
            visibly from the top edge of the inside face. Flips + slides with
            the envelope body. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { transform: [{ translateY: envelopeSlideY }] }]}
        >
          <View style={[StyleSheet.absoluteFill, { transform: [{ translateY: -(CARD_W * (596 / 450)) + 2 }] }]}>
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                {
                  opacity: flapBottomOpacity,
                  transform: [{ perspective: 1200 }, { rotateY: backRotY }],
                },
              ]}
            >
              <EnvelopeFlapOpen cardWidth={CARD_W} />
            </Animated.View>
          </View>
        </Animated.View>

        {/* 3) 편지 카드 — the single letter card. Flips in WITH the envelope body
            (backRotY) but does NOT slide away; once the body has dropped,
            revealProgress scales it 0.95 → 1.0. */}
        {envArticle ? (
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ perspective: 1200 }, { rotateY: backRotY }] },
            ]}
          >
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                { transform: [{ translateY: innerLetterTransY }, { scale: innerLetterScale }] },
              ]}
            >
              <ArticleCardItem
                title={envArticle.title ?? "제목 없음"}
                authorName={envMeta.authorName ?? undefined}
                collectionName={envMeta.collectionName ?? undefined}
                cover={envArticle.cover}
                isRead={envMeta.isRead ?? false}
                isActive
                disabled
                onImageReady={
                   envImageUrl &&
                   envVisualGate.slotIndex === initialIndex &&
                   envVisualGate.imageUrl === envImageUrl
                     ? () =>
                         handleCardVisualReady(
                           envVisualGate.session,
                           envVisualGate.token,
                           initialIndex,
                           envImageUrl,
                         )
                     : undefined
                 }
                onPress={handleCardTap}
              />
            </Animated.View>
          </Animated.View>
        ) : null}

        {/* 4) 봉투 포켓 — front pocket (white, V-notch). Flips + slides. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { transform: [{ translateY: envelopeSlideY }] }]}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ perspective: 1200 }, { rotateY: backRotY }] },
            ]}
          >
            <EnvelopePocketFront cardWidth={CARD_W} />
          </Animated.View>
        </Animated.View>

        {/* 5) 닫힌 봉투 덮개 — closed flap (white + wax seal). Rotates open around
            the card's top edge; fades out at the edge-on instant. Shadow marks it
            as the topmost layer. Flips + slides with the body. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { transform: [{ translateY: envelopeSlideY }] }]}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ perspective: 1200 }, { rotateY: backRotY }] },
            ]}
          >
            <Animated.View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: CARD_W,
                height: CARD_H,
                opacity: flapTopOpacity,
                transform: [
                  { perspective: 1400 },
                  { translateY: -FLAP_PIVOT },
                  { rotateX: flapRotX },
                  { translateY: FLAP_PIVOT },
                ],
              }}
            >
              <EnvelopeFlapClosed cardWidth={CARD_W} />
            </Animated.View>
          </Animated.View>
        </Animated.View>

        {/* ══ 6) 봉투 표지 — cover (default face) — flips AWAY ══ */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ perspective: 1200 }, { rotateY: frontRotY }] },
          ]}
        >
          <EnvelopeFrontCard
            senderName={envelopeInfo.senderName}
            senderLocation={envelopeInfo.senderLocation}
            recipientName={envelopeInfo.recipientName}
          />
        </Animated.View>
      </View>
    );
  };

  // ── Skeleton card (for loading slots) ────────────────────────────────────
  const SkeletonCard = () => (
    <View style={styles.skeletonCard}>
      <ActivityIndicator size="small" color={Colors.zinc300} />
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const trackW = SLOT_W * displayArticles.length;

  // Wrap article card at initialIndex in letter reveal animation when envelope
  const wrapWithLetterAnim = (node: React.ReactNode, slotIndex: number) => {
    if (!envelopeInfo || slotIndex !== initialIndex) return node;
    return (
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { opacity: letterOpacity, transform: [{ scale: letterScale }] },
        ]}
      >
        {node}
      </Animated.View>
    );
  };

  return (
    <Modal
      transparent
      visible={rendered}
      animationType="none"
      statusBarTranslucent
      onRequestClose={onInlineModalRequestClose ?? requestClose}
      onShow={handleModalShow}
    >
      {/* Dark backdrop — touch disabled the moment closing begins so the
          underlying screen is immediately interactive even if finishClose is
          delayed by a JS scheduler race. */}
      <RAnimated.View
        pointerEvents={isClosing ? "none" : "auto"}
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropAnimatedStyle]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />
      </RAnimated.View>

      <GestureDetector gesture={cardPanGesture}>
      <RAnimated.View
        style={[
          styles.cardContainer,
          {
            left: cardBoxLeft,
            top: boxTop,
          },
          cardSwipeYAnimatedStyle,
        ]}
        onLayout={handleOriginCardLayout}
      >
        <RAnimated.View style={[styles.cardContainerInner, cardHeroAnimatedStyle]}>
        {displayArticles.length > 1 ? (
          <RAnimated.View style={[styles.carouselTrack, { width: trackW }, carouselXAnimatedStyle]}>
            {displayArticles.map((art, i) => {
              const meta = displayMetas[i] ?? {};
              const imageUrl = getCoverImageUrl(art);
              const visualGate = visualGateRef.current;
              const isCurrentVisualSlot =
                i === visualGate.slotIndex &&
                imageUrl !== null &&
                visualGate.imageUrl === imageUrl;
              return (
                <CarouselSlotFrame
                  key={art?.id ?? `loading-${i}`}
                  progress={progress}
                  isInitial={i === initialIndex}
                  style={[styles.carouselSlot, i < displayArticles.length - 1 && { marginRight: OVERLAY_GAP }]}
                >
                  {art == null ? (
                    <SkeletonCard />
                  ) : (
                    <>
                      {wrapWithLetterAnim(
                        <ArticleCardItem
                          title={art.title ?? "제목 없음"}
                          authorName={meta.authorName ?? undefined}
                          collectionName={meta.collectionName ?? undefined}
                          cover={art.cover}
                          isRead={meta.isRead ?? false}
                          isActive
                          disabled
                          carouselShadow={
                            originUsesCarouselShadow &&
                            i === initialIndex
                          }
                          shadowProgress={
                            originUsesCarouselShadow && i === initialIndex
                              ? progress
                              : undefined
                          }
                          radiusOverride={
                            hasOriginCardRadius && i === initialIndex
                              ? cardRadiusOverride
                              : undefined
                          }
                           onImageReady={
                             isCurrentVisualSlot && imageUrl
                               ? () =>
                                   handleCardVisualReady(
                                     visualGate.session,
                                     visualGate.token,
                                     i,
                                     imageUrl,
                                   )
                               : undefined
                           }
                          onPress={handleCardTap}
                        />,
                        i,
                      )}
                      {renderEnvelopeLayer(i)}
                    </>
                  )}
                </CarouselSlotFrame>
              );
            })}
          </RAnimated.View>
        ) : displayArticles[0] == null ? (
          <SkeletonCard />
        ) : (
          <>
            {(() => {
              const imageUrl = getCoverImageUrl(displayArticles[0]);
              const visualGate = visualGateRef.current;
              const isCurrentVisualSlot =
                visualGate.slotIndex === 0 &&
                imageUrl !== null &&
                visualGate.imageUrl === imageUrl;
              return wrapWithLetterAnim(
                <ArticleCardItem
                  title={displayArticles[0].title ?? "제목 없음"}
                  authorName={displayMetas[0]?.authorName ?? undefined}
                  collectionName={displayMetas[0]?.collectionName ?? undefined}
                  cover={displayArticles[0].cover}
                  isRead={displayMetas[0]?.isRead ?? false}
                  isActive
                  disabled
                  carouselShadow={
                    originUsesCarouselShadow
                  }
                  shadowProgress={
                    originUsesCarouselShadow ? progress : undefined
                  }
                  radiusOverride={
                    hasOriginCardRadius ? cardRadiusOverride : undefined
                  }
                  onImageReady={
                    isCurrentVisualSlot && imageUrl
                      ? () =>
                          handleCardVisualReady(
                            visualGate.session,
                            visualGate.token,
                            0,
                            imageUrl,
                          )
                      : undefined
                  }
                  onPress={handleCardTap}
                />,
                0,
              );
            })()}
            {renderEnvelopeLayer(0)}
          </>
        )}
        </RAnimated.View>
      </RAnimated.View>
      </GestureDetector>

      {/* Details (info bar) — hidden while envelope is sealed. Outer node
          carries the progress-driven fade (Reanimated, UI thread); inner node
          carries the drag-driven detailsFade (Reanimated shared value, driven
          by detailsPanGesture). Nested opacity composes multiplicatively,
          matching the old Animated.multiply. */}
      <RAnimated.View
        style={[styles.detailsContainer, { top: detailsTop, left: infoBoxLeft, right: infoBoxLeft }, progressDetailsAnimatedStyle]}
        pointerEvents={rendered && !isEnvelopeSealed ? "auto" : "none"}
      >
      <GestureDetector gesture={detailsPanGesture}>
      <RAnimated.View style={detailsFadeAnimatedStyle}>
        {dateLabel ? (
          <View style={styles.infoBar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              onLayout={(e) => handleInfoLayout(e.nativeEvent.layout.width)}
              onContentSizeChange={(w) => handleInfoContentSizeChange(w)}
              onScroll={(e) => handleInfoScroll(e.nativeEvent.contentOffset.x)}
              scrollEventThrottle={16}
            >
              <View style={styles.infoRow}>
                <Text style={styles.infoText}>{dateLabel}</Text>
                {authorName ? (
                  <>
                    <Text style={styles.infoSep}>·</Text>
                    {canTapAuthor ? (
                      <Pressable onPress={() => { requestClose(); onNavigateToAuthor!(authorId!); }} hitSlop={6} style={styles.infoTappableRow}>
                        <Text style={styles.infoText}>{authorName}</Text>
                        <Feather name="chevron-right" size={12} color={Colors.zinc700} />
                      </Pressable>
                    ) : (
                      <Text style={styles.infoText}>{authorName}</Text>
                    )}
                  </>
                ) : null}
                {collectionName ? (
                  <>
                    <Text style={styles.infoSep}>·</Text>
                    {canTapCollection ? (
                      <Pressable onPress={() => { requestClose(); onNavigateToCollection!(collectionId!); }} hitSlop={6} style={styles.infoTappableRow}>
                        <Text style={styles.infoText}>{collectionName}</Text>
                        <Feather name="chevron-right" size={12} color={Colors.zinc700} />
                      </Pressable>
                    ) : canTapSpace ? (
                      <Pressable onPress={() => { requestClose(); onNavigateToSpace!(spaceId!); }} hitSlop={6} style={styles.infoTappableRow}>
                        <Text style={styles.infoText}>{collectionName}</Text>
                        <Feather name="chevron-right" size={12} color={Colors.zinc700} />
                      </Pressable>
                    ) : (
                      <Text style={styles.infoText}>{collectionName}</Text>
                    )}
                  </>
                ) : null}
              </View>
            </ScrollView>
            {showGradient ? (
              <LinearGradient
                colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.92)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.infoBarGradient}
                pointerEvents="none"
              />
            ) : null}
          </View>
        ) : null}

        {displayArticles.length > 1 ? (
          <View style={styles.dotsRow}>
            {displayArticles.map((_, i) => (
              <View key={i} style={[styles.dot, i === activeIndex ? styles.dotActive : styles.dotInactive]} />
            ))}
          </View>
        ) : null}
      </RAnimated.View>
      </GestureDetector>
      </RAnimated.View>

      {/* CTA button — "개봉하기" when sealed, "읽기" when revealed. Same
          progress/detailsFade nested-opacity composition as the details bar
          above. */}
      <RAnimated.View
        style={[styles.ctaWrapper, { bottom: bottomInset + 16, left: infoBoxLeft, right: infoBoxLeft }, progressDetailsAnimatedStyle]}
        pointerEvents={rendered ? "auto" : "none"}
      >
      <RAnimated.View style={ctaFadeAnimatedStyle}>
        {isEnvelopeSealed ? (
          <Animated.View style={{ opacity: ctaButtonOpacity }}>
            <ScalePressable
              style={styles.ctaButton}
              contentStyle={[styles.ctaButtonContent, styles.ctaButtonEnvelope]}
              onPress={handleEnvelopeOpen}
              disabled={envelopeOpening}
            >
              <Text style={styles.ctaLabel} numberOfLines={1}>개봉하기</Text>
            </ScalePressable>
          </Animated.View>
        ) : visibilityButton ? (
          <View style={styles.ctaRow}>
            <ScalePressable
              style={styles.ctaVisibilityBtn}
              contentStyle={[
                styles.ctaVisibilityContent,
                visibilityButton.disabled && styles.ctaVisibilityDisabled,
              ]}
              disabled={visibilityButton.disabled}
              accessibilityRole="button"
              accessibilityLabel={visibilityButton.label}
              onPress={visibilityButton.disabled ? undefined : visibilityButton.onPress}
            >
              <Feather name={visibilityButton.icon} size={22} color={Colors.zinc700} />
            </ScalePressable>
            <ScalePressable
              style={styles.ctaButtonFlex}
              contentStyle={[
                styles.ctaButtonContent,
                readAction.mode === "re_read" && styles.ctaButtonRereadContent,
              ]}
              accessibilityRole="button"
              accessibilityLabel={readAction.label}
              onPress={handleRead}
            >
              <Text
                style={[
                  styles.ctaLabel,
                  readAction.mode === "re_read" && styles.ctaLabelReread,
                ]}
                numberOfLines={1}
              >
                {readAction.label}
              </Text>
            </ScalePressable>
          </View>
        ) : (
          <ScalePressable
            style={styles.ctaButton}
            contentStyle={[
              styles.ctaButtonContent,
              readAction.mode === "re_read" && styles.ctaButtonRereadContent,
            ]}
            accessibilityRole="button"
            accessibilityLabel={readAction.label}
            onPress={handleRead}
          >
            <Text
              style={[
                styles.ctaLabel,
                readAction.mode === "re_read" && styles.ctaLabelReread,
              ]}
              numberOfLines={1}
            >
              {readAction.label}
            </Text>
          </ScalePressable>
        )}
      </RAnimated.View>
      </RAnimated.View>

      {/* Inline modal: confirm / info dialogs passed by the caller.
          Rendered inside the native Modal window so they always appear above
          the overlay backdrop. Must be a View-based overlay — not a nested
          RN Modal — to guarantee correct z-order. */}
      {inlineModal}

      {/* Full-screen fade-to-black overlay inside the Modal so it renders above all Modal content */}
      <RAnimated.View
        style={[StyleSheet.absoluteFill, styles.readFadeOverlay, fadeOverlayStyle]}
        pointerEvents="none"
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.62)" },
  cardContainer: {
    position: "absolute",
    width: CARD_W,
    height: CARD_H,
    overflow: "visible",
  },
  // Inner node that carries the Reanimated hero translate/scale; the outer
  // `cardContainer` keeps the legacy swipeY dismiss offset (see
  // cardHeroAnimatedStyle for why splitting the transform this way is
  // pixel-identical to the old single combined transform array).
  cardContainerInner: {
    width: CARD_W,
    height: CARD_H,
  },
  readFadeOverlay: { backgroundColor: "black" },
  carouselTrack: { flexDirection: "row", height: CARD_H },
  carouselSlot: { width: CARD_W, height: CARD_H },
  skeletonCard: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 16,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  detailsContainer: { position: "absolute" },
  infoBar: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 10,
    overflow: "hidden",
  },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  infoBarGradient: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 48,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },
  infoText: { ...Typography.caption, fontSize: 13, fontWeight: "600", color: Colors.zinc700 },
  infoSep: { ...Typography.caption, fontSize: 13, fontWeight: "600", color: Colors.zinc500, marginHorizontal: 4 },
  infoTappableRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotActive: { backgroundColor: Colors.zinc700 },
  dotInactive: { backgroundColor: Colors.zinc300 },
  ctaWrapper: { position: "absolute" },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ctaButton: { width: "100%", height: 56, flexGrow: 0, flexShrink: 0 },
  ctaButtonFlex: { flex: 1, height: 56, flexGrow: 1, flexShrink: 1 },
  ctaButtonEnvelope: { backgroundColor: "#3a342d" },
  ctaButtonDisabled: { opacity: 0.6 },
  ctaButtonContent: { width: "100%", flexDirection: "row", justifyContent: "center", alignItems: "center", height: 56, flexGrow: 0, flexShrink: 0, borderRadius: 18, backgroundColor: Colors.noticeAccent },
  ctaButtonRereadContent: { backgroundColor: Colors.noticeAccentSoft, borderWidth: 1.5, borderColor: Colors.primaryAction },
  ctaVisibilityBtn: { width: 56, height: 56, flexGrow: 0, flexShrink: 0 },
  ctaVisibilityContent: { width: "100%", height: 56, flexGrow: 0, flexShrink: 0, borderRadius: 18, backgroundColor: Colors.zinc100, alignItems: "center", justifyContent: "center" },
  ctaVisibilityDisabled: { opacity: 0.45 },
  ctaLabel: { ...Typography.bodySemiBold, fontSize: 17, letterSpacing: 0.5, color: Colors.white, textAlign: "center" },
  ctaLabelReread: { color: Colors.primaryAction },
});
