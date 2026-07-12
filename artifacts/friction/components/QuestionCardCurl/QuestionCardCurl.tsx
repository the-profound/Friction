/*
 * QuestionCardCurl — 질문 카드 슬라이드 전환 컴포넌트
 *
 * 상하 스와이프: 위로 스와이프 → 현재 카드 우상단 슬라이드 아웃 + 다음 카드 아래서 인
 *               아래로 스와이프 → 현재 카드 아래 슬라이드 아웃 + 이전 카드 아래서 인
 *
 * 좌우 스와이프: B(우→마지막 페이지 복귀) / C(좌→읽기 완료 진입)
 */

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Platform,
  Keyboard,
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

/* ─── 슬라이드 전환 상수 ────────────────────────────────────────────── */
const SLIDE_DURATION = 380;
const SLIDE_EASING = Easing.bezier(0.25, 0.46, 0.45, 0.94);

/* B/C 드래그 커밋 시 마무리 애니메이션 지속 시간/이징 — 페이지 넘김과 동일한 체감 속도 */
const SETTLE_DURATION = 360;
const SETTLE_EASING = Easing.bezier(0.25, 0.46, 0.45, 0.94);
/* B/C 커밋 임계값 */
const COMMIT_DISTANCE_RATIO = 0.22;
const COMMIT_VELOCITY = 450;
/* read.tsx의 파킹 오프셋과 반드시 동일 */
const PARK_EXTRA = 120;

/* ─── CardFaceContent: 슬라이드 전환 중 고스트 표시용 ────────────────── */
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
  inner: { flex: 1, paddingHorizontal: 28, paddingTop: 28, paddingBottom: 24 },
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
   *  호출됨 — read.tsx가 즉시 페이지 상태를 되돌릴 수 있게 한다. */
  onDismissOverlay: () => void;
  /** 카드가 오른쪽으로 완전히 빠져나간 뒤(애니메이션 종료) 호출됨 */
  onDismissOverlayComplete?: () => void;
  /** 좌 스와이프 제스처가 시작된 첫 프레임에 1회 호출됨 */
  onReadingCompleteBegin: (hasSubstantialAnswer: boolean) => void;
  /** 좌 스와이프가 임계값 미만으로 취소되어 카드가 제자리로 돌아올 때 호출됨 */
  onReadingCompleteCancel: () => void;
  /** 읽기 페이지 프레임 크기 */
  containerWidth: number;
  containerHeight: number;
  /** read.tsx가 소유한, 카드의 절대 translateX */
  entranceX: SharedValue<number>;
  /** read.tsx의 `prevSlotSV` */
  dismissPrevSlotSV: SharedValue<number>;
  /** read.tsx의 `currentSlotSV` */
  currentSlotSV: SharedValue<number>;
  /** read.tsx의 `flatTransitionSV` */
  flatTransitionSV: SharedValue<number>;
  /** read.tsx가 소유한 읽기 완료 화면의 절대 translateX */
  completeEntranceX: SharedValue<number>;
  /** read.tsx가 소유한 카드 자체의 라이브 드래그 translateX */
  cardTX: SharedValue<number>;
  /** 이 글에 대한 질문 카드 질문 목록 */
  questions?: string[];
  /** 읽기 완료 화면이 현재 화면 위에 떠 있는지 여부 */
  isCompleteVisible?: boolean;
  /** read.tsx의 keyboardVisibleRef */
  keyboardVisibleRef: React.RefObject<boolean>;
}

/** 답한(한 글자 이상 입력한) 질문 카드 하나. */
export interface AnsweredQuestionCard {
  question: string;
  answer: string;
}

