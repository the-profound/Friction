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

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
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
  type SharedValue,
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

/* ─── 질문 데이터 ────────────────────────────────────────────────────────
 * 고정 3개 질문 폴백 — 글마다 AI가 생성한 질문(5개, `questions` prop)이 아직
 * 준비되지 않았거나 실패한 경우, 또는 prop이 전달되지 않은 경우 사용된다. */
const FALLBACK_QUESTIONS = [
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
  /** 카드가 오른쪽으로 빠져나가는 애니메이션의 커밋이 확정된 시점(release)에
   *  호출됨 — read.tsx가 즉시 페이지 상태를 되돌릴 수 있게 한다. 실제 화면
   *  이동은 이미 드래그 내내 `dismissPrevSlotSV`로 라이브 추적되어 있었으므로
   *  이 시점엔 상태만 전환하면 된다. */
  onDismissOverlay: () => void;
  /** 카드가 오른쪽으로 완전히 빠져나간 뒤(애니메이션 종료) 호출됨 —
   *  이 시점에 카드를 언마운트해도 이미 화면 밖이라 끊김이 보이지 않는다. */
  onDismissOverlayComplete?: () => void;
  /** 좌 스와이프 제스처가 시작된 첫 프레임에 1회 호출됨 — 읽기 완료 화면을
   *  즉시 마운트해 드래그 내내 `completeEntranceX`로 라이브 추적할 수 있게
   *  한다 (커밋 여부는 아직 미정, 취소되면 onReadingCompleteCancel 호출). */
  onReadingCompleteBegin: (hasSubstantialAnswer: boolean) => void;
  /** 좌 스와이프가 임계값 미만으로 취소되어 카드가 제자리로 돌아올 때 호출됨 —
   *  읽기 완료 화면을 다시 언마운트한다. */
  onReadingCompleteCancel: () => void;
  /** 읽기 페이지 프레임 크기 (read.tsx의 layout.containerWidth/Height와 동일).
   *  카드를 이 프레임 안에 거의 꽉 차게 배치해 페이지와 크기를 맞춘다. */
  containerWidth: number;
  containerHeight: number;
  /** read.tsx가 소유한, 카드의 절대 translateX (W=화면 밖 오른쪽, 0=제자리).
   *  마지막 페이지→카드 진입(A)을 read.tsx의 페이지 드래그와 라이브로
   *  동기화하기 위해 내부 entranceTX 대신 이 값을 그대로 사용한다. */
  entranceX: SharedValue<number>;
  /** read.tsx의 `prevSlotSV` — 카드→마지막 페이지 복귀(B) 드래그 중 라이브로
   *  써서, 이미 마운트되어 있는 이전 페이지 슬롯이 카드와 1:1로 함께
   *  드러나도록 한다. */
  dismissPrevSlotSV: SharedValue<number>;
  /** read.tsx의 `currentSlotSV` — B 커밋이 끝난 뒤 "current"/"prev" 두 슬롯을
   *  정상 휴식 상태(current=0 노출, prev=파크)로 되돌리는 데 필요하다. B 동안
   *  라이브로 노출된 것은 prev 슬롯이었지만, currentPage가 감소한 뒤에는 같은
   *  내용이 이제 current 슬롯의 몫이므로 — 이 스왑을 안 해주면 prev 슬롯이
   *  0에 낀 채로 남아 current 위에 영원히 덮여, 다음 A 드래그가 (진짜로
   *  움직이는 current 대신) 이 정지된 prev 슬롯에 가려 다르게 보인다. */
  currentSlotSV: SharedValue<number>;
  /** read.tsx의 `flatTransitionSV` — B/C 드래그가 활성인 동안 1로 세팅해
   *  이전 페이지 슬롯의 회전/그림자를 끈다 (완전 평면 슬라이드). */
  flatTransitionSV: SharedValue<number>;
  /** read.tsx가 소유한, 읽기 완료 화면의 절대 translateX. 카드→완료(C) 진입과
   *  완료→카드 복귀(D, ReadingCompleteScreen 자체 제스처)가 같은 값을 공유해
   *  두 방향 모두 라이브 추적되도록 한다. */
  completeEntranceX: SharedValue<number>;
  /** read.tsx가 소유한 카드 자체의 라이브 드래그 translateX (이전에는 이
   *  컴포넌트 내부 로컬 상태였음). C(카드→완료)와 D(완료→카드,
   *  ReadingCompleteScreen 자체 제스처) 모두 completeEntranceX와 함께
   *  cardTX = completeEntranceX - W 공식으로 이 값을 구동해야, D 방향으로
   *  되돌아올 때도 카드가 화면 밖에서 함께 슬라이드 인 하는 진짜 나란한
   *  스와이프처럼 보인다 (내부 로컬 상태였을 때는 D가 이 값을 건드릴 수
   *  없어 카드가 제자리에 정지된 채 완료 화면만 걷히는 것처럼 보였다). */
  cardTX: SharedValue<number>;
  /** 이 글에 대한 질문 카드 질문 목록 (AI 생성 5개, 또는 서버 폴백 3개).
   *  아직 로드되지 않았거나(undefined) 비어있으면 컴포넌트 내장 고정 3개 질문으로 대체된다. */
  questions?: string[];
  /** 읽기 완료 화면(ReadingCompleteScreen)이 현재 화면 위에 떠 있는지 여부.
   *  true 동안 수평 스와이프(B: 오른쪽, C: 왼쪽)를 처리하지 않아
   *  ReadingCompleteScreen의 backGesture와 제스처 경합이 발생하지 않도록 한다. */
  isCompleteVisible?: boolean;
}

