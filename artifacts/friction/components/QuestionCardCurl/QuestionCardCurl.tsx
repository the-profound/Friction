/*
 * QuestionCardCurl — 질문 카드 curl/tear 애니메이션 컴포넌트
 *
 * curl (내용 있는 카드): SVG ClipPath + Polygon으로 사선 분할선 구현.
 *   - flat-remaining: 나가는 카드를 상단 사다리꼴로 클리핑
 *   - flap: 분할선 아래 반사(흰 종이 뒷면 + 그라데이션 음영)
 *   - crease shadow: skewY 대각선 그림자 띠
 *
 * tear (빈 카드 위 스와이프): SVG 톱니 ClipPath + Reanimated withTiming.
 *
 * 목업(QuestionCardSwipePreview.tsx)과 동일한 geometry 사용.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import MaskedView from "@react-native-masked-view/masked-view";
import Svg, {
  Defs,
  ClipPath,
  Polygon,
  G,
  Rect,
  LinearGradient as SvgLinearGradient,
  Stop,
} from "react-native-svg";
import ActionSheetModal from "@/components/ActionSheetModal/ActionSheetModal";
import { Colors, ReaderTokens } from "@/constants/tokens";

/* ─── 질문 데이터 ────────────────────────────────────────────────────── */
const QUESTIONS = [
  "작성자가 하고자 하는 말은 무엇이었나요?",
  "이 글을 읽고 떠오르는 다른 글이나 경험이 있다면 무엇인가요?",
  "이 글을 읽기 전과 읽은 후, 당신의 생각이 가장 크게 바뀐 지점은 어디인가요?",
];

/* ─── Curl 상수 (목업과 동일) ────────────────────────────────────────── */
const CURL_DURATION = 950;
const RIGHT_EXP = 0.5; // 우측이 먼저 말려 올라감
const LEFT_EXP = 0.7;  // 좌측이 늦게 말려 올라감

/* ─── Tear 상수 (목업과 동일) ────────────────────────────────────────── */
const TEAR_DURATION = 1700;    // ms (목업 TEAR_DURATION과 동일)
const TEAR_FADE_DONE = 0.4;    // 이 rawProgress에서 opacity=0 → 카드 교체

/* ─── Easing 함수 ────────────────────────────────────────────────────── */
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function taper(t: number) { return Math.min(1, t * 5, (1 - t) * 5); }

/* ─── SpringCoil (목업과 동일: 9개 다크 메탈릭 링) ──────────────────── */
const SPRING_H = 42; // 목업 SPRING_H 와 동일

function SpringCoil({ width: _width }: { width: number }) {
  const RING_W = 8;
  const RING_H = 24;
  return (
    <View style={sc.bar} pointerEvents="none">
      {Array.from({ length: 9 }).map((_, i) => (
        <View
          key={i}
          style={{
            width: RING_W,
            height: RING_H,
            borderRadius: 4,
            backgroundColor: "#888",
            ...Platform.select({
              web: { background: "linear-gradient(90deg, #555 0%, #ccc 50%, #444 100%)" } as object,
              default: {},
            }),
            ...Platform.select({
              default: {
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.4,
                shadowRadius: 6,
                elevation: 3,
              },
            }),
          }}
        />
      ))}
    </View>
  );
}
const sc = StyleSheet.create({
  bar: {
    position: "absolute" as const,
    top: 10,
    left: 20,
    right: 20,
    height: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 10,
  },
});

/* ─── CardFaceContent: curl/tear 중 ghost 표시용 ─────────────────────── */
function CardFaceContent({
  question,
  answer,
  width,
  height,
}: {
  question: string;
  answer: string;
  width: number;
  height: number;
}) {
  return (
    <View style={{ width, height, backgroundColor: Colors.white }}>
      {/* SPRING_H 스페이서: 스프링 링은 카드 컨테이너 바깥에 absolute로 렌더됨 */}
      <View style={{ height: SPRING_H, flexShrink: 0 }} />
      <View style={cfc.inner}>
        <Text style={cfc.question} numberOfLines={6}>
          {question}
        </Text>
        <Text style={cfc.answer} numberOfLines={12}>
          {answer || "생각을 자유롭게 적어보세요..."}
        </Text>
      </View>
    </View>
  );
}
const cfc = StyleSheet.create({
  inner: { flex: 1, paddingHorizontal: 28, paddingTop: 20, paddingBottom: 24 },
  question: {
    fontSize: 18,
    fontFamily: ReaderTokens.fontFamily.serif,
    fontWeight: "400",
    color: Colors.zinc900,
    lineHeight: 28,
    letterSpacing: 0.3,
    marginBottom: 20,
  },
  answer: {
    fontSize: 15,
    fontFamily: ReaderTokens.fontFamily.serif,
    color: Colors.zinc400,
    lineHeight: 28,
    letterSpacing: 0.5,
  },
});

