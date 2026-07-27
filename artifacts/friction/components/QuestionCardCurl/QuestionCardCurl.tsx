/*
 * QuestionCardCurl — 질문 카드 컴포넌트
 *
 * 수직 스와이프만 처리 (질문 간 전환):
 *   위로 스와이프 → 현재 카드 우상단 슬라이드 아웃 + 다음 카드 아래서 인
 *   아래로 스와이프 → 현재 카드 아래 슬라이드 아웃 + 이전 카드 아래서 인
 *
 * 수평 스와이프는 부모(read.tsx)의 단일 panGesture가 처리한다.
 * failOffsetX([-8,8])로 수평 제스처는 자동으로 부모에 위임한다.
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

/* ─── Props ──────────────────────────────────────────────────────────── */
export interface QuestionCardCurlProps {
  /** 읽기 페이지 프레임 크기 */
  containerWidth: number;
  containerHeight: number;
  /** 이 글에 대한 질문 카드 질문 목록 */
  questions?: string[];
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
  containerWidth: screenWidth,
  containerHeight: screenHeight,
  questions,
  keyboardVisibleRef,
}: QuestionCardCurlProps, ref: React.ForwardedRef<QuestionCardCurlHandle>) {
  /* 3~5개 가변 질문 목록: prop이 비어있거나 없으면 고정 3개 질문으로 대체 */
  const activeQuestions = questions && questions.length > 0 ? questions : FALLBACK_QUESTIONS;
  const activeQuestionsRef = useRef(activeQuestions);
  activeQuestionsRef.current = activeQuestions;

  /* ── 카드 레이아웃: 편지 페이지와 동일한 너비, 높이 = 너비 × 6/5 ─── */
  const cardSmallW = screenWidth;
  const cardSmallH = Math.round(cardSmallW * 6 / 5);
  const cardSmallLeft = 0;

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
  const dragAxisRef = useRef<"horizontal" | "vertical" | null>(null);
  const gestureHandledRef = useRef(false);

  /* ── 슬라이드 전환용 shared values ─────────────────────────────────── */
  const animOutX = useSharedValue(0);
  const animOutY = useSharedValue(0);
  const animInY = useSharedValue(0);

  const cardDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cardTY.value }],
  }));
  const answerScrollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scrollOffsetSV.value }],
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
    scrollOffsetSV.value = 0;
    animOutX.value = 0;
    animOutY.value = 0;
    animInY.value = 0;
  }, [cardTY, scrollOffsetSV, animOutX, animOutY, animInY]);

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
      animOutX.value = 0;
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
    [animOutX, animOutY, animInY, cardTY, screenWidth, screenHeight],
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
    animOutX.value = 0;
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
  }, [animOutX, animOutY, animInY, cardTY, screenHeight]);

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

  /* ── Tap gesture: 키보드 열린 상태에서 카드 영역 탭 → 키보드 dismiss ── */
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd(() => {
          if (keyboardVisibleRef.current) {
            Keyboard.dismiss();
          }
        }),
    [keyboardVisibleRef],
  );

  /* ── Pan gesture (수직 전용) ──────────────────────────────────────────
   * failOffsetX([-8, 8]): 수평 이동이 8px를 먼저 넘으면 이 제스처가 FAIL되어
   * 부모(read.tsx)의 panGesture가 수평 페이지 전환을 온전히 처리한다.
   * activeOffsetY([-8, 8]): 수직 이동이 8px를 넘어야 ACTIVE가 된다.         */
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .failOffsetX([-8, 8])
        .activeOffsetY([-8, 8])
        .onBegin(() => {
          dragAxisRef.current = null;
          gestureScrolledRef.current = false;
          gestureHandledRef.current = false;
          scrollStartRef.current = scrollOffsetSV.value;
        })
        .onUpdate((e) => {
          if (animatingRef.current) return;
          const dy = e.translationY;

          const overflowH = Math.max(0, contentHeightRef.current - availableHeightRef.current);

          /* ── 키보드 열린 상태 ──────────────────────────────────────────
           * 아래→위 + 오버플로 있음: 스크롤 오프셋 업데이트.              */
          if (keyboardVisibleRef.current) {
            if (dy < 0 && overflowH > 0) {
              const liveOffset = scrollOffsetSV.value;
              if (liveOffset > -overflowH) {
                gestureScrolledRef.current = true;
                scrollOffsetSV.value = Math.max(-overflowH, scrollStartRef.current + dy);
              }
            }
            return;
          }

          /* ── 키보드 꺼진 상태 ─────────────────────────────────────── */
          if (overflowH > 0) {
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
          const dy = e.translationY;
          const THRESHOLD = 80;

          const overflowH = Math.max(0, contentHeightRef.current - availableHeightRef.current);

          /* ── 키보드 열린 상태 ──────────────────────────────────────────
           * 아래→위 스크롤이었으면: withSpring으로 오프셋 정착.           */
          if (keyboardVisibleRef.current) {
            if (dy > 0) {
              Keyboard.dismiss();
            } else if (gestureScrolledRef.current) {
              scrollOffsetSV.value = withSpring(scrollOffsetSV.value, { damping: 20, stiffness: 300 });
            }
            return;
          }

          /* ── 키보드 꺼진 상태 ─────────────────────────────────────── */
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
            }
          }
        })
        .onFinalize(() => {
          if (gestureHandledRef.current) return;
          if (animatingRef.current) return;
          cardTY.value = withSpring(0, { damping: 12, stiffness: 180 });
        }),
    [cardSmallH, scrollOffsetSV, keyboardVisibleRef, cardTY],
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
    <View style={s.root}>
      <GestureDetector gesture={Gesture.Simultaneous(tapGesture, panGesture)}>
        <View style={s.gestureLayer}>

          {animating && outSnap !== null && incoming !== null ? (
            /* ══════════════════════════════════════════════════════════
             * 슬라이드 전환 애니메이션 (수직 카드 전환)
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
    </View>
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
  },
  gestureLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
