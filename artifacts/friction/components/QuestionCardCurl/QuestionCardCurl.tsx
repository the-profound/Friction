/*
 * QuestionCardCurl — 질문 카드 덱 (연속 슬라이드 파이프라인)
 *
 * 설계:
 *   모든 카드는 하나의 연속 값 `pos`(카드 단위 float)로 배치된다.
 *   카드 idx의 화면 위치 = (idx - pos) * peekOffset (수직),
 *   중앙에서 멀수록 우측 peek 오프셋 적용 (수평).
 *
 *   드래그 → pos 를 직접 이동 (제스처 추종)
 *   릴리즈 → withTiming으로 목표 정수 pos까지 단조 이동 (오버슈트 없음)
 *   커밋   → cursor 상태만 갱신 (pos는 이미 목표값이므로 리셋 불필요 → 스냅 없음)
 *
 *   전환 전용 렌더 트리가 따로 없다. 카드들은 항상 같은 트리에 마운트되어
 *   있으므로 텍스트/그림자/입력창이 사라지거나 깜빡이지 않는다.
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
  type SharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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
const THRESHOLD = 80;

/* peek 위치에서의 스케일 (0~1). 중앙(e=0)=1, peek(|e|≥1)=PEEK_SCALE */
const PEEK_SCALE = 0.88;

/* ─── 인접 카드 peek 레이아웃 ──────────────────────────────────────── */
// 슬롯 경계로부터 adjacent 카드를 얼마나 떨어뜨려 주차할지.
const CARD_GAP = 80;

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
 * DeckCard — pos 값 하나로 배치되는 개별 카드
 * ════════════════════════════════════════════════════════════════════════ */
interface DeckCardProps {
  idx: number;
  pos: SharedValue<number>;
  peekOffset: number;
  peekRightOffset: number;
  cardBaseStyle: object;
  children: React.ReactNode;
}