/* ─── Props ──────────────────────────────────────────────────────────── */
export interface QuestionCardCurlProps {
  /** 카드가 오른쪽으로 빠져나가는 애니메이션을 "시작"하는 시점에 호출됨 —
   *  마지막 페이지가 같은 타이밍으로 왼쪽에서 슬라이드-인할 수 있도록
   *  read.tsx가 즉시 페이지 상태를 되돌릴 수 있게 한다. */
  onDismissOverlay: () => void;
  /** 카드가 오른쪽으로 완전히 빠져나간 뒤(애니메이션 종료) 호출됨 —
   *  이 시점에 카드를 언마운트해도 이미 화면 밖이라 끊김이 보이지 않는다. */
  onDismissOverlayComplete?: () => void;
  onReadingComplete: (hasSubstantialAnswer: boolean) => void;
  /** 읽기 페이지 프레임 크기 (read.tsx의 layout.containerWidth/Height와 동일).
   *  카드를 이 프레임 안에 거의 꽉 차게 배치해 페이지와 크기를 맞춘다. */
  containerWidth: number;
  containerHeight: number;
}

/* 카드가 프레임을 완전히 채우는 비율 — 마지막 페이지/읽기 완료 화면과 정확히
 * 같은 크기여야 전환 시 배경(readerFrame)의 흰 사각형 테두리가 드러나지 않는다. */
const CARD_FILL_RATIO = 1;
/* 노트 진입 슬라이드 애니메이션 지속 시간/이징 — 페이지 넘김과 동일한 체감 속도 */
const ENTRANCE_DURATION = 380;
const ENTRANCE_EASING = Easing.bezier(0.25, 0.46, 0.45, 0.94);

/* ════════════════════════════════════════════════════════════════════════
 * QuestionCardCurl (메인 컴포넌트)
 * ════════════════════════════════════════════════════════════════════════ */