/** 답한(한 글자 이상 입력한) 질문 카드 하나. */
export interface AnsweredQuestionCard {
  question: string;
  answer: string;
}

/** read.tsx가 완료 커밋 시점에 답한 질문 카드 목록을 끌어오기 위한 imperative handle. */
export interface QuestionCardCurlHandle {
  /** 답한 순서대로 정렬된, 한 글자 이상 답변이 있는 카드 전부(현재 입력 중인
   *  카드 포함)를 반환한다. */
  getAnsweredCards: () => AnsweredQuestionCard[];
}

/* 카드가 프레임을 완전히 채우는 비율 — 마지막 페이지/읽기 완료 화면과 정확히
 * 같은 크기여야 전환 시 배경(readerFrame)의 흰 사각형 테두리가 드러나지 않는다. */
const CARD_FILL_RATIO = 1;
/* B/C 드래그 커밋 시 마무리 애니메이션 지속 시간/이징 — 페이지 넘김과 동일한 체감 속도 */
const SETTLE_DURATION = 360;
const SETTLE_EASING = Easing.bezier(0.25, 0.46, 0.45, 0.94);
/* B/C 커밋 임계값 — 일반 페이지 넘김/D(완료→카드)와 동일한 느낌 */
const COMMIT_DISTANCE_RATIO = 0.22;
const COMMIT_VELOCITY = 450;
/* read.tsx의 파킹 오프셋과 반드시 동일해야 함 — B 커밋 완료 시 prevSlotSV를
 * 정확히 같은 "파크" 위치로 되돌리기 위함 (read.tsx PARK_EXTRA 참조). */
const PARK_EXTRA = 120;

/* ════════════════════════════════════════════════════════════════════════
 * QuestionCardCurl (메인 컴포넌트)
 * ════════════════════════════════════════════════════════════════════════ */