/** read.tsx가 완료 커밋 시점에 답한 질문 카드 목록을 끌어오기 위한 imperative handle. */
export interface QuestionCardCurlHandle {
  getAnsweredCards: () => AnsweredQuestionCard[];
}

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
  keyboardVisibleRef,
}: QuestionCardCurlProps, ref: React.ForwardedRef<QuestionCardCurlHandle>) {
  /* 3~5개 가변 질문 목록: prop이 비어있거나 없으면 고정 3개 질문으로 대체 */
  const activeQuestions = questions && questions.length > 0 ? questions : FALLBACK_QUESTIONS;
  const activeQuestionsRef = useRef(activeQuestions);
  activeQuestionsRef.current = activeQuestions;

  /* ── 카드 레이아웃: 편지 페이지와 동일한 너비, 높이 = 너비 × 6/5 ─── */
  const cardSmallW = screenWidth;          // containerWidth와 동일
  const cardSmallH = Math.round(cardSmallW * 6 / 5);
  const cardSmallLeft = 0;

  /* ── 진입 스타일 (read.tsx entranceX 라이브 동기화) ─────────────────── */
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
  const [animDir, setAnimDir] = useState<"forward" | "back">("forward");
  const [outSnap, setOutSnap] = useState<{ q: string; ans: string } | null>(null);
  const [incoming, setIncoming] = useState<{ q: string; ans: string } | null>(null);

  /* ── Action sheet ─────────────────────────────────────────────────── */
  const [actionSheetVisible, setActionSheetVisible] = useState(false);

  /* ── Refs (stale closure 방지) ───────────────────────────────────────── */
  const animatingRef = useRef(false);
  const ptrRef = useRef(0);
  const savedRef = useRef<{ qIdx: number; answer: string }[]>([]);
  const seqRef = useRef(0);
  const newAnswerRef = useRef("");

  /* ── 스크롤 추적 refs ────────────────────────────────────────────────── */
  const contentHeightRef = useRef(0);
  const availableHeightRef = useRef(0);
  const scrollStartRef = useRef(0);
  const gestureScrolledRef = useRef(false);

  /* ── Shared values (Reanimated) ─────────────────────────────────────── */
  const cardTY = useSharedValue(0);
  const scrollOffsetSV = useSharedValue(0);
  const completeBeginFiredRef = useRef(false);
  const isCompleteVisibleRef = useRef(isCompleteVisible ?? false);
  isCompleteVisibleRef.current = isCompleteVisible ?? false;
  const dragAxisRef = useRef<"horizontal" | "vertical" | null>(null);
  // onEnd가 정상 실행됐는지 추적 — 외부 취소(다른 제스처가 인식을 뺏는 등)로
  // onEnd 없이 onFinalize만 불리면 드래그 중이던 값들을 원위치로 복구한다.
  const gestureHandledRef = useRef(false);

  /* ── 슬라이드 전환용 shared values ─────────────────────────────────── */
  // 나가는 카드의 위치 (초기값 0, 전환 중 슬라이드 아웃)
  const animOutX = useSharedValue(0);
  const animOutY = useSharedValue(0);
  // 들어오는 카드의 Y 위치 (초기값 screenHeight → 0으로 슬라이드 인)
  const animInY = useSharedValue(0);

  const cardDragStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: cardTX.value },
      { translateY: cardTY.value },
    ],
  }));
  const answerScrollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scrollOffsetSV.value }],
  }));
  const stackDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cardTX.value }],
  }));
  const animOutStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: animOutX.value },
      { translateY: animOutY.value },
    ],
  }));
  const animInStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: animInY.value }],
  }));

  /* ── afterTransition ─────────────────────────────────────────────────── */
  const afterTransition = useCallback(() => {
    animatingRef.current = false;
    setAnimating(false);
    setOutSnap(null);
    setIncoming(null);
    cardTY.value = 0;
    cardTX.value = 0;
    scrollOffsetSV.value = 0;
    animOutX.value = 0;
    animOutY.value = 0;
    animInY.value = 0;
  }, [cardTY, cardTX, scrollOffsetSV, animOutX, animOutY, animInY]);

  const afterTransitionRef = useRef(afterTransition);
  afterTransitionRef.current = afterTransition;

  /* ── triggerAdvance ──────────────────────────────────────────────────── */
  const triggerAdvance = useCallback(
    (_hasAnswer: boolean) => {
      if (animatingRef.current) return;

      const _ptr = ptrRef.current;
      const _saved = savedRef.current;
      const _seq = seqRef.current;
      const _ans = newAnswerRef.current;
      const _isNew = _ptr === _saved.length;
      const _questions = activeQuestionsRef.current;
      const hasAnswer = _isNew ? _ans.trim().length > 0 : true;

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
      setAnimDir("forward");
      setOutSnap({ q: outQ, ans: outAns });
      setIncoming({ q: nextQ, ans: nextAns });

      /* 나가는 카드: 현재 드래그 위치에서 시작해 우상단으로 슬라이드 아웃 */
      animOutX.value = cardTX.value;
      animOutY.value = cardTY.value;
      animInY.value = screenHeight;

      animOutX.value = withTiming(Math.round(screenWidth * 0.35), {
        duration: SLIDE_DURATION,
        easing: SLIDE_EASING,
      });
      animOutY.value = withTiming(-screenHeight, {
        duration: SLIDE_DURATION,
        easing: SLIDE_EASING,
      });
      /* 들어오는 카드: 아래에서 위로 슬라이드 인 */
      animInY.value = withTiming(0, {
        duration: SLIDE_DURATION,
        easing: SLIDE_EASING,
      }, () => {
        ptrRef.current = nextPtr;
        savedRef.current = nextSaved;
        seqRef.current = nextSeq;
        newAnswerRef.current = _isNew ? "" : _ans;
        runOnJS(setPtr)(nextPtr);
        runOnJS(setSaved)(nextSaved);
        runOnJS(setSeq)(nextSeq);
        if (_isNew) runOnJS(setNewAnswer)("");
        runOnJS(afterTransitionRef.current)();
      });
    },
    [animOutX, animOutY, animInY, cardTX, cardTY, screenWidth, screenHeight],
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
    setAnimDir("back");
    setOutSnap({ q: outQ, ans: outAns });
    setIncoming({ q: prevQ, ans: prevCard.answer });

    /* 나가는 카드: 현재 위치에서 아래로 슬라이드 아웃 */
    animOutX.value = cardTX.value;
    animOutY.value = cardTY.value;
    animInY.value = screenHeight;

    animOutY.value = withTiming(screenHeight, {
      duration: SLIDE_DURATION,
      easing: SLIDE_EASING,
    });
    animOutX.value = withTiming(0, {
      duration: SLIDE_DURATION,
      easing: SLIDE_EASING,
    });
    /* 이전 카드: 아래에서 위로 슬라이드 인 */
    animInY.value = withTiming(0, {
      duration: SLIDE_DURATION,
      easing: SLIDE_EASING,
    }, () => {
      ptrRef.current = _ptr - 1;
      runOnJS(setPtr)(_ptr - 1);
      runOnJS(afterTransitionRef.current)();
    });
  }, [animOutX, animOutY, animInY, cardTX, cardTY, screenHeight]);

  const triggerBackRef = useRef(triggerBack);
  triggerBackRef.current = triggerBack;

  /* ── read.tsx가 완료 커밋 시점에 답한 카드를 모두 끌어올 수 있는 핸들 */
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
          gestureScrolledRef.current = false;
          gestureHandledRef.current = false;
          scrollStartRef.current = scrollOffsetSV.value;
        })
        .onUpdate((e) => {
          if (animatingRef.current) return;
          // A 입장 애니메이션(마지막 페이지 → 카드)이 아직 진행 중이면 카드
          // 자체 제스처는 무시한다 — entranceX 타이밍과 cardTX/슬롯 드라이브가
          // 동시에 걸리면 서로 싸워서 반쯤 걸친 상태로 멈출 수 있다.
          if (entranceX.value > 0.5) return;
          const dx = e.translationX;
          const dy = e.translationY;
          if (dragAxisRef.current === null && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            dragAxisRef.current = Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
          }
          const isVertical = dragAxisRef.current === null
            ? Math.abs(dy) > Math.abs(dx)
            : dragAxisRef.current === "vertical";

          const overflowH = Math.max(0, contentHeightRef.current - availableHeightRef.current);

          /* ── 키보드 열린 상태 ──────────────────────────────────────────
           * 수평 / 위→아래: 방향만 추적 (onEnd에서 dismiss).
           * 아래→위 + 오버플로 있음: 스크롤 오프셋 업데이트.         */
          if (keyboardVisibleRef.current) {
            if (!isVertical || dy > 0) {
              // no movement — just tracking axis for onEnd
            } else if (dy < 0 && overflowH > 0) {
              const liveOffset = scrollOffsetSV.value;
              if (liveOffset > -overflowH) {
                gestureScrolledRef.current = true;
                scrollOffsetSV.value = Math.max(-overflowH, scrollStartRef.current + dy);
              }
            }
            return;
          }

          /* ── 키보드 꺼진 상태 ─────────────────────────────────────── */
          if (!isVertical) {
            if (isCompleteVisibleRef.current && !completeBeginFiredRef.current) return;
            const W = screenWidth || 300;
            cardTX.value = dx;
            if (dx > 0) {
              // (B) 카드 → 마지막 페이지: 서로 밀어내는 푸시 전환.
              // 카드가 떠 있는 동안 실제로 마운트돼 있는 슬롯은 "current"
              // 슬롯(마지막 페이지, -(W+PARK_EXTRA)에 파킹)이다 — prev 슬롯은
              // currentPageIdx === prevPageIdx 로 렌더가 생략되므로
              // dismissPrevSlotSV를 움직여도 화면엔 아무 일도 일어나지 않는다.
              // currentSlotSV를 cardTX와 1:1(dx - W)로 되밀어 넣어 마지막
              // 페이지가 카드 화면 왼쪽에 딱 붙어 함께 들어오게 한다.
              flatTransitionSV.value = 1;
              currentSlotSV.value = Math.min(0, dx - W);
              completeBeginFiredRef.current = false;
            } else if (dx < 0) {
              if (!completeBeginFiredRef.current) {
                completeBeginFiredRef.current = true;
                const hasSubstantial =
                  savedRef.current.some((c) => c.answer.trim().length > 0) ||
                  newAnswerRef.current.trim().length > 0;
                runOnJS(onReadingCompleteBegin)(hasSubstantial);
              }
              completeEntranceX.value = W + dx;
              // NOTE: flatTransitionSV는 여기서 0으로 내리지 않는다 — 아직
              // 카드 체류 중이며, 0이 되면 read.tsx의 next 슬롯 정적 그림자가
              // 카드 뒤에서 다시 켜져 "좌우로 늘어난 편지지" 고스트가 생긴다.
              // 방향이 우→좌로 뒤집힌 경우, B 드래그로 끌려 나왔던 마지막
              // 페이지를 다시 화면 밖으로 파킹한다.
              currentSlotSV.value = -(W + PARK_EXTRA);
              dismissPrevSlotSV.value = -(W + 400);
            }
          } else if (overflowH > 0) {
            const liveOffset = scrollOffsetSV.value;
            const atBottom = liveOffset <= -overflowH;
            const atTop = liveOffset >= 0;

            if (dy < 0) {
              if (!atBottom) {
                gestureScrolledRef.current = true;
                scrollOffsetSV.value = Math.max(-overflowH, scrollStartRef.current + dy);
              } else {
                gestureScrolledRef.current = false;
                cardTY.value = dy * 0.10;
              }
            } else if (dy > 0) {
              if (!atTop) {
                gestureScrolledRef.current = true;
                scrollOffsetSV.value = Math.min(0, scrollStartRef.current + dy);
              } else {
                gestureScrolledRef.current = false;
                const restTy = cardSmallH + 60;
                cardTY.value = ptrRef.current > 0
                  ? dy * 0.12
                  : Math.min(dy * 0.22, restTy * 0.28);
              }
            }
          } else {
            if (dy < 0) {
              cardTY.value = dy * 0.10;
            } else {
              const restTy = cardSmallH + 60;
              cardTY.value = ptrRef.current > 0
                ? dy * 0.12
                : Math.min(dy * 0.22, restTy * 0.28);
            }
          }
        })
        .onEnd((e) => {
          gestureHandledRef.current = true;
          if (animatingRef.current) return;
          if (entranceX.value > 0.5) return;
          const dx = e.translationX;
          const dy = e.translationY;
          const THRESHOLD = 80;
          const isVertical = dragAxisRef.current === null
            ? Math.abs(dy) > Math.abs(dx)
            : dragAxisRef.current === "vertical";

          const overflowH = Math.max(0, contentHeightRef.current - availableHeightRef.current);

          /* ── 키보드 열린 상태 ──────────────────────────────────────────
           * 수평 또는 위→아래: 키보드 dismiss.
           * 아래→위 스크롤이었으면: withSpring으로 오프셋 정착.          */
          if (keyboardVisibleRef.current) {
            if (!isVertical || dy > 0) {
              Keyboard.dismiss();
            } else if (gestureScrolledRef.current) {
              scrollOffsetSV.value = withSpring(scrollOffsetSV.value, { damping: 20, stiffness: 300 });
            }
            return;
          }

          /* ── 키보드 꺼진 상태 ─────────────────────────────────────── */
          if (isVertical) {
            if (gestureScrolledRef.current) {
              scrollOffsetSV.value = withSpring(scrollOffsetSV.value, { damping: 20, stiffness: 300 });
              cardTY.value = withSpring(0, { damping: 12, stiffness: 180 });
            } else {
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
            }
          } else {
            if (isCompleteVisibleRef.current && !completeBeginFiredRef.current) return;
            const W = screenWidth || 300;
            const commit =
              Math.abs(dx) > W * COMMIT_DISTANCE_RATIO ||
              Math.abs(e.velocityX) > COMMIT_VELOCITY;
            if (dx < 0 && commit) {
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
                  animatingRef.current = false;
                  completeBeginFiredRef.current = false;
                  runOnJS(setAnimating)(false);
                },
              );
            } else if (dx > 0 && commit) {
              // (B 커밋) 카드 화면이 오른쪽으로 완전히 밀려나가고, 마지막
              // 페이지가 왼쪽에서 1:1로 밀고 들어온다. 새틀 중에는
              // animatingRef로 추가 제스처를 차단한다 — 이걸 막지 않으면
              // 새틀 도중 새 드래그가 onDismissOverlay를 한 번 더 발사해
              // prevPage()가 두 번 호출되는(두 페이지 뒤로 가는) 오류가 난다.
              animatingRef.current = true;
              setAnimating(true);
              runOnJS(onDismissOverlay)();
              cardTX.value = withTiming(W, {
                duration: SETTLE_DURATION,
                easing: SETTLE_EASING,
              });
              currentSlotSV.value = withTiming(
                0,
                { duration: SETTLE_DURATION, easing: SETTLE_EASING },
                () => {
                  // finished 여부와 무관하게 항상 정리한다 — 취소됐다고
                  // 정리를 건너뛰면 플래그가 걸린 채로 남는다.
                  flatTransitionSV.value = 0;
                  currentSlotSV.value = 0;
                  dismissPrevSlotSV.value = -(screenWidth + PARK_EXTRA);
                  animatingRef.current = false;
                  runOnJS(setAnimating)(false);
                  if (onDismissOverlayComplete) runOnJS(onDismissOverlayComplete)();
                },
              );
            } else if (dx < 0) {
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
              // (B 취소) 카드는 제자리로, 끌려 나왔던 마지막 페이지는 다시
              // 화면 밖 파킹 위치로 되돌린다. flatTransitionSV는 그대로 1 —
              // 여전히 카드 체류 중이므로 0으로 내리면 next 슬롯 정적
              // 그림자가 카드 뒤에서 다시 켜진다.
              cardTX.value = withSpring(0, { damping: 18, stiffness: 280, mass: 0.8 });
              currentSlotSV.value = withSpring(
                -(W + PARK_EXTRA),
                { damping: 18, stiffness: 280, mass: 0.8 },
              );
            }
          }
        })
        .onFinalize(() => {
          // 외부 취소(다른 제스처가 인식을 뺏거나 시스템 인터럽트)로 onEnd가
          // 불리지 않은 채 끝난 경우 — 드래그 중이던 값들을 원위치로 복구해
          // 마지막 페이지가 반쯤 걸친 채 남거나 flat 플래그가 굳는 것을 막는다.
          if (gestureHandledRef.current) return;
          if (animatingRef.current) return;
          const W = screenWidth || 300;
          if (dragAxisRef.current === "horizontal") {
            // flatTransitionSV는 유지(1) — 카드 체류가 계속되므로 내리면
            // next 슬롯 정적 그림자 고스트가 생긴다. B 새틀 완료 시에만 0.
            cardTX.value = withSpring(0, { damping: 18, stiffness: 280, mass: 0.8 });
            currentSlotSV.value = withSpring(
              -(W + PARK_EXTRA),
              { damping: 18, stiffness: 280, mass: 0.8 },
            );
            if (completeBeginFiredRef.current) {
              completeBeginFiredRef.current = false;
              completeEntranceX.value = withSpring(
                W,
                { damping: 18, stiffness: 280, mass: 0.8 },
                (finished) => {
                  if (finished) runOnJS(onReadingCompleteCancel)();
                },
              );
            }
          } else {
            cardTY.value = withSpring(0, { damping: 12, stiffness: 180 });
            cardTX.value = withSpring(0, { damping: 12, stiffness: 180 });
          }
        }),
    [
      entranceX,
      cardTX,
      cardTY,
      cardSmallH,
      scrollOffsetSV,
      screenWidth,
      onDismissOverlay,
      onDismissOverlayComplete,
      onReadingCompleteBegin,
      onReadingCompleteCancel,
      dismissPrevSlotSV,
      currentSlotSV,
      flatTransitionSV,
      completeEntranceX,
      keyboardVisibleRef,
    ],
  );

  /* ── 현재 카드 표시값 ────────────────────────────────────────────────── */
  const isNewCard = ptr === saved.length;
  const currentQIdx = isNewCard
    ? seq % activeQuestions.length
    : (saved[ptr]?.qIdx ?? 0);
  const currentQ = activeQuestions[currentQIdx];
  const currentAnswer = isNewCard ? newAnswer : (saved[ptr]?.answer ?? "");

  /* ── 카드 공통 스타일 ─────────────────────────────────────────────── */
  const cardBaseStyle = useMemo(
    () => ({
      position: "absolute" as const,
      top: "50%" as unknown as number,
      marginTop: -(cardSmallH / 2),
      left: cardSmallLeft,
      width: cardSmallW,
      height: cardSmallH,
      borderRadius: 0,
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

          {/* 카드 화면의 흰 배경 페이지 — 마지막 페이지가 좌측으로 밀려나면
              이 흰 화면이 (카드와 함께) 우측에서 슬라이드 인 한다. 수평
              B/C 드래그 시에는 카드와 1:1로 함께 이동해, 아래에 마운트된
              이전 페이지/완료 화면이 정확히 드러나도록 한다. 수직 카드
              전환(위/아래 스와이프) 중에는 제자리에 머문다. */}
          <Animated.View
            style={[s.whiteSheet, stackDragStyle]}
            pointerEvents="none"
          />

          {animating && outSnap !== null && incoming !== null ? (
            /* ══════════════════════════════════════════════════════════
             * 슬라이드 전환 애니메이션 (수직 카드 전환만)
             * 수평 B/C 커밋은 outSnap/incoming을 설정하지 않으므로
             * 이 조건이 false가 되어 정적 카드 렌더가 유지된다.
             * forward: 나가는 카드 위에(z11), 들어오는 카드 아래(z9)
             * back:    동일 z 순서로 나가는 카드가 아래, 들어오는 카드가 위
             * ══════════════════════════════════════════════════════════ */
            <>
              {/* 들어오는 카드 (아래에서 올라옴) */}
              <Animated.View style={[cardBaseStyle, animInStyle, { zIndex: animDir === "forward" ? 9 : 11 }]}>
                <View style={s.cardInner}>
                  <Text style={s.questionText} numberOfLines={6}>
                    {incoming?.q ?? ""}
                  </Text>
                  {animDir === "back" && incoming?.ans ? (
                    <Text style={s.answerText} numberOfLines={12}>
                      {incoming.ans}
                    </Text>
                  ) : null}
                </View>
              </Animated.View>

              {/* 나가는 카드 (위로/아래로 밀려남) */}
              <Animated.View style={[cardBaseStyle, animOutStyle, { zIndex: animDir === "forward" ? 11 : 9 }]}>
                <View style={s.cardInner}>
                  <Text style={s.questionText} numberOfLines={6}>
                    {outSnap?.q ?? ""}
                  </Text>
                  {outSnap?.ans ? (
                    <Text style={s.answerText} numberOfLines={12}>
                      {outSnap.ans}
                    </Text>
                  ) : null}
                </View>
              </Animated.View>
            </>

          ) : (
            /* ══════════════════════════════════════════════════════════
             * 정적 카드 (드래그 피드백 + TextInput)
             * ══════════════════════════════════════════════════════════ */
            <Animated.View style={[cardBaseStyle, cardDragStyle]}>
              <View style={s.cardInner}>
                <Text style={s.questionText} numberOfLines={6}>
                  {currentQ}
                </Text>
                {/* 답변 스크롤 클립 컨테이너 */}
                <View
                  style={s.answerScrollClip}
                  onLayout={(ev) => {
                    availableHeightRef.current = ev.nativeEvent.layout.height;
                  }}
                >
                  <Animated.View style={answerScrollStyle}>
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
                      onContentSizeChange={(ev) => {
                        contentHeightRef.current = ev.nativeEvent.contentSize.height;
                      }}
                      placeholder="생각을 자유롭게 적어보세요..."
                      placeholderTextColor={Colors.zinc400}
                      multiline
                      scrollEnabled={false}
                      textAlignVertical="top"
                    />
                  </Animated.View>
                </View>
              </View>
            </Animated.View>
          )}

        </View>
      </GestureDetector>

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
  whiteSheet: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.white,
    zIndex: 0,
  },
  cardInner: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 28,
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
  answerText: {
    fontSize: 15,
    fontFamily: ReaderTokens.fontFamily.serif,
    color: Colors.zinc400,
    lineHeight: 28,
    letterSpacing: 0.5,
  },
  answerScrollClip: {
    flex: 1,
    overflow: "hidden",
  },
  answerInput: {
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