export default function QuestionCardCurl({
  onDismissOverlay,
  onDismissOverlayComplete,
  onReadingComplete,
  containerWidth: screenWidth,
  containerHeight: screenHeight,
}: QuestionCardCurlProps) {
  /* ── 카드 레이아웃 (페이지 프레임과 거의 동일한 크기) ───────────────── */
  const cardSmallW = Math.round(screenWidth * CARD_FILL_RATIO);
  const cardSmallH = Math.round(screenHeight * CARD_FILL_RATIO);
  const cardSmallLeft = Math.round((screenWidth - cardSmallW) / 2);

  /* ── 진입 슬라이드: 화면 오른쪽 밖에서 시작해 0으로 들어오며
   *    동시에 이전 페이지를 밀어내는 듯한 느낌을 준다 (마운트 1회). ── */
  const entranceTX = useSharedValue(screenWidth);
  useEffect(() => {
    entranceTX.value = withTiming(0, {
      duration: ENTRANCE_DURATION,
      easing: ENTRANCE_EASING,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const entranceStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: entranceTX.value }],
  }));

  /* ── 카드 상태 ──────────────────────────────────────────────────────── */
  const [ptr, setPtr] = useState(0);
  const [saved, setSaved] = useState<{ qIdx: number; answer: string }[]>([]);
  const [seq, setSeq] = useState(0);
  const [newAnswer, setNewAnswer] = useState("");

  /* ── 애니메이션 상태 ─────────────────────────────────────────────────── */
  const [animating, setAnimating] = useState(false);
  const [animType, setAnimType] = useState<"curl" | "tear">("curl");
  const [animDir, setAnimDir] = useState<"forward" | "back">("forward");
  const [outSnap, setOutSnap] = useState<{ q: string; ans: string } | null>(null);
  const [incoming, setIncoming] = useState<{ q: string; ans: string } | null>(null);
  const [rawProgress, setRawProgress] = useState(0);

  /* ── Action sheet ─────────────────────────────────────────────────── */
  const [actionSheetVisible, setActionSheetVisible] = useState(false);

  /* ── Refs (stale closure 방지) ───────────────────────────────────────── */
  const animatingRef = useRef(false);
  const ptrRef = useRef(0);
  const savedRef = useRef<{ qIdx: number; answer: string }[]>([]);
  const seqRef = useRef(0);
  const newAnswerRef = useRef("");
  const curlRafRef = useRef<number | null>(null);

  /* ── Shared values (Reanimated) ─────────────────────────────────────── */
  // 드래그 팔로우 피드백 (좌우 스와이프 + 대기 카드 위/아래 드래그)
  const cardTX = useSharedValue(0);
  const cardTY = useSharedValue(0);

  const cardDragStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: cardTX.value },
      { translateY: cardTY.value },
    ],
  }));

  /* ── afterTransition ─────────────────────────────────────────────────── */
  const afterTransition = useCallback(() => {
    if (curlRafRef.current !== null) {
      cancelAnimationFrame(curlRafRef.current);
      curlRafRef.current = null;
    }
    animatingRef.current = false;
    setAnimating(false);
    setOutSnap(null);
    setIncoming(null);
    setRawProgress(0);
    cardTY.value = 0;
    cardTX.value = 0;
  }, [cardTY, cardTX]);

  const afterTransitionRef = useRef(afterTransition);
  afterTransitionRef.current = afterTransition;

  /* ── Curl RAF 루프 (목업과 동일: easeInOutCubic으로 rawProgress 0→1) ─── */
  const runCurlRAF = useCallback((onComplete: () => void) => {
    if (curlRafRef.current !== null) cancelAnimationFrame(curlRafRef.current);
    setRawProgress(0);
    const startTime = performance.now();
    const step = (now: number) => {
      const raw = Math.min(1, (now - startTime) / CURL_DURATION);
      setRawProgress(easeInOutCubic(raw));
      if (raw < 1) {
        curlRafRef.current = requestAnimationFrame(step);
      } else {
        onComplete();
      }
    };
    curlRafRef.current = requestAnimationFrame(step);
  }, []);

  /* ── triggerAdvance ──────────────────────────────────────────────────── */
  const triggerAdvance = useCallback(
    (hasAnswer: boolean) => {
      if (animatingRef.current) return;

      const _ptr = ptrRef.current;
      const _saved = savedRef.current;
      const _seq = seqRef.current;
      const _ans = newAnswerRef.current;
      const _isNew = _ptr === _saved.length;

      const outQ = _isNew
        ? QUESTIONS[_seq % QUESTIONS.length]
        : QUESTIONS[_saved[_ptr]?.qIdx ?? 0];
      const outAns = _isNew ? _ans : (_saved[_ptr]?.answer ?? "");

      let nextSaved = _saved;
      let nextPtr: number;
      let nextSeq = _seq;

      if (_isNew) {
        nextSeq = _seq + 1;
        if (hasAnswer) {
          const entry = { qIdx: _seq % QUESTIONS.length, answer: _ans };
          nextSaved = [..._saved, entry];
          nextPtr = nextSaved.length;
        } else {
          nextPtr = _saved.length;
        }
      } else {
        nextPtr = _ptr + 1;
      }

      const nextIsNew = nextPtr === nextSaved.length;
      const nextQ = nextIsNew
        ? QUESTIONS[nextSeq % QUESTIONS.length]
        : QUESTIONS[nextSaved[nextPtr]?.qIdx ?? 0];
      const nextAns = nextIsNew ? "" : (nextSaved[nextPtr]?.answer ?? "");

      animatingRef.current = true;
      setAnimating(true);
      setOutSnap({ q: outQ, ans: outAns });
      setIncoming({ q: nextQ, ans: nextAns });

      if (hasAnswer) {
        /* ── curl forward ─────────────────────────────────────────── */
        setAnimType("curl");
        setAnimDir("forward");
        runCurlRAF(() => {
          ptrRef.current = nextPtr;
          savedRef.current = nextSaved;
          seqRef.current = nextSeq;
          newAnswerRef.current = _isNew ? "" : _ans;
          setPtr(nextPtr);
          setSaved(nextSaved);
          setSeq(nextSeq);
          if (_isNew) setNewAnswer("");
          afterTransitionRef.current();
        });
      } else {
        /* ── tear: RAF로 rawProgress 0→TEAR_FADE_DONE 구동 (목업과 동일) ── */
        setAnimType("tear");
        if (curlRafRef.current !== null) cancelAnimationFrame(curlRafRef.current);
        setRawProgress(0);
        const startTime = performance.now();
        const step = (now: number) => {
          const raw = (now - startTime) / TEAR_DURATION;
          setRawProgress(Math.min(raw, 1));
          if (raw < TEAR_FADE_DONE) {
            curlRafRef.current = requestAnimationFrame(step);
          } else {
            /* opacity=0 도달 → 카드 교체 후 트랜지션 종료 */
            ptrRef.current = nextPtr;
            savedRef.current = nextSaved;
            seqRef.current = nextSeq;
            newAnswerRef.current = "";
            setPtr(nextPtr);
            setSaved(nextSaved);
            setSeq(nextSeq);
            if (_isNew) setNewAnswer("");
            afterTransitionRef.current();
          }
        };
        curlRafRef.current = requestAnimationFrame(step);
      }
    },
    [runCurlRAF],
  );

  const triggerAdvanceRef = useRef(triggerAdvance);
  triggerAdvanceRef.current = triggerAdvance;

  /* ── triggerBack ─────────────────────────────────────────────────────── */
  const triggerBack = useCallback(() => {
    if (animatingRef.current) return;

    const _ptr = ptrRef.current;
    const _saved = savedRef.current;

    if (_ptr <= 0) {
      cardTY.value = withSpring(0, { damping: 12, stiffness: 180 });
      return;
    }

    const isCurrentNew = _ptr === _saved.length;
    const outQ = isCurrentNew
      ? QUESTIONS[seqRef.current % QUESTIONS.length]
      : QUESTIONS[_saved[_ptr]?.qIdx ?? 0];
    const outAns = isCurrentNew
      ? newAnswerRef.current
      : (_saved[_ptr]?.answer ?? "");

    const prevCard = _saved[_ptr - 1];
    const prevQ = QUESTIONS[prevCard.qIdx];

    animatingRef.current = true;
    setAnimating(true);
    setAnimType("curl");
    setAnimDir("back");
    setOutSnap({ q: outQ, ans: outAns });
    setIncoming({ q: prevQ, ans: prevCard.answer });

    runCurlRAF(() => {
      ptrRef.current = _ptr - 1;
      setPtr(_ptr - 1);
      afterTransitionRef.current();
    });
  }, [runCurlRAF, cardTY]);

  const triggerBackRef = useRef(triggerBack);
  triggerBackRef.current = triggerBack;

  /* ── Pan gesture ─────────────────────────────────────────────────────── */
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(8)
        .onUpdate((e) => {
          if (animatingRef.current) return;
          const dx = e.translationX;
          const dy = e.translationY;
          const isVertical = Math.abs(dy) > Math.abs(dx);
          if (isVertical) {
            /* 목업과 동일한 드래그 팔로우 계수 */
            if (dy < 0) {
              cardTY.value = dy * 0.10;
            } else {
              const restTy = cardSmallH + 60;
              cardTY.value =
                ptrRef.current > 0
                  ? dy * 0.12
                  : Math.min(dy * 0.22, restTy * 0.28);
            }
          } else {
            cardTX.value = dx * 0.14;
          }
        })
        .onEnd((e) => {
          if (animatingRef.current) return;
          const dx = e.translationX;
          const dy = e.translationY;
          const THRESHOLD = 80;
          const isVertical = Math.abs(dy) > Math.abs(dx);

          if (isVertical) {
            if (dy < -THRESHOLD) {
              const _isNew = ptrRef.current === savedRef.current.length;
              const hasAns = _isNew
                ? newAnswerRef.current.trim().length > 0
                : true;
              triggerAdvanceRef.current(hasAns);
            } else if (dy > THRESHOLD) {
              triggerBackRef.current();
            } else {
              cardTY.value = withSpring(0, { damping: 12, stiffness: 180 });
              cardTX.value = withSpring(0, { damping: 12, stiffness: 180 });
            }
          } else {
            const restX = Math.round((screenWidth + cardSmallW) / 2);
            if (dx < -THRESHOLD) {
              // 좌 스와이프 (오른쪽→왼쪽): 페이지 순서상 앞으로 진행 → 읽기 완료 화면.
              // 카드는 다음 페이지가 들어오는 방향(왼쪽)으로 빠져나간다.
              const hasSubstantial =
                savedRef.current.some((c) => c.answer.trim().length >= 10) ||
                newAnswerRef.current.trim().length >= 10;
              animatingRef.current = true;
              setAnimating(true);
              // 애니메이션 "시작"과 동시에 호출 — 읽기 완료 화면이 같은 타이밍으로
              // 오른쪽에서 슬라이드-인해, 카드가 사라진 뒤 뒤늦게 나타나는 대신
              // 하나로 연결된 슬라이드처럼 보이게 한다.
              runOnJS(onReadingComplete)(hasSubstantial);
              cardTX.value = withTiming(
                -restX,
                { duration: 420, easing: Easing.bezier(0.25, 0.46, 0.45, 0.94) },
                () => {
                  cardTX.value = 0;
                  animatingRef.current = false;
                  runOnJS(setAnimating)(false);
                },
              );
            } else if (dx > THRESHOLD) {
              // 우 스와이프 (왼쪽→오른쪽): 페이지 순서상 뒤로 진행 → 원래 글의 마지막
              // 페이지로 돌아가기. 카드는 이전 페이지가 있는 방향(오른쪽)으로 빠져나간다.
              // onDismissOverlay를 "시작" 시점에 호출해 read.tsx가 즉시 마지막
              // 페이지 상태로 되돌리고, 같은 타이밍으로 왼쪽에서 슬라이드-인하게 한다.
              runOnJS(onDismissOverlay)();
              cardTX.value = withTiming(
                restX,
                { duration: 360, easing: Easing.bezier(0.25, 0.46, 0.45, 0.94) },
                () => {
                  cardTX.value = 0;
                  if (onDismissOverlayComplete) runOnJS(onDismissOverlayComplete)();
                },
              );
            } else {
              cardTX.value = withSpring(0, { damping: 12, stiffness: 180 });
            }
          }
        }),
    [cardTX, cardTY, cardSmallH, cardSmallW, screenWidth, onDismissOverlay, onReadingComplete],
  );

  /* ── 현재 카드 표시값 ────────────────────────────────────────────────── */
  const isNewCard = ptr === saved.length;
  const currentQIdx = isNewCard
    ? seq % QUESTIONS.length
    : (saved[ptr]?.qIdx ?? 0);
  const currentQ = QUESTIONS[currentQIdx];
  const currentAnswer = isNewCard ? newAnswer : (saved[ptr]?.answer ?? "");

  /* ── Curl geometry (목업과 동일한 수식) ─────────────────────────────── */
  // forward: rolledAmount = rawProgress (0→1, 말려 올라감)
  // back:    rolledAmount = 1 - rawProgress (1→0, 위에서 펼쳐짐)
  const rolledAmount = !animating
    ? 0
    : animDir === "forward"
    ? rawProgress
    : 1 - rawProgress;

  const rolledRight = clamp01(Math.pow(rolledAmount, RIGHT_EXP));
  const rolledLeft = clamp01(Math.pow(rolledAmount, LEFT_EXP));
  const flatHR = cardSmallH * (1 - rolledRight); // 우측 flat 높이 (더 낮음)
  const flatHL = cardSmallH * (1 - rolledLeft);  // 좌측 flat 높이 (더 높음)
  const rollTopAvg = (flatHR + flatHL) / 2;
  // skewDeg < 0: 우측이 좌측보다 먼저 말려 올라가므로 우측이 위
  const skewDeg = (Math.atan2(flatHR - flatHL, cardSmallW) * 180) / Math.PI;
  const taperVal = taper(rolledAmount);

  /*
   * 레이어 콘텐츠 결정:
   *   forward: base=incoming(다음 카드), anim=outgoing(현재 카드)
   *   back:    base=outgoing(현재 카드), anim=incoming(이전 카드)
   */
  const baseQ =
    animDir === "forward"
      ? (incoming?.q ?? "")
      : (outSnap?.q ?? "");
  const baseAns =
    animDir === "forward"
      ? (incoming?.ans ?? "")
      : (outSnap?.ans ?? "");
  const animQ =
    animDir === "forward"
      ? (outSnap?.q ?? "")
      : (incoming?.q ?? "");
  const animAns =
    animDir === "forward"
      ? (outSnap?.ans ?? "")
      : (incoming?.ans ?? "");

  /* ── Tear geometry (목업과 동일한 수식: RAF rawProgress → easeOutCubic) ── */
  const tearEased = easeOutCubic(Math.min(rawProgress, 1));
  const tearFlyX = tearEased * Math.round(screenWidth * (460 / 390));
  const tearFlyY = tearEased * -Math.round(screenHeight * (760 / 844));
  const tearFlyRot = tearEased * 38;
  const tearFlyScale = 1 - tearEased * 0.22;
  const tearFlyOpacity = Math.max(0, 1 - rawProgress / TEAR_FADE_DONE);

  const isCurling =
    animating && animType === "curl" && outSnap !== null;
  const isTearing =
    animating && animType === "tear" && outSnap !== null;

  /* ── 톱니 클립 polygon points (tear용) ─────────────────────────────── */
  const tornTopPoints = useMemo(() => {
    const W = cardSmallW;
    const H = cardSmallH;
    const teeth = 26;
    const pts: string[] = [`0,${H}`];
    for (let i = 0; i <= teeth; i++) {
      const x = (i / teeth) * W;
      // 목업과 동일: even=4%, odd=0.5% of card height
      const y = i % 2 === 0 ? H * 0.04 : H * 0.005;
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    pts.push(`${W},${H}`);
    return pts.join(" ");
  }, [cardSmallW, cardSmallH]);

  /* ── 카드 공통 스타일 ─────────────────────────────────────────────── */
  const cardBaseStyle = useMemo(
    () => ({
      position: "absolute" as const,
      top: "50%" as unknown as number,
      marginTop: -(cardSmallH / 2),
      left: cardSmallLeft,
      width: cardSmallW,
      height: cardSmallH,
      borderRadius: 20,
      backgroundColor: Colors.white,
      zIndex: 10,
      ...Platform.select({
        web: {
          boxShadow:
            "0 6px 44px rgba(0,0,0,0.18), 0 1px 8px rgba(0,0,0,0.1)",
        } as object,
        default: {
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.18,
          shadowRadius: 22,
          elevation: 10,
        },
      }),
    }),
    [cardSmallH, cardSmallLeft, cardSmallW],
  );

  /* ─────────────────────────────────────────────────────────────────────
   * Render
   * ───────────────────────────────────────────────────────────────────── */
  return (
    <Animated.View style={[s.root, entranceStyle]}>
      <GestureDetector gesture={panGesture}>
        <View style={s.gestureLayer}>

          {/* 노트패드 스택 깊이감 */}
          <View
            style={[
              s.stackLayerBack,
              {
                left: cardSmallLeft - 2,
                top: "50%" as unknown as number,
                marginTop: -(cardSmallH / 2) + 7,
                width: cardSmallW,
                height: cardSmallH,
              },
            ]}
          />
          <View
            style={[
              s.stackLayerFront,
              {
                left: cardSmallLeft - 1,
                top: "50%" as unknown as number,
                marginTop: -(cardSmallH / 2) + 3.5,
                width: cardSmallW,
                height: cardSmallH,
              },
            ]}
          />

          {/* ══════════════════════════════════════════════════════════
           * CURL 애니메이션
           * SVG ClipPath + Polygon으로 사선 분할 구현
           * ══════════════════════════════════════════════════════════ */}
          {isCurling ? (
            <View style={[cardBaseStyle, { overflow: "hidden" }]}>
              {/*
               * 1. Base: 들어오는 카드 (전체, 가장 아래).
               * react-native-svg의 ForeignObject는 네이티브(안드로이드/iOS)에서
               * 텍스트가 사라지거나 리렌더 시 렉이 발생하는 문제가 있어
               * 일반 View로 렌더링 (SVG 밖).
               */}
              <View style={StyleSheet.absoluteFillObject}>
                <CardFaceContent
                  question={baseQ}
                  answer={baseAns}
                  width={cardSmallW}
                  height={cardSmallH}
                />
              </View>

              {/*
               * 2. Flat-remaining: 나가는 카드, 사다리꼴 모양으로 마스킹.
               * ForeignObject 대신 MaskedView + SVG Polygon 마스크 사용
               * (실제 텍스트는 일반 RN Text로 렌더 → 네이티브에서 안정적).
               */}
              <MaskedView
                style={StyleSheet.absoluteFillObject}
                maskElement={
                  <Svg width={cardSmallW} height={cardSmallH}>
                    <Polygon
                      points={`0,0 ${cardSmallW},0 ${cardSmallW},${flatHR.toFixed(2)} 0,${flatHL.toFixed(2)}`}
                      fill="#000"
                    />
                  </Svg>
                }
              >
                <CardFaceContent
                  question={animQ}
                  answer={animAns}
                  width={cardSmallW}
                  height={cardSmallH}
                />
              </MaskedView>

              {/* 3+4. Flap 반사 + Crease 그림자 (텍스트 없음 → 순수 SVG로 유지) */}
              <Svg
                width={cardSmallW}
                height={cardSmallH}
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              >
                <Defs>
                  {/*
                   * flap body clip: 분할선 아래 반사 영역.
                   * 이 클립은 parent coordinate(카드 공간)에서 평가됨.
                   * G의 reflection transform 적용 후 대각선 아래 → 위로 반사됨.
                   */}
                  <ClipPath id="qcFlapBodyClip">
                    <Polygon
                      points={`0,${flatHL.toFixed(2)} ${cardSmallW},${flatHR.toFixed(2)} ${cardSmallW},${cardSmallH} 0,${cardSmallH}`}
                    />
                  </ClipPath>

                  {/* 종이 뒷면 그라데이션 음영 */}
                  <SvgLinearGradient
                    id="qcFlapGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <Stop offset="0" stopColor="#ffffff" stopOpacity={0.35} />
                    <Stop offset="0.08" stopColor="#000000" stopOpacity={0.15} />
                    <Stop offset="0.55" stopColor="#000000" stopOpacity={0.32} />
                    <Stop offset="1" stopColor="#000000" stopOpacity={0.5} />
                  </SvgLinearGradient>

                  {/* 분할선 그림자 그라데이션 */}
                  <SvgLinearGradient
                    id="qcCreaseGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <Stop
                      offset="0"
                      stopColor="#000000"
                      stopOpacity={0.5 * taperVal}
                    />
                    <Stop offset="1" stopColor="#000000" stopOpacity={0} />
                  </SvgLinearGradient>
                </Defs>

                {/*
                 * 3. Flap: 분할선 대각선을 축으로 종이 뒷면 반사.
                 *
                 * SVG transform (좌→우 적용, 점 변환은 우→좌):
                 *   translate(cx,cy) rotate(skewDeg) scale(1,-1) rotate(-skewDeg) translate(-cx,-cy)
                 * = CSS { transformOrigin: cx cy; transform: rotate(skewDeg) scaleY(-1) rotate(-skewDeg) }
                 *
                 * clipPath(qcFlapBodyClip)은 parent coordinate에서 평가 →
                 * 분할선 아래 영역(카드 공간)만 통과 → 반사 후 분할선 위에 표시.
                 *
                 * 흰 바탕 + 그라데이션으로 종이 뒷면 표현 (실제 텍스트 콘텐츠 불필요).
                 */}
                <G
                  clipPath="url(#qcFlapBodyClip)"
                  transform={[
                    `translate(${(cardSmallW / 2).toFixed(2)},${rollTopAvg.toFixed(2)})`,
                    `rotate(${skewDeg.toFixed(4)})`,
                    `scale(1,-1)`,
                    `rotate(${(-skewDeg).toFixed(4)})`,
                    `translate(${(-(cardSmallW / 2)).toFixed(2)},${(-rollTopAvg).toFixed(2)})`,
                  ].join(" ")}
                >
                  <Rect
                    x={0}
                    y={0}
                    width={cardSmallW}
                    height={cardSmallH}
                    fill="white"
                  />
                  <Rect
                    x={0}
                    y={0}
                    width={cardSmallW}
                    height={cardSmallH}
                    fill="url(#qcFlapGrad)"
                  />
                </G>

                {/*
                 * 4. Crease shadow: 분할선을 따라가는 대각선 그림자 띠.
                 *
                 * skewY(skewDeg)는 SVG에서 y' = y + x*tan(angle).
                 * x=0에서 y 고정, x=W에서 y += W*tan(skewDeg) (skewDeg<0 → 우측이 위로).
                 * → 좌측 하단에서 우측 상단으로 기우는 대각선 띠.
                 *
                 * taper: 시작/끝(완전히 말리거나 펼쳐짐)에서 opacity 0으로.
                 */}
                <G
                  transform={`skewY(${skewDeg.toFixed(4)})`}
                >
                  <Rect
                    x={0}
                    y={rollTopAvg - 22}
                    width={cardSmallW}
                    height={44}
                    fill="url(#qcCreaseGrad)"
                  />
                </G>
              </Svg>

              {/* SpringCoil: SVG 위에 오버레이 (항상 최상단) */}
              <View
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              >
                <SpringCoil width={cardSmallW} />
              </View>
            </View>

          ) : isTearing ? (
            /* ══════════════════════════════════════════════════════════
             * TEAR 애니메이션
             * 다음 카드를 뒤에 고정 노출, 나가는 카드는 톱니 클립 + 1시 방향 날아가기
             * ══════════════════════════════════════════════════════════ */
            <>
              {/* 다음 카드 (정적, 뒤에 대기) */}
              <View style={[cardBaseStyle, { zIndex: 9 }]}>
                <View style={{ height: SPRING_H, flexShrink: 0 }} />
                <View style={s.cardInner}>
                  <Text style={s.questionText} numberOfLines={6}>
                    {incoming?.q ?? ""}
                  </Text>
                </View>
                <SpringCoil width={cardSmallW} />
              </View>

              {/*
               * 나가는 카드: SVG 톱니 ClipPath로 찢긴 윗변 표현 + Reanimated 날아가기.
               * SpringCoil이 overflow:visible 컨테이너 위에 ovelray되므로 zIndex 높게.
               */}
              <View
                style={[
                  cardBaseStyle,
                  {
                    zIndex: 12,
                    overflow: "visible",
                    opacity: tearFlyOpacity,
                    transform: [
                      { translateX: tearFlyX },
                      { translateY: tearFlyY },
                      { rotate: `${tearFlyRot}deg` },
                      { scale: tearFlyScale },
                    ],
                  },
                ]}
              >
                {/*
                 * 톱니 모양 마스킹 + 카드 내용.
                 * ForeignObject 대신 MaskedView + SVG Polygon 마스크 사용
                 * (네이티브에서 텍스트 사라짐/렉 없이 안정적으로 렌더).
                 */}
                <MaskedView
                  style={[StyleSheet.absoluteFillObject, { borderRadius: 20, overflow: "hidden" }]}
                  maskElement={
                    <Svg width={cardSmallW} height={cardSmallH}>
                      <Polygon points={tornTopPoints} fill="#000" />
                    </Svg>
                  }
                >
                  <CardFaceContent
                    question={outSnap?.q ?? ""}
                    answer={outSnap?.ans ?? ""}
                    width={cardSmallW}
                    height={cardSmallH}
                  />
                </MaskedView>

                {/* SpringCoil: 마스킹된 카드 위 오버레이 */}
                <View
                  style={StyleSheet.absoluteFillObject}
                  pointerEvents="none"
                >
                  <SpringCoil width={cardSmallW} />
                </View>
              </View>
            </>

          ) : (
            /* ══════════════════════════════════════════════════════════
             * 정적 카드 (드래그 피드백 + TextInput)
             * ══════════════════════════════════════════════════════════ */
            <Animated.View style={[cardBaseStyle, cardDragStyle]}>
              {/* SPRING_H 스페이서 + 콘텐츠 */}
              <View style={{ height: SPRING_H, flexShrink: 0 }} />
              <View style={s.cardInner}>
                <Text style={s.questionText} numberOfLines={6}>
                  {currentQ}
                </Text>
                <TextInput
                  style={s.answerInput}
                  value={currentAnswer}
                  onChangeText={(v) => {
                    if (isNewCard) {
                      setNewAnswer(v);
                      newAnswerRef.current = v;
                    } else {
                      setSaved((prev) => {
                        const next = prev.map((c, i) =>
                          i === ptr ? { ...c, answer: v } : c,
                        );
                        savedRef.current = next;
                        return next;
                      });
                    }
                  }}
                  placeholder="생각을 자유롭게 적어보세요..."
                  placeholderTextColor={Colors.zinc400}
                  multiline
                  textAlignVertical="top"
                />
              </View>
              {/* SpringCoil: 항상 카드 최상단에 absolute 렌더 */}
              <SpringCoil width={cardSmallW} />
            </Animated.View>
          )}

        </View>
      </GestureDetector>

      {/* ↑/↓ 이전·다음 질문 버튼 (목업과 동일: 하단 중앙, ↓=이전 ↑=다음) */}
      <View style={s.navButtonsRow} pointerEvents="box-none">
        <Pressable
          onPress={() => triggerBackRef.current()}
          accessibilityLabel="이전 질문"
          style={s.navButton}
          hitSlop={8}
        >
          <Text style={s.navButtonLabel}>↓</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (animatingRef.current) return;
            const _isNew = ptrRef.current === savedRef.current.length;
            triggerAdvanceRef.current(
              _isNew ? newAnswerRef.current.trim().length > 0 : true,
            );
          }}
          accessibilityLabel="다음 질문"
          style={s.navButton}
          hitSlop={8}
        >
          <Text style={s.navButtonLabel}>↑</Text>
        </Pressable>
      </View>

      {/* 보관/삭제 액션시트 */}
      <ActionSheetModal
        visible={actionSheetVisible}
        title="이 질문을"
        actions={[
          {
            label: "보관하기",
            style: "default",
            onPress: () => {
              setActionSheetVisible(false);
              triggerAdvanceRef.current(true);
            },
          },
          {
            label: "삭제하기",
            style: "destructive",
            onPress: () => {
              setActionSheetVisible(false);
              triggerAdvanceRef.current(false);
            },
          },
          { label: "취소", style: "cancel", onPress: () => {} },
        ]}
        onClose={() => setActionSheetVisible(false)}
      />
    </Animated.View>
  );
}

