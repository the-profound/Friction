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
  StyleSheet,
  Platform,
  Keyboard,
  useWindowDimensions,
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
  shadowStyle: object;
  children: React.ReactNode;
}

function DeckCard({ idx, pos, peekOffset, peekRightOffset, cardBaseStyle, shadowStyle, children }: DeckCardProps) {
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
  /* 그림자는 내용과 분리된 형제 레이어에 둔다.
   * 그림자가 걸린 레이어는 iOS에서 offscreen 합성 대상이 되는데, 이 버퍼가
   * "현재 화면상 크기"(peek 상태에서 0.88배) 기준으로 잡히기 때문에 같은
   * 레이어 안의 텍스트가 저해상도로 래스터화된다. 그림자를 빈 레이어로
   * 분리하면 텍스트 레이어는 offscreen 합성을 거치지 않아 축소 상태에서도
   * 원본 해상도로 렌더된다. (읽기 화면 편지 카드와 동일한 접근) */
  return (
    <Animated.View style={[cardBaseStyle, posStyle]}>
      <View style={shadowStyle} pointerEvents="none" />
      <View style={s.cardSurface}>{children}</View>
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

  /* ── Shared values ──────────────────────────────────────────────────
   * pos: 덱 전체 배치의 단일 소스 (카드 단위 float).
   * scrollOffsetSV: 키보드 열림 상태에서 답변 영역 스크롤.
   *
   * ⚠️ 상하 제스처는 UI 스레드(worklet)에서 실행된다. 따라서 제스처가 읽는
   *    모든 상태는 ref가 아니라 shared value여야 한다 — 워클릿에서 JS ref를
   *    읽으면 값이 캡처 시점에 고정되고, 쓰기는 조용히 무시된다.            */
  const pos = useSharedValue(0);
  const scrollOffsetSV = useSharedValue(0);
  const cursorSV = useSharedValue(0);
  const animatingSV = useSharedValue(0);
  const keyboardVisibleSV = useSharedValue(0);
  const contentHeightSV = useSharedValue(0);
  const availableHeightSV = useSharedValue(0);
  const scrollStartSV = useSharedValue(0);
  const gestureScrolledSV = useSharedValue(0);
  const gestureHandledSV = useSharedValue(0);

  /* 답변 영역 클립 마스크(overflow:"hidden")는 "실제로 스크롤 중일 때"에만 건다.
   * 마스크가 걸린 레이어는 iOS/Android에서 offscreen 합성 대상이 되는데,
   * 드래그로 카드 스케일이 연속 변하면 매 프레임 축소 크기 기준으로 다시
   * 래스터화되어 텍스트가 뭉개진다. 스크롤 오프셋이 0이면 클리핑할 내용이
   * 없으므로 마스크를 아예 떼어 원본 해상도를 유지한다. */
  const [maskActive, setMaskActive] = useState(false);
  const maskActiveSV = useSharedValue(0);
  const setMask = useCallback((on: boolean) => {
    setMaskActive(on);
  }, []);
  /* worklet — 마스크는 "활성 카드의 스크롤 오프셋이 0이 아닐 때"에만 유지한다.
   * 오프셋이 0으로 돌아오거나 경계에 닿아 덱 드래그로 전환되는 순간 즉시
   * 해제해야, 카드 축소 전환이 마스크 없는 상태에서 시작된다. */
  const setMaskState = useCallback((on: boolean) => {
    "worklet";
    const next = on ? 1 : 0;
    if (maskActiveSV.value !== next) {
      maskActiveSV.value = next;
      runOnJS(setMask)(on);
    }
  }, [maskActiveSV, setMask]);

  /* ── 키보드 회피 ────────────────────────────────────────────────────
   * 질문 카드 단계에서는 리더 프레임 전체를 축소하지 않는다(읽기 본문 단계의
   * 단상 시트 축소와 분리). 대신 덱 전체를 키보드 높이만큼 위로 이동시켜
   * 활성 카드와 입력 텍스트가 가려지지 않게 한다.                        */
  const { height: windowHeight } = useWindowDimensions();
  const kbOffsetSV = useSharedValue(0);
  const deckOffsetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: kbOffsetSV.value }],
  }));

  /* 덱 컨테이너(= 리더 프레임)의 윈도우 절대 좌표. 프레임은 안전영역/레터박스
   * 때문에 화면 중앙과 일치하지 않으므로 화면 크기로 추정하지 않고 실측한다. */
  const rootRef = useRef<View>(null);
  const deckBoundsRef = useRef<{ top: number; height: number } | null>(null);
  const measureDeck = useCallback(() => {
    rootRef.current?.measureInWindow((_x, y, _w, h) => {
      if (typeof y === "number" && !Number.isNaN(y) && h > 0) {
        deckBoundsRef.current = { top: y, height: h };
      }
    });
  }, []);

  // Worklet 클로저에 `Keyboard`(KeyboardImpl) 객체가 캡처되면 Reanimated가
  // UI 스레드로 직렬화할 때 "Cannot copy value of type KeyboardImpl" 오류가
  // 발생한다. JS 스레드 전용 래퍼를 정의해 runOnJS에 이 함수만 넘긴다.
  const kbDismiss = useCallback(() => { Keyboard.dismiss(); }, []);

  const applyKeyboardOffset = useCallback((keyboardTop: number) => {
    const timing = { duration: 260, easing: Easing.out(Easing.cubic) };
    const bounds = deckBoundsRef.current;
    if (!bounds) {
      kbOffsetSV.value = withTiming(0, timing);
      return;
    }
    // 활성 카드는 덱(프레임) 중앙에 배치된다 → 윈도우 좌표 기준 카드 상·하단.
    const deckCenterY = bounds.top + bounds.height / 2;
    const cardTop = deckCenterY - cardSmallH / 2;
    const cardBottom = deckCenterY + cardSmallH / 2;
    // 필요한 만큼만, 위로만 이동 (키보드 위 12px 여백).
    let shift = Math.min(0, keyboardTop - 12 - cardBottom);
    // 카드 상단이 화면 위로 잘려나가지 않도록 클램프.
    shift = Math.max(shift, -Math.max(0, cardTop - 8));
    kbOffsetSV.value = withTiming(shift, timing);
  }, [cardSmallH, kbOffsetSV]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (e) => {
      keyboardVisibleSV.value = 1;
      /* 키보드 상단의 "윈도우 좌표" — measureInWindow와 같은 좌표계여야 한다.
       *  iOS: 윈도우 == 화면이므로 endCoordinates.screenY가 곧 키보드 상단.
       *  Android: app.json의 softwareKeyboardLayoutMode="resize"로 윈도우 자체가
       *           줄어들기 때문에 키보드 상단은 (줄어든) 윈도우 하단과 같다.
       *           screenY나 windowHeight-height를 쓰면 이중으로 빼게 된다. */
      const keyboardTop = Platform.OS === "android"
        ? windowHeight
        : (e.endCoordinates?.screenY ?? windowHeight - (e.endCoordinates?.height ?? 0));
      // 최신 위치로 재측정한 뒤(콜백에서) 오프셋을 적용한다.
      rootRef.current?.measureInWindow((_x, y, _w, h) => {
        if (typeof y === "number" && !Number.isNaN(y) && h > 0) {
          deckBoundsRef.current = { top: y, height: h };
        }
        applyKeyboardOffset(keyboardTop);
      });
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardVisibleSV.value = 0;
      kbOffsetSV.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
    });

    return () => { showSub.remove(); hideSub.remove(); };
  }, [applyKeyboardOffset, kbOffsetSV, keyboardVisibleSV, windowHeight]);

  const answerScrollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scrollOffsetSV.value }],
  }));

  /* ── 커밋 (JS 스레드 전용) ──────────────────────────────────────────
   * pos는 이미 목표 정수값에 도달해 있으므로 리셋하지 않는다. cursor 상태만
   * 갱신하면 렌더 윈도우가 이동하고, 화면상 아무것도 튀지 않는다.        */
  const commitMove = useCallback((next: number) => {
    cursorSV.value = next;
    setCursor(next);
    scrollOffsetSV.value = 0;
    maskActiveSV.value = 0;
    setMaskActive(false);
    animatingSV.value = 0;
  }, [scrollOffsetSV, cursorSV, animatingSV, maskActiveSV]);

  /* ── 정착 애니메이션 ─────────────────────────────────────────────────
   * worklet — UI 스레드(제스처)와 JS 스레드(탭) 양쪽에서 호출된다.        */
  const settleTo = useCallback((delta: -1 | 0 | 1) => {
    "worklet";
    const cur = cursorSV.value;
    if (delta === 0) {
      /* 취소: 현재 카드로 스프링 복귀 */
      pos.value = withSpring(cur, { damping: 30, stiffness: 250 });
      return;
    }
    const target = cur + delta;
    animatingSV.value = 1;
    pos.value = withTiming(target, {
      duration: SLIDE_DURATION,
      easing: SLIDE_EASING,
    }, () => {
      /* 취소되더라도 커밋은 반드시 실행 (finished 게이트 금지) */
      runOnJS(commitMove)(target);
    });
  }, [pos, commitMove, cursorSV, animatingSV]);

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
          if (animatingSV.value === 1) return;
          if (keyboardVisibleRef.current) {
            Keyboard.dismiss();
            return;
          }
          // 중앙 카드가 차지하는 수직 범위
          const centerY = screenHeight / 2;
          const halfCard = cardSmallH / 2;
          const cur = cursorSV.value;
          if (e.y < centerY - halfCard && cur > 0) {
            settleToRef.current(-1);
          } else if (e.y > centerY + halfCard && cur < questionCountRef.current - 1) {
            settleToRef.current(1);
          }
        }),
    [keyboardVisibleRef, screenHeight, cardSmallH, animatingSV, cursorSV],
  );

  /* ── Pan gesture (수직 전용) ──────────────────────────────────────────
   * failOffsetX([-8, 8]): 수평 이동이 8px를 먼저 넘으면 이 제스처가 FAIL되어
   * 부모(read.tsx)의 panGesture가 수평 페이지 전환을 온전히 처리한다.
   * activeOffsetY([-8, 8]): 수직 이동이 8px를 넘어야 ACTIVE가 된다.         */
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        /* runOnJS(true) 제거 — 제스처 전체가 UI 스레드에서 실행되어야 손가락을
         * 프레임 드랍 없이 따라간다. JS가 필요한 작업(키보드 닫기, cursor 커밋)만
         * runOnJS로 넘긴다. */
        .failOffsetX([-8, 8])
        .activeOffsetY([-8, 8])
        .onBegin(() => {
          "worklet";
          gestureScrolledSV.value = 0;
          gestureHandledSV.value = 0;
          scrollStartSV.value = scrollOffsetSV.value;
        })
        .onUpdate((e) => {
          "worklet";
          if (animatingSV.value === 1) return;
          const dy = e.translationY;

          const overflowH = Math.max(0, contentHeightSV.value - availableHeightSV.value);

          const markScrolled = () => {
            "worklet";
            gestureScrolledSV.value = 1;
          };

          /* ── 키보드 열린 상태 ──────────────────────────────────────────
           * 아래→위 + 오버플로 있음: 스크롤 오프셋 업데이트.              */
          if (keyboardVisibleSV.value === 1) {
            if (dy < 0 && overflowH > 0) {
              const liveOffset = scrollOffsetSV.value;
              if (liveOffset > -overflowH) {
                markScrolled();
                scrollOffsetSV.value = Math.max(-overflowH, scrollStartSV.value + dy);
                setMaskState(scrollOffsetSV.value !== 0);
              }
            }
            return;
          }

          /* ── 드래그 → pos 이동 (damping 적용) ─────────────────────── */
          const applyDrag = (dyv: number) => {
            "worklet";
            let damped: number;
            if (dyv < 0) {
              damped = dyv * 0.10;
            } else {
              const restTy = cardSmallH + 60;
              const canBack = cursorSV.value > 0;
              damped = canBack
                ? dyv * 0.12
                : Math.min(dyv * 0.22, restTy * 0.28);
            }
            pos.value = cursorSV.value - damped / peekOffset;
          };

          /* ── 키보드 꺼진 상태 ─────────────────────────────────────── */
          if (overflowH > 0) {
            const liveOffset = scrollOffsetSV.value;
            const atBottom = liveOffset <= -overflowH;
            const atTop = liveOffset >= 0;

            if (dy < 0) {
              if (!atBottom) {
                markScrolled();
                scrollOffsetSV.value = Math.max(-overflowH, scrollStartSV.value + dy);
                setMaskState(scrollOffsetSV.value !== 0);
              } else {
                gestureScrolledSV.value = 0;
                setMaskState(false);
                applyDrag(dy);
              }
            } else if (dy > 0) {
              if (!atTop) {
                markScrolled();
                scrollOffsetSV.value = Math.min(0, scrollStartSV.value + dy);
                setMaskState(scrollOffsetSV.value !== 0);
              } else {
                gestureScrolledSV.value = 0;
                setMaskState(false);
                applyDrag(dy);
              }
            }
          } else {
            /* 오버플로가 없으면 클리핑할 내용도 없다 — 마스크 해제 */
            setMaskState(false);
            applyDrag(dy);
          }
        })
        .onEnd((e) => {
          "worklet";
          gestureHandledSV.value = 1;
          if (animatingSV.value === 1) return;
          const dy = e.translationY;

          /* ── 키보드 열린 상태 ────────────────────────────────────── */
          if (keyboardVisibleSV.value === 1) {
            if (dy > 0) {
              runOnJS(kbDismiss)();
            } else if (gestureScrolledSV.value === 1) {
              scrollOffsetSV.value = withSpring(scrollOffsetSV.value, { damping: 20, stiffness: 300 });
            }
            setMaskState(scrollOffsetSV.value !== 0);
            return;
          }

          /* ── 키보드 꺼진 상태 ─────────────────────────────────────── */
          if (gestureScrolledSV.value === 1) {
            scrollOffsetSV.value = withSpring(scrollOffsetSV.value, { damping: 20, stiffness: 300 });
            setMaskState(scrollOffsetSV.value !== 0);
            settleTo(0);
          } else if (dy < -THRESHOLD && cursorSV.value < questionCount - 1) {
            settleTo(1);
          } else if (dy > THRESHOLD && cursorSV.value > 0) {
            settleTo(-1);
          } else {
            settleTo(0);
          }
        })
        .onFinalize(() => {
          "worklet";
          if (gestureHandledSV.value === 1) return;
          if (animatingSV.value === 1) return;
          settleTo(0);
        }),
    [
      cardSmallH,
      peekOffset,
      pos,
      scrollOffsetSV,
      cursorSV,
      animatingSV,
      keyboardVisibleSV,
      contentHeightSV,
      availableHeightSV,
      scrollStartSV,
      gestureScrolledSV,
      gestureHandledSV,
      maskActiveSV,
      setMaskState,
      settleTo,
      questionCount,
      kbDismiss,
    ],
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
      // 배경/그림자는 아래 cardShadow(빈 형제 레이어)가 담당한다 —
      // 텍스트가 든 레이어에 그림자를 걸면 축소 시 해상도가 깨진다.
      backgroundColor: "transparent",
    }),
    [cardSmallH, cardSmallW],
  );

  /* 그림자 전용 레이어 — 자식이 없으므로 offscreen 합성 비용이 낮고,
   * 텍스트 해상도에 영향을 주지 않는다. */
  const cardShadow = useMemo(
    () => ({
      position: "absolute" as const,
      top: 0,
      left: 0,
      width: cardSmallW,
      height: cardSmallH,
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
    <View ref={rootRef} style={s.root} onLayout={measureDeck} collapsable={false}>
      <GestureDetector gesture={Gesture.Simultaneous(tapGesture, panGesture)}>
        <Animated.View style={[s.gestureLayer, deckOffsetStyle]}>
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
                shadowStyle={cardShadow}
              >
                <View style={s.cardInner}>
                  <Text style={s.questionText} numberOfLines={6}>
                    {activeQuestions[idx] ?? ""}
                  </Text>
                  {/* 답변 스크롤 클립 컨테이너 */}
                  {/* 답변 스크롤 클립 컨테이너 — overflow:"hidden"(레이어 마스크)은
                      스크롤 오프셋이 실제로 적용되는 중앙 카드에만 건다. 축소된
                      peek 카드에 마스크가 걸리면 iOS가 축소된 크기 기준으로
                      offscreen 합성해 답변/플레이스홀더 텍스트가 흐려진다.
                      peek 카드는 TextInput 자체 높이 제한으로 클리핑된다. */}
                  <View
                    style={isActive && maskActive ? s.answerScrollClip : s.answerScrollPlain}
                    onLayout={isActive ? (ev) => {
                      availableHeightSV.value = ev.nativeEvent.layout.height;
                    } : undefined}
                  >
                    <Animated.View style={isActive ? answerScrollStyle : s.answerFill}>
                      <TextInput
                        style={isActive ? s.answerInput : [s.answerInput, s.answerFill]}
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
                          contentHeightSV.value = ev.nativeEvent.contentSize.height;
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
        </Animated.View>
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
  cardSurface: {
    flex: 1,
    backgroundColor: Colors.white,
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
  answerScrollPlain: {
    flex: 1,
  },
  answerFill: {
    height: "100%",
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
