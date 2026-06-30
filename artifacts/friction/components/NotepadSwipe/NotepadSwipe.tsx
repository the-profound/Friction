/*
 * NotepadSwipe — 3D 노트패드 스와이프 컴포넌트
 *
 * 제스처별 동작:
 *  ① 빈 카드 + 위 스와이프   → Rip-out  (찢어내기: 회전+스큐+fadeOut → 새 종이 아래서 spring 등장)
 *  ② 내용 있는 카드 + 위 스와이프 → Page Flip (3D rotateX 2-phase → 다음 카드)
 *  ③ 아래 스와이프 (이전 카드 존재) → Pull-down (이전 카드가 위에서 spring으로 내려옴)
 *
 * 의존성: react-native-reanimated ~4.x, react-native-gesture-handler ~2.x
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Platform,
  useWindowDimensions,
  Text,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Colors } from "@/constants/tokens";

/* ─── 디자인 토큰 ──────────────────────────────────────────── */
const PAPER_BG   = "#fffef7";
const PAPER_LINE = "rgba(147,197,253,0.35)";
const LINE_GAP   = 28;
const COIL_CLR   = "#94a3b8";
const COIL_W     = 13;
const COIL_PAD   = 22;
const SERIF      = Platform.select({ ios: "Georgia", android: "serif", default: "Georgia, serif" }) as string;

/* ─── 애니메이션 상수 ───────────────────────────────────────── */
const THRESHOLD      = 70;   // 제스처 확정 임계값 (px)
const PERSPECTIVE    = 900;  // 3D 원근거리
const RIP_DUR        = 400;  // rip-out 퇴장 (ms)
const FLIP_EXIT_DUR  = 220;  // page-flip 전반
const FLIP_ENTER_DUR = 300;  // page-flip 후반
const SPRING_OPT     = { damping: 15, stiffness: 110, mass: 1.1 } as const;

/* ─── 타입 ────────────────────────────────────────────────── */
interface NoteCard { id: number; text: string }

export interface NotepadSwipeProps {
  onSave?: (text: string, savedCount: number) => void;
}

/* ─── 스프링 코일 장식 ─────────────────────────────────────── */
function SpringCoil({ width }: { width: number }) {
  const usable = width - COIL_PAD * 2;
  const count  = Math.max(4, Math.floor(usable / (COIL_W + 10)));
  const gap    = (usable - count * COIL_W) / (count - 1);
  return (
    <View style={s.coilContainer}>
      <View style={[s.coilWire, { left: COIL_PAD, right: COIL_PAD }]} />
      <View style={[s.coilRings, { paddingHorizontal: COIL_PAD, gap }]}>
        {Array.from({ length: count }).map((_, i) => (
          <View key={i} style={[s.ring, { width: COIL_W, height: 22, borderRadius: COIL_W / 2 }]} />
        ))}
      </View>
    </View>
  );
}

/* ─── 괘선 ───────────────────────────────────────────────── */
function PaperLines({ height }: { height: number }) {
  const count = Math.floor((height - 58) / LINE_GAP);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[s.line, { top: 58 + i * LINE_GAP }]} />
      ))}
    </View>
  );
}

/* ─── 카드 앞면 (비-애니메이션) ────────────────────────────── */
interface CardFaceProps {
  width: number; height: number;
  text: string; placeholder?: string;
  editable?: boolean;
  onChangeText?: (v: string) => void;
}
function CardFace({ width, height, text, placeholder = "", editable = false, onChangeText }: CardFaceProps) {
  return (
    <View style={[s.cardFront, { width, height }]}>
      <SpringCoil width={width} />
      <PaperLines height={height} />
      <TextInput
        style={[s.input, { fontFamily: SERIF }]}
        value={text}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.zinc300}
        multiline
        editable={editable}
        scrollEnabled={false}
        textAlignVertical="top"
      />
    </View>
  );
}

/* ════════════════════════════════════════════════════════════
 * 메인 컴포넌트
 * ════════════════════════════════════════════════════════════ */