function QuestionCardCurlInner({
  onDismissOverlay,
  onDismissOverlayComplete,
  onReadingCompleteBegin,
  onReadingCompleteCancel,
  containerWidth: screenWidth,
  containerHeight: screenHeight,
  entranceX,
  dismissPrevSlotSV,
  currentSlotSV,
  flatTransitionSV,
  completeEntranceX,
  cardTX,
  questions,
  isCompleteVisible,
}: QuestionCardCurlProps, ref: React.ForwardedRef<QuestionCardCurlHandle>) {
  /* 3~5개 가변 질문 목록: prop이 비어있거나 없으면 고정 3개 질문으로 대체 */
  const activeQuestions = questions && questions.length > 0 ? questions : FALLBACK_QUESTIONS;
  const activeQuestionsRef = useRef(activeQuestions);
  activeQuestionsRef.current = activeQuestions;

  /* ── 카드 레이아웃 (페이지 프레임과 거의 동일한 크기) ───────────────── */
  const cardSmallW = Math.round(screenWidth * CARD_FILL_RATIO);
  const cardSmallH = Math.round(screenHeight * CARD_FILL_RATIO);
  const cardSmallLeft = Math.round((screenWidth - cardSmallW) / 2);

  /* ── 진입/드래그 위치는 read.tsx가 소유한 `entranceX`로 완전히 제어된다
   *    (A: 마지막 페이지 드래그와 라이브 동기화). 이 컴포넌트는 마운트 시점에
   *    이미 read.tsx가 세팅해 둔 값을 그대로 읽어 스타일만 적용한다. ── */
  const entranceStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: entranceX.value }],
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
  // 드래그 팔로우 피드백 (좌우 스와이프 + 대기 카드 위/아래 드래그).
  // cardTX는 read.tsx가 소유한 prop으로 끌어올려졌다 (D 전환이 함께 구동해야
  // 하므로 — 위 QuestionCardCurlProps.cardTX 주석 참고).
  const cardTY = useSharedValue(0);
  // Guards onReadingCompleteBegin to fire once per left-drag gesture (C),
  // reset at gesture start so re-dragging left again after a cancel re-fires it.
  const completeBeginFiredRef = useRef(false);
  // Tracks the latest isCompleteVisible prop in a ref so panGesture (useMemo)
  // can read the live value without needing it in the dependency array.
  const isCompleteVisibleRef = useRef(isCompleteVisible ?? false);
  isCompleteVisibleRef.current = isCompleteVisible ?? false;
  // Locks the vertical/horizontal classification for the CURRENT gesture the
  // first time one axis dominates, so onEnd always agrees with whatever
  // onUpdate has been live-driving all along. Without this, onUpdate and
  // onEnd each independently re-derive `Math.abs(dy) > Math.abs(dx)` from the
  // same cumulative translation — if the release point happens to land with a
  // slightly different dominant axis than most of the drag (e.g. a rightward
  // B-dismiss swipe with a bit of vertical drift), onEnd can classify it as
  // vertical while onUpdate had been live-driving the horizontal dismiss the
  // whole time, so the horizontal drag never commits/cancels and the legacy
  // vertical dy>80 branch (triggerBack) fires instead — looking exactly like
  // the old pre-fix behavior.
  const dragAxisRef = useRef<"horizontal" | "vertical" | null>(null);

  const cardDragStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: cardTX.value },
      { translateY: cardTY.value },
    ],
  }));
  // The "notepad stack" decorative layers (stackLayerBack/Front) sit behind
  // the draggable card to sell a stack-of-pages depth illusion. They must
  // move in lockstep with the card during a HORIZONTAL B/C dismiss drag —
  // otherwise the top card slides away on the finger while these two beige
  // layers stay frozen in place (entranceX only moves the whole component on
  // commit/cancel, not per-frame during the live drag), leaving a stray
  // stationary beige/white patch visible mid-drag until commit finally moves
  // everything at once. Deliberately translateX-only (not translateY) so the
  // VERTICAL question-advance/back flip still shows the stack staying put
  // while just the top card flips, which is the intended look there.
  const stackDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cardTX.value }],
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
      const _questions = activeQuestionsRef.current;

      const outQ = _isNew
        ? _questions[_seq % _questions.length]
        : _questions[_saved[_ptr]?.qIdx ?? 0];
      const outAns = _isNew ? _ans : (_saved[_ptr]?.answer ?? "");

      let nextSaved = _saved;
      let nextPtr: number;
      let nextSeq = _seq;

      if (_isNew) {
        nextSeq = _seq + 1;
        if (hasAnswer) {
          const entry = { qIdx: _seq % _questions.length, answer: _ans };
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
        ? _questions[nextSeq % _questions.length]
        : _questions[nextSaved[nextPtr]?.qIdx ?? 0];
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
    const _questions = activeQuestionsRef.current;
    const outQ = isCurrentNew
      ? _questions[seqRef.current % _questions.length]
      : _questions[_saved[_ptr]?.qIdx ?? 0];
    const outAns = isCurrentNew
      ? newAnswerRef.current
      : (_saved[_ptr]?.answer ?? "");

    const prevCard = _saved[_ptr - 1];
    const prevQ = _questions[prevCard.qIdx];

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

  /* ── read.tsx가 완료 커밋 시점에 답한 카드를 모두 끌어올 수 있는 핸들.
   *  savedRef(이미 넘긴 카드들)에, 현재 "새 카드" 슬롯(ptr === saved.length)에
   *  한 글자 이상 입력 중인 답변이 있으면 그것까지 답한 순서 그대로 덧붙인다. */
  useImperativeHandle(ref, () => ({
    getAnsweredCards: () => {
      const _saved = savedRef.current;
      const _questions = activeQuestionsRef.current;
      const cards: AnsweredQuestionCard[] = _saved
        .filter((c) => c.answer.trim().length > 0)
        .map((c) => ({ question: _questions[c.qIdx] ?? "", answer: c.answer }));

      const _ptr = ptrRef.current;
      const isCurrentNew = _ptr === _saved.length;
      if (isCurrentNew && newAnswerRef.current.trim().length > 0) {
        const _seq = seqRef.current;
        cards.push({
          question: _questions[_seq % _questions.length] ?? "",
          answer: newAnswerRef.current,
        });
      }
      return cards;
    },
  }), []);

  /* ── Pan gesture ─────────────────────────────────────────────────────── */
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(8)
        .onBegin(() => {
          dragAxisRef.current = null;
        })
        .onUpdate((e) => {
          if (animatingRef.current) return;
          const dx = e.translationX;
          const dy = e.translationY;
          // Lock the axis the first time either direction clearly dominates
          // (small deadzone avoids locking on the very first noisy pixels),
          // then keep using that same axis for the rest of this gesture.
          if (dragAxisRef.current === null && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            dragAxisRef.current = Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
          }
          const isVertical = dragAxisRef.current === null
            ? Math.abs(dy) > Math.abs(dx)
            : dragAxisRef.current === "vertical";
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
            // 완료 화면이 안정적으로 떠 있는 동안(이전 C가 커밋된 D 상태)에는
            // 수평 스와이프(B/C)를 차단해 ReadingCompleteScreen의 backGesture(D)와
            // 충돌하지 않도록 한다. 단, 현재 C 제스처가 진행 중(completeBeginFiredRef=true)
            // 이라면 차단하면 안 된다 — 이 제스처가 바로 완료 화면을 마운트시킨 장본인
            // 이므로 계속 onUpdate로 추적해 커밋/취소가 정상 처리되어야 한다.
            if (isCompleteVisibleRef.current && !completeBeginFiredRef.current) return;
            const W = screenWidth || 300;
            cardTX.value = dx;
            if (dx > 0) {
              // (B) 카드→마지막 페이지 복귀: 이미 마운트된 이전 페이지 슬롯을
              // 1:1로 라이브 노출한다 (read.tsx의 prevSlotSV/flatTransitionSV
              // 컨벤션과 동일 — slideIn = prevSlotSV + W).
              flatTransitionSV.value = 1;
              dismissPrevSlotSV.value = dx - W;
              completeBeginFiredRef.current = false;
            } else if (dx < 0) {
              // (C) 카드→읽기 완료 진입: 첫 프레임에 1회만 완료 화면을 마운트
              // 요청하고, 이후 매 프레임 라이브로 위치를 동기화한다.
              if (!completeBeginFiredRef.current) {
                completeBeginFiredRef.current = true;
                // 1자 이상 입력하면 "answered" 종료 화면으로 분기한다.
                const hasSubstantial =
                  savedRef.current.some((c) => c.answer.trim().length > 0) ||
                  newAnswerRef.current.trim().length > 0;
                runOnJS(onReadingCompleteBegin)(hasSubstantial);
              }
              completeEntranceX.value = W + dx;
              flatTransitionSV.value = 0;
              dismissPrevSlotSV.value = -(W + 400);
            }
          }
        })
        .onEnd((e) => {
          if (animatingRef.current) return;
          const dx = e.translationX;
          const dy = e.translationY;
          const THRESHOLD = 80;
          // Use the SAME axis onUpdate locked in for this gesture (see
          // dragAxisRef above) instead of re-deriving it from scratch here —
          // otherwise a release point with a slightly different dx/dy ratio
          // than the rest of the drag can disagree with what was just being
          // live-animated, dropping the horizontal commit/cancel entirely.
          const isVertical = dragAxisRef.current === null
            ? Math.abs(dy) > Math.abs(dx)
            : dragAxisRef.current === "vertical";

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
            // 완료 화면이 안정적으로 떠 있는 동안(이전 C 커밋 후 D 상태)에는
            // 수평 스와이프(B/C)를 차단한다. 단, 현재 C 제스처가 진행 중이라면
            // 차단하지 않는다 — onUpdate에서 이미 라이브 추적 중이므로 여기서
            // 커밋/취소 판정이 계속 처리되어야 한다 (completeBeginFiredRef 참조).
            if (isCompleteVisibleRef.current && !completeBeginFiredRef.current) return;
            const W = screenWidth || 300;
            const commit =
              Math.abs(dx) > W * COMMIT_DISTANCE_RATIO ||
              Math.abs(e.velocityX) > COMMIT_VELOCITY;
            if (dx < 0 && commit) {
              // (C) 좌 스와이프 커밋: 카드는 왼쪽으로 완전히 빠져나가고, 이미
              // 마운트되어 라이브 추적 중이던 읽기 완료 화면이 같은 타이밍으로
              // 0(제자리)까지 도착한다 — 하나로 연결된 슬라이드.
              animatingRef.current = true;
              setAnimating(true);
              cardTX.value = withTiming(-W, {
                duration: SETTLE_DURATION,
                easing: SETTLE_EASING,
              });
              completeEntranceX.value = withTiming(
                0,
                { duration: SETTLE_DURATION, easing: SETTLE_EASING },
                () => {
                  // Always reset guard flags regardless of finished — gating on
                  // `finished` leaves animatingRef/completeBeginFiredRef permanently
                  // set when the animation is interrupted, blocking all future C
                  // attempts after D returns the user to this card.
                  // NOTE: cardTX is intentionally left parked at -W here
                  // (not reset to 0) — the card must stay off-screen to the
                  // left while the completion screen is fully shown, so
                  // that D's back-swipe (owned by ReadingCompleteScreen,
                  // driving cardTX = tx - W in lockstep) can reveal it
                  // sliding back in from -W. Resetting to 0 here would put
                  // the card back in its resting/visible position behind
                  // the opaque completion overlay, making D's reveal look
                  // like the completion screen is floating in front of an
                  // already-in-place card instead of a true side-by-side
                  // swap. D's own commit branch resets cardTX to 0 once the
                  // user actually swipes back to the card.
                  animatingRef.current = false;
                  // Clear the "begin" guard now that the entrance is done —
                  // otherwise the next C attempt (after D brings the user
                  // back to this same still-mounted card) silently skips
                  // onReadingCompleteBegin and never re-mounts the
                  // completion screen. Mirrors the cardEntranceMountedRef
                  // fix for A in read.tsx.
                  completeBeginFiredRef.current = false;
                  runOnJS(setAnimating)(false);
                },
              );
            } else if (dx > 0 && commit) {
              // (B) 우 스와이프 커밋: 카드는 오른쪽으로 완전히 빠져나가고, 이미
              // 라이브 추적 중이던 이전 페이지 슬롯이 같은 타이밍으로 제자리(0)
              // 까지 도착한다. onDismissOverlay는 release 시점에 상태만 전환.
              runOnJS(onDismissOverlay)();
              cardTX.value = withTiming(W, {
                duration: SETTLE_DURATION,
                easing: SETTLE_EASING,
              });
              dismissPrevSlotSV.value = withTiming(
                0,
                { duration: SETTLE_DURATION, easing: SETTLE_EASING },
                () => {
                  // Always reset guard flags regardless of finished — gating on
                  // `finished` leaves slot SVs and onDismissOverlayComplete uncalled
                  // when the animation is interrupted, permanently blocking the next
                  // A→B re-entry. Mirrors the pattern in read.tsx A commit callback.
                  cardTX.value = 0;
                  flatTransitionSV.value = 0;
                  // B 동안 라이브로 노출된 건 "prev" 슬롯이었지만, onDismissOverlay가
                  // 이미 currentPage를 감소시켜 둔 상태라 그 내용은 지금부턴 "current"
                  // 슬롯의 몫이다. 여기서 즉시(동일 프레임) current=0(노출)/
                  // prev=파크로 스왑하지 않으면 prev가 0에 낀 채로 영원히 current
                  // 위에 남아, 다음 A 드래그 때 실제로 움직이는 current 슬롯이 이
                  // 정지된 prev에 가려 애니메이션이 달라 보인다.
                  currentSlotSV.value = 0;
                  dismissPrevSlotSV.value = -(screenWidth + PARK_EXTRA);
                  if (onDismissOverlayComplete) runOnJS(onDismissOverlayComplete)();
                },
              );
            } else if (dx < 0) {
              // (C) 취소: 카드 제자리 복귀 + 미리 마운트했던 완료 화면 언마운트 요청.
              completeBeginFiredRef.current = false;
              cardTX.value = withSpring(0, { damping: 18, stiffness: 280, mass: 0.8 });
              completeEntranceX.value = withSpring(
                W,
                { damping: 18, stiffness: 280, mass: 0.8 },
                (finished) => {
                  if (finished) runOnJS(onReadingCompleteCancel)();
                },
              );
            } else if (dx > 0) {
              // (B) 취소: 카드 제자리 복귀 + 이전 페이지 슬롯을 다시 파크 위치로.
              cardTX.value = withSpring(0, { damping: 18, stiffness: 280, mass: 0.8 });
              dismissPrevSlotSV.value = withSpring(
                -(W + 400),
                { damping: 18, stiffness: 280, mass: 0.8 },
                (finished) => {
                  if (finished) flatTransitionSV.value = 0;
                },
              );
            }
          }
        }),
    [
      cardTX,
      cardTY,
      cardSmallH,
      cardSmallW,
      screenWidth,
      onDismissOverlay,
      onDismissOverlayComplete,
      onReadingCompleteBegin,
      onReadingCompleteCancel,
      dismissPrevSlotSV,
      flatTransitionSV,
      completeEntranceX,
    ],
  );

  /* ── 현재 카드 표시값 ────────────────────────────────────────────────── */
  const isNewCard = ptr === saved.length;
  const currentQIdx = isNewCard
    ? seq % activeQuestions.length
    : (saved[ptr]?.qIdx ?? 0);
  const currentQ = activeQuestions[currentQIdx];
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
          <Animated.View
            style={[
              s.stackLayerBack,
              {
                left: cardSmallLeft - 2,
                top: "50%" as unknown as number,
                marginTop: -(cardSmallH / 2) + 7,
                width: cardSmallW,
                height: cardSmallH,
              },
              stackDragStyle,
            ]}
          />
          <Animated.View
            style={[
              s.stackLayerFront,
              {
                left: cardSmallLeft - 1,
                top: "50%" as unknown as number,
                marginTop: -(cardSmallH / 2) + 3.5,
                width: cardSmallW,
                height: cardSmallH,
              },
              stackDragStyle,
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

      {/* 이전/다음 질문 이동은 오직 상하 스와이프(카드 자체 세로 팬 제스처)로만
          동작한다 — ↑/↓ 버튼은 제거됨 (사용자 요청). */}

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

const QuestionCardCurl = forwardRef(QuestionCardCurlInner);
export default QuestionCardCurl;

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