function DeckCard({ idx, pos, peekOffset, peekRightOffset, cardBaseStyle, children }: DeckCardProps) {
  const posStyle = useAnimatedStyle(() => {
    const e = idx - pos.value; // 중앙(0) 기준 상대 슬롯 (연속값)
    // |e|=0 → scale 1.0, |e|≥1 → PEEK_SCALE. 드래그 중 연속 보간.
    const dist = Math.min(1, Math.abs(e));
    const scale = 1 - (1 - PEEK_SCALE) * dist;
    return {
      transform: [
        { translateX: peekRightOffset * dist },
        { translateY: e * peekOffset },
        { scale },
      ],
    };
  });
  return (
    <Animated.View style={[cardBaseStyle, posStyle]}>
      {children}
    </Animated.View>
  );
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
  const questionCount = activeQuestions.length;
  const questionCountRef = useRef(questionCount);
  questionCountRef.current = questionCount;

  /* ── 카드 레이아웃 ─────────────────────────────────────────────────── */
  // 정사각형 카드: width === height
  const cardSmallW = screenWidth;
  const cardSmallH = screenWidth;
  // peek 카드를 중앙 기준 우측으로 치우쳐 배치 (화면 우측에 걸쳐 있는 효과)
  const PEEK_RIGHT_OFFSET = 0;
  // 인접 카드 수직 오프셋 — 슬롯 바깥 CARD_GAP만큼 주차
  const peekOffset = cardSmallH + CARD_GAP;

  /* ── 덱 상태 ─────────────────────────────────────────────────────────
   * answers: 질문 인덱스별 답변 텍스트. cursor: 현재 중앙 카드 인덱스. */
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [cursor, setCursor] = useState(0);

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const cursorRef = useRef(0);
  const animatingRef = useRef(false);

  /* ── 스크롤 추적 refs ────────────────────────────────────────────────── */
  const contentHeightRef = useRef(0);
  const availableHeightRef = useRef(0);
  const scrollStartRef = useRef(0);
  const gestureScrolledRef = useRef(false);
  const gestureHandledRef = useRef(false);
  const dragAxisRef = useRef<"horizontal" | "vertical" | null>(null);

  /* ── Shared values ──────────────────────────────────────────────────
   * pos: 덱 전체 배치의 단일 소스 (카드 단위 float).
   * scrollOffsetSV: 키보드 열림 상태에서 답변 영역 스크롤.               */
  const pos = useSharedValue(0);
  const scrollOffsetSV = useSharedValue(0);

  const answerScrollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scrollOffsetSV.value }],
  }));

  /* ── 커밋 (JS 스레드 전용) ──────────────────────────────────────────
   * pos는 이미 목표 정수값에 도달해 있으므로 리셋하지 않는다. cursor 상태만
   * 갱신하면 렌더 윈도우가 이동하고, 화면상 아무것도 튀지 않는다.        */
  const commitMove = useCallback((next: number) => {
    cursorRef.current = next;
    setCursor(next);
    scrollOffsetSV.value = 0;
    animatingRef.current = false;
  }, [scrollOffsetSV]);

  /* ── 정착 애니메이션 ───────────────────────────────────────────────── */
  const settleTo = useCallback((delta: -1 | 0 | 1) => {
    const target = cursorRef.current + delta;
    if (delta === 0) {
      /* 취소: 현재 카드로 스프링 복귀 */
      pos.value = withSpring(cursorRef.current, { damping: 30, stiffness: 250 });
      return;
    }
    animatingRef.current = true;
    pos.value = withTiming(target, {
      duration: SLIDE_DURATION,
      easing: SLIDE_EASING,
    }, (finished) => {
      /* 취소되더라도 커밋은 반드시 실행 (finished 게이트 금지) */
      runOnJS(commitMove)(target);
    });
  }, [pos, commitMove]);

  const settleToRef = useRef(settleTo);
  settleToRef.current = settleTo;

  /* ── imperative handle ─────────────────────────────────────────────── */
  useImperativeHandle(ref, () => ({
    getAnsweredCards: () => {
      const _questions = activeQuestionsRef.current;
      const _answers = answersRef.current;
      const cards: AnsweredQuestionCard[] = [];
      for (let i = 0; i < _questions.length; i++) {
        const ans = _answers[i] ?? "";
        if (ans.trim().length > 0) {
          cards.push({ question: _questions[i] ?? "", answer: ans });
        }
      }
      return cards;
    },
  }), []);

  /* ── Tap gesture ──────────────────────────────────────────────────────
   * 1) 키보드 열림 상태: 어디든 탭하면 키보드 dismiss
   * 2) 중앙 카드 위쪽 peek 영역 탭: 이전 카드로 슬라이드 (settleTo(-1))
   * 3) 중앙 카드 아래쪽 peek 영역 탭: 다음 카드로 슬라이드 (settleTo(1))  */
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((e) => {
          if (animatingRef.current) return;
          if (keyboardVisibleRef.current) {
            Keyboard.dismiss();
            return;
          }
          // 중앙 카드가 차지하는 수직 범위
          const centerY = screenHeight / 2;
          const halfCard = cardSmallH / 2;
          if (e.y < centerY - halfCard && cursorRef.current > 0) {
            settleToRef.current(-1);
          } else if (e.y > centerY + halfCard && cursorRef.current < questionCountRef.current - 1) {
            settleToRef.current(1);
          }
        }),
    [keyboardVisibleRef, screenHeight, cardSmallH],
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

          /* ── 드래그 → pos 이동 (damping 적용) ─────────────────────── */
          const applyDrag = (dyv: number) => {
            let damped: number;
            if (dyv < 0) {
              damped = dyv * 0.10;
            } else {
              const restTy = cardSmallH + 60;
              const canBack = cursorRef.current > 0;
              damped = canBack
                ? dyv * 0.12
                : Math.min(dyv * 0.22, restTy * 0.28);
            }
            pos.value = cursorRef.current - damped / peekOffset;
          };

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
                applyDrag(dy);
              }
            } else if (dy > 0) {
              if (!atTop) {
                gestureScrolledRef.current = true;
                scrollOffsetSV.value = Math.min(0, scrollStartRef.current + dy);
              } else {
                gestureScrolledRef.current = false;
                applyDrag(dy);
              }
            }
          } else {
            applyDrag(dy);
          }
        })
        .onEnd((e) => {
          gestureHandledRef.current = true;
          if (animatingRef.current) return;
          const dy = e.translationY;

          /* ── 키보드 열린 상태 ────────────────────────────────────── */
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
            settleToRef.current(0);
          } else if (dy < -THRESHOLD && cursorRef.current < questionCountRef.current - 1) {
            settleToRef.current(1);
          } else if (dy > THRESHOLD && cursorRef.current > 0) {
            settleToRef.current(-1);
          } else {
            settleToRef.current(0);
          }
        })
        .onFinalize(() => {
          if (gestureHandledRef.current) return;
          if (animatingRef.current) return;
          settleToRef.current(0);
        }),
    [cardSmallH, peekOffset, pos, scrollOffsetSV, keyboardVisibleRef],
  );

  /* ── 카드 공통 스타일 ─────────────────────────────────────────────── */
  const cardBase = useMemo(
    () => ({
      position: "absolute" as const,
      top: "50%" as unknown as number,
      left: 0,
      width: cardSmallW,
      height: cardSmallH,
      marginTop: -(cardSmallH / 2),
      borderRadius: 0,
      backgroundColor: Colors.white,
      ...Platform.select({
        web: {
          boxShadow:
            "0 6px 44px rgba(0,0,0,0.18), 0 1px 8px rgba(0,0,0,0.1)",
        } as object,
        default: {
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 5,
        },
      }),
    }),
    [cardSmallH, cardSmallW],
  );

  /* ── 렌더 윈도우: cursor ±2 (존재하는 카드만) ───────────────────────── */
  const windowIndices = useMemo(() => {
    const lo = Math.max(0, cursor - 2);
    const hi = Math.min(questionCount - 1, cursor + 2);
    const arr: number[] = [];
    for (let i = lo; i <= hi; i++) arr.push(i);
    return arr;
  }, [cursor, questionCount]);

  /* ─────────────────────────────────────────────────────────────────────
   * Render — 모든 카드는 동일한 구조로 항상 마운트 (전환 트리 교체 없음)
   * ───────────────────────────────────────────────────────────────────── */
  return (
    <View style={s.root}>
      <GestureDetector gesture={Gesture.Simultaneous(tapGesture, panGesture)}>
        <View style={s.gestureLayer}>
          {windowIndices.map((idx) => {
            const isActive = idx === cursor;
            return (
              <DeckCard
                key={idx}
                idx={idx}
                pos={pos}
                peekOffset={peekOffset}
                peekRightOffset={PEEK_RIGHT_OFFSET}
                cardBaseStyle={cardBase}
              >
                <View style={s.cardInner}>
                  <Text style={s.questionText} numberOfLines={6}>
                    {activeQuestions[idx] ?? ""}
                  </Text>
                  {/* 답변 스크롤 클립 컨테이너 */}
                  <View
                    style={s.answerScrollClip}
                    onLayout={isActive ? (ev) => {
                      availableHeightRef.current = ev.nativeEvent.layout.height;
                    } : undefined}
                  >
                    <Animated.View style={isActive ? answerScrollStyle : undefined}>
                      <TextInput
                        style={s.answerInput}
                        value={answers[idx] ?? ""}
                        editable={isActive}
                        onChangeText={isActive ? (v) => {
                          setAnswers((prev) => {
                            const next = { ...prev, [idx]: v };
                            answersRef.current = next;
                            return next;
                          });
                        } : undefined}
                        onContentSizeChange={isActive ? (ev) => {
                          contentHeightRef.current = ev.nativeEvent.contentSize.height;
                        } : undefined}
                        placeholder="생각을 자유롭게 적어보세요..."
                        placeholderTextColor={Colors.zinc400}
                        multiline
                        scrollEnabled={false}
                        textAlignVertical="top"
                      />
                    </Animated.View>
                  </View>
                </View>
              </DeckCard>
            );
          })}
        </View>
      </GestureDetector>
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