export default function NotepadSwipe({ onSave }: NotepadSwipeProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const CARD_W  = screenW - 48;
  const CARD_H  = Math.round(CARD_W * 1.38);
  const REST_TY = CARD_H + 100; // 화면 아래 주차 위치

  /* ── JS 상태 ─────────────────────────────────────────── */
  const [cards, setCards]       = useState<NoteCard[]>([]);
  const [ptr, setPtr]           = useState(0); // cards.length == 새 카드 슬롯
  const [editText, setEditText] = useState("");
  const [inText, setInText]     = useState(""); // 들어오는 카드 내용
  const [animating, setAnimating] = useState(false);
  const [inAbove, setInAbove]   = useState(false); // pull-down: 위에서 내려오는지

  /* ── Refs (제스처 핸들러 & setTimeout 에서 stale closure 방지) ── */
  const animRef   = useRef(false);
  const ptrRef    = useRef(0);
  const cardsRef  = useRef<NoteCard[]>([]);
  const editRef   = useRef("");
  const idRef     = useRef(0);
  const seqRef    = useRef(0); // rip-out 새 질문 순환용

  /* 상태 → ref 동기화 */
  const syncRef = <T,>(ref: React.MutableRefObject<T>, val: T) => {
    ref.current = val;
  };

  /* ── Shared Values ───────────────────────────────────────
   * 현재 카드: ty, rotZ(찢기), rotX(flip), alpha, scaleX(skew 대용)
   * 들어오는 카드: inTy, inRotX, inAlpha
   * ─────────────────────────────────────────────────────── */
  const ty      = useSharedValue(0);
  const rotZ    = useSharedValue(0);
  const rotX    = useSharedValue(0);
  const alpha   = useSharedValue(1);
  const scaleX  = useSharedValue(1);
  const inTy    = useSharedValue(0);
  const inRotX  = useSharedValue(0);
  const inAlpha = useSharedValue(0);

  /* ── 애니메이션 스타일: 현재 카드 ─────────────────────── */
  const curStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: PERSPECTIVE },
      { translateY: ty.value },
      { rotateZ: `${rotZ.value}deg` },
      { rotateX: `${rotX.value}deg` },
      { scaleX: scaleX.value },
    ],
    opacity: alpha.value,
  }));

  /* ── 애니메이션 스타일: 들어오는 카드 ─────────────────── */
  const inStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: PERSPECTIVE },
      { translateY: inTy.value },
      { rotateX: `${inRotX.value}deg` },
    ],
    opacity: inAlpha.value,
  }));

  /* ── 동적 그림자 (드래그 중 카드가 들리는 느낌) ──────── */
  const shadowStyle = useAnimatedStyle(() => {
    const lift = Math.min(1, Math.abs(ty.value) / 100);
    return {
      shadowOpacity: 0.1 + lift * 0.2,
      shadowRadius:  8   + lift * 16,
      elevation:     5   + lift * 12,
    };
  });

  /* ── 공통 리셋 ──────────────────────────────────────────── */
  const afterAnim = useCallback(() => {
    animRef.current = false;
    setAnimating(false);
    inAlpha.value = 0;
    setInAbove(false);
  }, [inAlpha]);

  /* ════════════════════════════════════════════════════
   * ① Rip-out — 빈 카드 + 위 스와이프
   *    현재 카드: 위로 날아가며 회전(rotZ) + X-스케일 skew + fade-out
   *    새 카드:  REST_TY 아래에서 spring으로 올라옴
   * ════════════════════════════════════════════════════ */
  const triggerRipOut = useCallback(() => {
    const sign = Math.random() < 0.5 ? 1 : -1;
    const ease = Easing.in(Easing.cubic);

    /* 새 카드 미리 아래 주차 */
    inTy.value    = REST_TY;
    inAlpha.value = 1;
    inRotX.value  = 0;

    /* 현재 카드 퇴장 */
    ty.value     = withTiming(-screenH * 1.35, { duration: RIP_DUR, easing: ease });
    rotZ.value   = withTiming(sign * 15,       { duration: RIP_DUR, easing: ease });
    scaleX.value = withTiming(0.9,             { duration: RIP_DUR, easing: ease });
    alpha.value  = withTiming(0, { duration: Math.round(RIP_DUR * 0.7), easing: ease });

    /* 퇴장 중반부터 새 카드 spring 상승 */
    const springDelay = Math.round(RIP_DUR * 0.4);
    setTimeout(() => {
      inTy.value = withSpring(0, SPRING_OPT);
    }, springDelay);

    /* 완료: SV 초기화 + 상태 리셋 */
    setTimeout(() => {
      seqRef.current += 1;
      setEditText("");
      editRef.current = "";
      ty.value     = 0;
      rotZ.value   = 0;
      scaleX.value = 1;
      alpha.value  = 1;
      rotX.value   = 0;
      afterAnim();
    }, RIP_DUR + 300);
  }, [screenH, REST_TY, ty, rotZ, scaleX, alpha, rotX, inTy, inAlpha, inRotX, afterAnim]);

  /* ════════════════════════════════════════════════════
   * ② Page Flip — 내용 있는 카드 + 위 스와이프
   *    Phase A: 현재 카드 rotX 0 → -90 (edge-on, 비가시)
   *    Phase B: 상태 업데이트 후 rotX 90 → 0 (새 내용 펼쳐짐)
   *
   *    카드가 edge-on(-90°) 인 순간에 JS 상태를 업데이트하므로
   *    사용자는 콘텐츠 전환을 볼 수 없음.
   * ════════════════════════════════════════════════════ */
  const commitFlip = useCallback((
    nextPtr: number, nextCards: NoteCard[], nextEdit: string, nextInText: string,
  ) => {
    setPtr(nextPtr);      ptrRef.current    = nextPtr;
    setCards(nextCards);  cardsRef.current  = nextCards;
    setEditText(nextEdit); editRef.current  = nextEdit;
    setInText(nextInText);
  }, []);

  const triggerFlip = useCallback((
    nextPtr: number, nextCards: NoteCard[], nextEdit: string, nextInText: string,
  ) => {
    /* Phase A: 현재 카드 → edge-on */
    rotX.value = withTiming(-90, { duration: FLIP_EXIT_DUR, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (!finished) return;

        /*
         * UI 스레드 완료 콜백 → JS 스레드로 상태 업데이트 요청.
         * 카드가 -90° (edge-on, 비가시)이므로 콘텐츠 교체가 보이지 않음.
         */
        runOnJS(commitFlip)(nextPtr, nextCards, nextEdit, nextInText);

        /*
         * 순간 이동: -90° → +90° (반대편으로 점프, 여전히 edge-on = 비가시).
         * 이후 0° 로 펼쳐지면 새 콘텐츠가 앞면으로 등장.
         */
        rotX.value = 90;

        /* Phase B: 새 콘텐츠 등장 */
        rotX.value = withTiming(0, { duration: FLIP_ENTER_DUR, easing: Easing.out(Easing.cubic) },
          (done) => {
            if (done) runOnJS(afterAnim)();
          },
        );
      },
    );
  }, [rotX, commitFlip, afterAnim]);

  /* ════════════════════════════════════════════════════
   * ③ Pull-down — 아래 스와이프 (이전 카드 복원)
   *    이전 카드: 화면 위 -(CARD_H) 에서 spring + rotX tilt 보정
   *    현재 카드: 아래로 slide-out + fade
   * ════════════════════════════════════════════════════ */
  const commitPull = useCallback((prevPtr: number) => {
    setPtr(prevPtr);
    ptrRef.current = prevPtr;
  }, []);

  const triggerPullDown = useCallback((prevCard: NoteCard, prevPtr: number) => {
    setInText(prevCard.text);
    setInAbove(true);

    /* 이전 카드: 위에서 -18° 기울어진 채로 spring 하강 */
    inTy.value    = -(CARD_H + 80);
    inAlpha.value = 1;
    inRotX.value  = -18;

    inTy.value   = withSpring(0,  SPRING_OPT);
    inRotX.value = withSpring(0, { ...SPRING_OPT, damping: SPRING_OPT.damping + 4 });

    /* 현재 카드: 아래로 퇴장 */
    const ease = Easing.in(Easing.quad);
    ty.value    = withTiming(screenH,  { duration: 340, easing: ease });
    alpha.value = withTiming(0,        { duration: 220, easing: ease });

    setTimeout(() => {
      runOnJS(commitPull)(prevPtr);
      ty.value    = 0;
      alpha.value = 1;
      afterAnim();
    }, 500);
  }, [CARD_H, screenH, ty, alpha, inTy, inAlpha, inRotX, commitPull, afterAnim]);

  /* ════════════════════════════════════════════════════
   * Pan Gesture
   * ════════════════════════════════════════════════════ */
  const panGesture = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .onUpdate(({ translationY }) => {
        if (animRef.current) return;
        if (translationY < 0) {
          /* 위 drag: 살짝 따라가며 rotZ 비틀림 피드백 */
          ty.value   = translationY * 0.25;
          rotZ.value = translationY * 0.018;
        } else {
          /* 아래 drag: 이전 카드 없으면 rubber-band */
          const canBack = ptrRef.current > 0;
          ty.value   = translationY * (canBack ? 0.25 : 0.08);
          rotZ.value = translationY * 0.006;
        }
      })
      .onEnd(({ translationY, velocityY }) => {
        if (animRef.current) return;

        const _ptr   = ptrRef.current;
        const _cards = cardsRef.current;
        const _edit  = editRef.current;
        const isNew  = _ptr === _cards.length;

        /* 속도를 감안한 유효 이동거리 */
        const eff = translationY + velocityY * 0.1;

        /* ─── 위 스와이프 ─── */
        if (eff < -THRESHOLD) {
          animRef.current = true;
          setAnimating(true);

          const hasText = isNew
            ? _edit.trim().length > 0
            : (_cards[_ptr]?.text.trim().length ?? 0) > 0;

          if (isNew && !hasText) {
            /* ① Rip-out: 빈 새 카드 */
            triggerRipOut();

          } else if (isNew && hasText) {
            /* ② Page Flip: 새 카드 저장 후 다음 빈 카드로 */
            const newCard: NoteCard = { id: ++idRef.current, text: _edit };
            const nextCards = [..._cards, newCard];
            const nextPtr   = nextCards.length; // 새 빈 슬롯
            setCards(nextCards);
            cardsRef.current = nextCards;
            onSave?.(_edit, nextCards.length);
            triggerFlip(nextPtr, nextCards, "", "");

          } else {
            /* ② Page Flip: 기존 카드에서 다음 카드로 */
            const nextPtr   = _ptr + 1;
            const nextIsNew = nextPtr === _cards.length;
            const nextEdit  = nextIsNew ? _edit : "";
            const nextText  = nextIsNew ? _edit : (_cards[nextPtr]?.text ?? "");
            triggerFlip(nextPtr, _cards, nextIsNew ? _edit : "", nextText);
          }

        /* ─── 아래 스와이프 ─── */
        } else if (eff > THRESHOLD) {
          if (_ptr <= 0) {
            /* 더 이전 카드 없음 → rubber-band 복귀 */
            ty.value   = withSpring(0, { damping: 14, stiffness: 220 });
            rotZ.value = withSpring(0, { damping: 14, stiffness: 220 });
            return;
          }
          animRef.current = true;
          setAnimating(true);
          triggerPullDown(_cards[_ptr - 1], _ptr - 1);

        /* ─── 임계값 미달 → 복귀 ─── */
        } else {
          ty.value   = withSpring(0, { damping: 14, stiffness: 220 });
          rotZ.value = withSpring(0, { damping: 14, stiffness: 220 });
        }
      }),
  [ty, rotZ, triggerRipOut, triggerFlip, triggerPullDown, onSave]);

  /* ── 렌더링 ────────────────────────────────────────────── */
  const isNew        = ptr === cards.length;
  const currentText  = isNew ? editText : (cards[ptr]?.text ?? "");
  const cardCount    = cards.length;
  const placeholder  = isNew
    ? "여기에 내용을 입력하세요.\n\n↑ 내용 있으면: 저장 후 다음 (Page Flip)\n↑ 내용 없으면: 새 종이 (Rip-out)"
    : "";

  return (
    <View style={s.container}>
      {/* 카드 카운터 */}
      <Text style={s.counter}>
        {cardCount > 0
          ? `${isNew ? "새 노트" : `${ptr + 1} / ${cardCount}`} · 총 ${cardCount}장 저장됨`
          : "스와이프로 노트를 만들어 보세요"}
      </Text>

      {/* ── 카드 레이어 영역 ─────────────────────────── */}
      <View style={{ width: CARD_W, height: CARD_H }}>

        {/*
         * 들어오는 카드.
         *  - pull-down (inAbove=true): zIndex 높게 → 위에서 내려와 현재 카드를 덮음
         *  - rip-out / flip (inAbove=false): zIndex 낮게 → 뒤에서 올라옴
         */}
        <Animated.View
          style={[StyleSheet.absoluteFill, inStyle, { zIndex: inAbove ? 3 : 1 }]}
          pointerEvents="none"
        >
          <CardFace width={CARD_W} height={CARD_H} text={inText} editable={false} />
        </Animated.View>

        {/* 스택 깊이감 레이어 (애니메이션 없음) */}
        <View style={[s.stackLayer, { top: 5, left: 3, width: CARD_W - 3, height: CARD_H, zIndex: 0 }]} />
        <View style={[s.stackLayer, { top: 2.5, left: 1.5, width: CARD_W - 1.5, height: CARD_H, zIndex: 0,
          backgroundColor: "#faf6ea" }]} />

        {/* 현재 카드 + 제스처 */}
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[StyleSheet.absoluteFill, curStyle, shadowStyle, { zIndex: 2 }]}
          >
            <CardFace
              width={CARD_W}
              height={CARD_H}
              text={currentText}
              placeholder={placeholder}
              editable={!animating && isNew}
              onChangeText={(v) => {
                setEditText(v);
                syncRef(editRef, v);
              }}
            />
          </Animated.View>
        </GestureDetector>
      </View>

      {/* 제스처 힌트 */}
      <View style={s.hints}>
        {ptr > 0 && <Text style={s.hint}>↓ 이전 노트 (Pull-down)</Text>}
        <Text style={s.hint}>
          {isNew && editText.trim()
            ? "↑ 저장 후 다음 카드 (Page Flip)"
            : isNew
            ? "↑ 새 종이 (Rip-out)"
            : ptr < cardCount - 1
            ? "↑ 다음 노트 (Page Flip)"
            : "↑ 새 노트 작성하기"}
        </Text>
      </View>
    </View>
  );
}

