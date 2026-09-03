import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  Easing,
  PanResponder,
  Dimensions,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import RAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing as REasing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Sizing } from "@/constants/tokens";
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
const TRANSITION_EASING = Easing.out(Easing.poly(4));
const DISMISS_FADE_DURATION = 100;
const DISMISS_RESISTANCE_DISTANCE = 180;

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
  date?: string | Date | null;
  /** Mirrors the dimmed state of the card that opened the overlay. */
  isRead?: boolean;
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
  /** Prevents the info bar from navigating back to the screen's current entity. */
  currentCollectionId?: string | null;
  currentAuthorId?: string | null;
  /**
   * The inbox carousel uses the restrained carousel shadow at the source.
   * Cross-fade from that source token to the selection token on the same hero
   * progress, so the return handoff cannot pop a different shadow into view.
   */
  originUsesCarouselShadow?: boolean;
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
  currentCollectionId,
  currentAuthorId,
  originUsesCarouselShadow = false,
  envelopeInfo,
  visibilityButton,
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
  const progress = useRef(new Animated.Value(0)).current;
  const swipeY = useRef(new Animated.Value(0)).current;
  const carouselX = useRef(new Animated.Value(0)).current;
  const detailsFade = useRef(new Animated.Value(1)).current;
  const verticalDismissActiveRef = useRef(false);

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
  const closingRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const countRef = useRef(count);
  const gestureDirRef = useRef<null | "h" | "v">(null);
  const pendingGestureDirRef = useRef<null | "h" | "v">(null);
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

  // ── Derived animated styles ───────────────────────────────────────────────
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [originScale, finalScale],
  });
  const cardTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [startTx, 0],
  });
  const cardTranslateY = Animated.add(
    progress.interpolate({ inputRange: [0, 1], outputRange: [startTy, 0] }),
    swipeY,
  );
  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const progressDetailsOpacity = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 0.55, 1],
        outputRange: [0, 0, 1],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const finalDetailsOpacity = useMemo(
    () => Animated.multiply(progressDetailsOpacity, detailsFade),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
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
      Animated.timing(progress, {
        toValue: 1,
        duration: getOpenDuration(
          Math.hypot(startTx, startTy) +
            Math.abs(finalScale - originScale) * CARD_W,
        ),
        easing: TRANSITION_EASING,
        useNativeDriver: false,
      }).start();
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
      carouselX.setValue(-initialIndex * SLOT_W);
      detailsFade.setValue(1);
      setActiveIndex(initialIndex);
      setRendered(true);
      closingRef.current = false;
      swipeY.setValue(0);
      progress.setValue(0);
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
      carouselX.setValue(-newActive * SLOT_W);
      setActiveIndex(newActive);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIndex]);

  // ── Close animation ───────────────────────────────────────────────────────
  const runCloseRef = useRef(() => {});
  runCloseRef.current = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    openedRef.current = false;
    const initIdx = prevInitialIndexRef.current;
    const finishClose = () => {
      setRendered(false);
      closingRef.current = false;
      onClose();
    };

    // Snapshot all transform values before calculating one shared duration.
    // This keeps the return path straight while allowing a farther source slot
    // to take longer than one that is already nearby.
    progress.stopAnimation((currentProgress) => {
      swipeY.stopAnimation((currentSwipeY) => {
        carouselX.stopAnimation((currentCarouselX) => {
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
          const closeTiming = (value: Animated.Value, toValue: number) =>
            Animated.timing(value, {
              toValue,
              duration: closeDuration,
              easing: TRANSITION_EASING,
              useNativeDriver: false,
            });

          // Always include the track, even when the active index already equals
          // the initial index: it can sit between snap points after a drag.
          Animated.parallel([
            closeTiming(carouselX, -initIdx * SLOT_W),
            closeTiming(progress, 0),
            closeTiming(swipeY, 0),
          ]).start(() => {
            activeIndexRef.current = initIdx;
            finishClose();
          });
        });
      });
    });
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

  // ── Pan responder (horizontal carousel + vertical dismiss) ────────────────
  const beginVerticalDismiss = useCallback(() => {
    if (verticalDismissActiveRef.current) return;
    verticalDismissActiveRef.current = true;
    Animated.timing(detailsFade, {
      toValue: 0,
      duration: DISMISS_FADE_DURATION,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [detailsFade]);

  const restoreDetailsAfterDismiss = useCallback(() => {
    verticalDismissActiveRef.current = false;
    Animated.timing(detailsFade, {
      toValue: 1,
      duration: 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [detailsFade]);

  const applyDismissResistance = (distance: number) => {
    const positiveDistance = Math.max(0, distance);
    return (
      (positiveDistance * DISMISS_RESISTANCE_DISTANCE) /
      (DISMISS_RESISTANCE_DISTANCE + positiveDistance)
    );
  };

  const cardPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => {
        if (countRef.current > 1 && Math.abs(g.dx) > 6 && Math.abs(g.dx) >= Math.abs(g.dy)) {
          pendingGestureDirRef.current = "h";
          return true;
        }
        if (g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx)) {
          pendingGestureDirRef.current = "v";
          return true;
        }
        pendingGestureDirRef.current = null;
        return false;
      },
      onPanResponderGrant: () => {
        gestureDirRef.current = pendingGestureDirRef.current;
        pendingGestureDirRef.current = null;
        if (gestureDirRef.current === "v") {
          beginVerticalDismiss();
        } else {
          verticalDismissActiveRef.current = false;
          if (gestureDirRef.current === "h") {
            Animated.timing(detailsFade, { toValue: 0, duration: 120, useNativeDriver: false }).start();
          }
        }
      },
      onPanResponderMove: (_, g) => {
        if (!gestureDirRef.current) {
          if (countRef.current > 1 && Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 4) {
            gestureDirRef.current = "h";
            Animated.timing(detailsFade, { toValue: 0, duration: 120, useNativeDriver: false }).start();
          } else if (Math.abs(g.dy) > 4) {
            gestureDirRef.current = "v";
            beginVerticalDismiss();
          }
        }
        if (gestureDirRef.current === "h") {
          const baseX = -activeIndexRef.current * SLOT_W;
          const raw = baseX + g.dx;
          const maxX = 0;
          const minX = -(countRef.current - 1) * SLOT_W;
          const rubber = raw > maxX ? maxX + (raw - maxX) * 0.3 : raw < minX ? minX + (raw - minX) * 0.3 : raw;
          carouselX.setValue(rubber);
        } else if (gestureDirRef.current === "v") {
          if (g.dy > 0) swipeY.setValue(applyDismissResistance(g.dy));
        }
      },
      onPanResponderRelease: (_, g) => {
        if (gestureDirRef.current === "h") {
          const { dx, vx } = g;
          const cur = activeIndexRef.current;
          const n = countRef.current;
          let newIdx = cur;
          if (Math.abs(vx) > CAROUSEL_FLING_VX) newIdx = vx < 0 ? cur + 1 : cur - 1;
          else if (Math.abs(dx) >= CAROUSEL_SNAP_THRESHOLD) newIdx = dx < 0 ? cur + 1 : cur - 1;
          newIdx = Math.max(0, Math.min(n - 1, newIdx));
          const changed = newIdx !== activeIndexRef.current;
          activeIndexRef.current = newIdx;
          if (changed) setActiveIndex(newIdx);
          Animated.spring(carouselX, { toValue: -newIdx * SLOT_W, useNativeDriver: false, tension: 100, friction: 20, overshootClamping: true }).start();
          setTimeout(() => {
            Animated.timing(detailsFade, { toValue: 1, duration: 120, useNativeDriver: false }).start();
          }, 80);
        } else if (gestureDirRef.current === "v") {
          if (g.dy > 80 || g.vy > 0.8) runCloseRef.current();
          else {
            Animated.spring(swipeY, {
              toValue: 0,
              useNativeDriver: false,
              tension: 200,
              friction: 20,
            }).start();
            restoreDetailsAfterDismiss();
          }
        } else {
          Animated.spring(swipeY, { toValue: 0, useNativeDriver: false, tension: 200, friction: 20 }).start();
        }
        gestureDirRef.current = null;
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeY, { toValue: 0, useNativeDriver: false, tension: 200, friction: 20 }).start();
        restoreDetailsAfterDismiss();
        Animated.spring(carouselX, { toValue: -activeIndexRef.current * SLOT_W, useNativeDriver: false, tension: 100, friction: 20 }).start();
        gestureDirRef.current = null;
      },
    }),
  ).current;

  // ── Vertical-only pan for details area ───────────────────────────────────
  const detailsPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        verticalDismissActiveRef.current = false;
      },
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) {
          beginVerticalDismiss();
          swipeY.setValue(applyDismissResistance(g.dy));
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.8) runCloseRef.current();
        else {
          Animated.spring(swipeY, {
            toValue: 0,
            useNativeDriver: false,
            tension: 200,
            friction: 20,
          }).start();
          restoreDetailsAfterDismiss();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeY, { toValue: 0, useNativeDriver: false, tension: 200, friction: 20 }).start();
        restoreDetailsAfterDismiss();
      },
    }),
  ).current;

  // ── Active card info ──────────────────────────────────────────────────────
  const activeMeta = displayMetas[activeIndex] ?? {};
  const { authorName, authorId, collectionName, collectionId, date } = activeMeta;
  const dateLabel = date ? formatDate(date) : "";
  const canTapCollection = !!(
    collectionId &&
    collectionId !== currentCollectionId &&
    onNavigateToCollection
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
      onRequestClose={requestClose}
      onShow={handleModalShow}
    >
      {/* Dark backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.cardContainer,
          {
            left: cardBoxLeft,
            top: boxTop,
            transform: [{ translateX: cardTranslateX }, { translateY: cardTranslateY }, { scale }],
          },
        ]}
        onLayout={handleOriginCardLayout}
        {...cardPanResponder.panHandlers}
      >
        {displayArticles.length > 1 ? (
          <Animated.View style={[styles.carouselTrack, { width: trackW, transform: [{ translateX: carouselX }] }]}>
            {displayArticles.map((art, i) => {
              const meta = displayMetas[i] ?? {};
              const slotOpacity = i === initialIndex ? 1 : progressDetailsOpacity;
              const imageUrl = getCoverImageUrl(art);
              const visualGate = visualGateRef.current;
              const isCurrentVisualSlot =
                i === visualGate.slotIndex &&
                imageUrl !== null &&
                visualGate.imageUrl === imageUrl;
              return (
                <Animated.View
                  key={art?.id ?? `loading-${i}`}
                  style={[styles.carouselSlot, i < displayArticles.length - 1 && { marginRight: OVERLAY_GAP }, { opacity: slotOpacity }]}
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
                </Animated.View>
              );
            })}
          </Animated.View>
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
      </Animated.View>

      {/* Details (info bar) — hidden while envelope is sealed */}
      <Animated.View
        style={[styles.detailsContainer, { top: detailsTop, left: infoBoxLeft, right: infoBoxLeft, opacity: isEnvelopeSealed ? 0 : finalDetailsOpacity }]}
        pointerEvents={rendered && !isEnvelopeSealed ? "auto" : "none"}
        {...detailsPanResponder.panHandlers}
      >
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
      </Animated.View>

      {/* CTA button — "개봉하기" when sealed, "읽기" when revealed */}
      <Animated.View
        style={[styles.ctaWrapper, { bottom: bottomInset + 16, left: infoBoxLeft, right: infoBoxLeft, opacity: finalDetailsOpacity }]}
        pointerEvents={rendered ? "auto" : "none"}
      >
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
            <ScalePressable style={styles.ctaButtonFlex} contentStyle={styles.ctaButtonContent} onPress={handleRead}>
              <Text style={styles.ctaLabel} numberOfLines={1}>읽기</Text>
            </ScalePressable>
          </View>
        ) : (
          <ScalePressable style={styles.ctaButton} contentStyle={styles.ctaButtonContent} onPress={handleRead}>
            <Text style={styles.ctaLabel} numberOfLines={1}>읽기</Text>
          </ScalePressable>
        )}
      </Animated.View>

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
  ctaButton: { width: "100%", height: 56 },
  ctaButtonFlex: { flex: 1, height: 56 },
  ctaButtonEnvelope: { backgroundColor: "#3a342d" },
  ctaButtonDisabled: { opacity: 0.6 },
  ctaButtonContent: { flexDirection: "row", justifyContent: "center", alignItems: "center", flex: 1, height: 56, borderRadius: 18, backgroundColor: Colors.noticeAccent },
  ctaVisibilityBtn: { width: 56, height: 56 },
  ctaVisibilityContent: { flex: 1, height: 56, borderRadius: 18, backgroundColor: Colors.zinc100, alignItems: "center", justifyContent: "center" },
  ctaVisibilityDisabled: { opacity: 0.45 },
  ctaLabel: { ...Typography.bodySemiBold, fontSize: 17, letterSpacing: 0.5, color: Colors.white, textAlign: "center" },
});