/* ─── 스타일 ─────────────────────────────────────────────────────────── */
const s = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
  },
  gestureLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 41,
  },
  navButtonsRow: {
    position: "absolute",
    bottom: 28,
    left: 0,
    right: 0,
    zIndex: 50,
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
  },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      web: {
        boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
      } as object,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
        elevation: 6,
      },
    }),
  },
  navButtonLabel: {
    fontSize: 18,
    color: Colors.zinc700,
  },
  stackLayerBack: {
    position: "absolute",
    borderRadius: 20,
    backgroundColor: "#ede8d8",
    zIndex: 0,
    ...Platform.select({
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 8,
        elevation: 2,
      },
    }),
  },
  stackLayerFront: {
    position: "absolute",
    borderRadius: 20,
    backgroundColor: "#f4f0e2",
    zIndex: 0,
    ...Platform.select({
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 1,
      },
    }),
  },
  cardInner: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 24,
  },
  questionText: {
    fontSize: 18,
    fontFamily: ReaderTokens.fontFamily.serif,
    fontWeight: "400",
    color: Colors.zinc900,
    lineHeight: 28,
    letterSpacing: 0.3,
    marginBottom: 20,
  },
  answerInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: ReaderTokens.fontFamily.serif,
    color: Colors.zinc700,
    lineHeight: 28,
    letterSpacing: 0.5,
    textAlignVertical: "top",
    padding: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
  },
});