/* ─── 스타일 ─────────────────────────────────────────────── */
const s = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e5e5e5",
    gap: 24,
    paddingVertical: 32,
  },
  counter: {
    fontSize: 12,
    color: Colors.zinc500,
    fontFamily: Platform.select({ ios: "Helvetica Neue", default: "sans-serif" }),
    letterSpacing: 0.3,
  },

  /* ─ 종이 카드 ─ */
  cardFront: {
    position: "absolute",
    top: 0, left: 0,
    backgroundColor: PAPER_BG,
    borderRadius: 6,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
      },
      android: { elevation: 5 },
      default: {},
    }),
  },
  stackLayer: {
    position: "absolute",
    backgroundColor: "#f5f0e0",
    borderRadius: 6,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },

  /* ─ 스프링 코일 ─ */
  coilContainer: {
    width: "100%",
    height: 34,
    flexShrink: 0,
    backgroundColor: "#f1f5f9",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#dde4ed",
    justifyContent: "center",
    position: "relative",
  },
  coilWire: {
    position: "absolute",
    height: 2,
    backgroundColor: COIL_CLR,
    top: "50%",
    marginTop: -1,
  },
  coilRings: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
  },
  ring: {
    flexShrink: 0,
    borderWidth: 2,
    borderColor: COIL_CLR,
    backgroundColor: PAPER_BG,
  },

  /* ─ 괘선 ─ */
  line: {
    position: "absolute",
    left: 20, right: 20,
    height: 1,
    backgroundColor: PAPER_LINE,
  },

  /* ─ 입력 ─ */
  input: {
    flex: 1,
    margin: 20,
    marginTop: 14,
    fontSize: 16,
    lineHeight: LINE_GAP,
    color: Colors.zinc800,
    letterSpacing: 0.3,
    padding: 0,
  },

  /* ─ 힌트 ─ */
  hints: { alignItems: "center", gap: 4 },
  hint: {
    fontSize: 11.5,
    color: Colors.zinc400,
    fontFamily: Platform.select({ ios: "Helvetica Neue", default: "sans-serif" }),
    letterSpacing: 0.2,
  },
});
