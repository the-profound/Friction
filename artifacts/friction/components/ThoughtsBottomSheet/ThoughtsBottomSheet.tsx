/**
 * ThoughtsBottomSheet
 *
 * 읽기 화면 하단에서 슬라이드 업하는 단상 패널.
 * • 배경 딤 없음 — 편지는 그대로 보이고, 불투명 흰 패널이 하단을 덮는다.
 * • 기존/신규 단상은 같은 목록형 카드 안에서 편집한다.
 * • 키보드 오픈 시: bottom:0 유지, 패널 height 확장 + 하단 여백 동시 증가.
 *   → 활성 카드가 키보드 위 목록 안에 남고, 패널은 "슬라이드"가 아닌 "늘어남".
 * • 최대 높이 = screenHeight - safeTop (노치 침범 방지).
 * • TextInput 멀티라인, 내용에 따라 자동 높이 증가, returnKey = return.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListThoughtsQueryKey,
  useCreateThought,
  useDeleteThought,
  useListThoughts,
  useUpdateThought,
} from "@workspace/api-client-react";
import type { Thought } from "@workspace/api-client-react";
import ScalePressable from "@/components/shared/ScalePressable";
import MemoToolbar from "@/components/MemoToolbar/MemoToolbar";
import { Colors, ReaderTokens, Shadows, Spacing } from "@/constants/tokens";
import {
  createKeyedSingleFlight,
  getThoughtInlineCommitAction,
  isCurrentEditorCommit,
  isCurrentOptimisticRequest,
  mergeReadingThoughtsById,
  normalizeThoughtLineBreaks,
  reconcileConfirmedThoughts,
  reconcileDeletedThoughtIds,
  resolveThoughtInputHeight,
  shouldShowReadingThoughtToolbar,
  startImmediateClose,
  type ThoughtInputHeightMeasurement,
  type OptimisticReadingThought,
} from "@/lib/thoughtInlineEditor";

const PANEL_RATIO = 0.5;
/** 스와이프 1단계 중간 스냅 높이 비율 */
const PANEL_MID_RATIO = 0.5;
/** 노치/상단 안전 영역 아래 추가 여백 */
const SAFE_TOP_EXTRA = 8;
/** 키보드 애니메이션보다 빠르게 — 앞서서 끝나야 반응이 빠르게 느껴짐 */
const KB_ANIM_DURATION = 160;
const THOUGHT_FONT_RATIO = 0.04;
const THOUGHT_LINE_HEIGHT_RATIO = 1.7;
const THOUGHT_INPUT_MIN_LINES = 3;
const THOUGHT_INPUT_VERTICAL_PADDING = 8;

const SWIPE_CLOSE_VEL = 0.5;
const SWIPE_CLOSE_DY = 60;

// ── 위치 + 속도로 스냅 목표(높이) 결정 ─────────────────────────────────────
// 모듈 레벨에 두어 onSwipeRelease / handlePan 양쪽에서 공유
function getSnapTarget(currentH: number, vy: number, full: number, mid: number): number {
  if (vy > SWIPE_CLOSE_VEL) {
    // 아래로 빠른 스와이프 → 한 단계 아래로 (mid보다 위였으면 mid, 아니면 close)
    return currentH > mid ? mid : 0;
  }
  if (vy < -SWIPE_CLOSE_VEL) {
    return full; // 위로 빠른 스와이프 → 항상 전체 확장
  }
  if (currentH > (full + mid) / 2) return full;
  if (currentH > mid / 2) return mid;
  return 0;
}

type EditorState = {
  key: string;
  thought?: Thought;
  text: string;
  initialText: string;
  requestGeneration: number;
  error?: string;
  pending: boolean;
};

function createClientId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const value = Math.floor(Math.random() * 16);
    return (token === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export interface ThoughtsBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 닫기 애니메이션이 시작되는 순간(애니메이션 완료 전) 호출된다. 상호작용 잠금 해제에 사용. */
  onWillClose?: () => void;
  /**
   * 열기 요청마다 증가하는 카운터. close 애니메이션이 끝나기 전에 다시 열 때는
   * `visible`이 계속 true라 false→true 전이가 없으므로, 이 값으로 open을 구동한다.
   */
  openNonce?: number;
  /**
   * 시트가 터치를 받아야 하는지 여부(= 열려 있는 상태).
   * ⚠️ close 애니메이션 중에는 반드시 false여야 한다. outerWrap은 화면 하단 절반을
   * 차지하는 absolute 컨테이너인데, close 시 inner panel만 translateY로 내려갈 뿐
   * outerWrap의 height는 그대로다. RN 히트테스트는 최상단 뷰에서 멈추고 뒤쪽
   * 형제로 흘려보내지 않으므로, 이 값이 true로 남으면 시트가 보이지 않는데도
   * FAB·페이지 스와이프 터치를 계속 삼킨다.
   */
  interactive?: boolean;
  /**
   * 연관 글 ID. 글 읽기 화면에서 열 때 필요. 단상 탭 FAB처럼 글과 무관하게
   * 열 때는 생략하면 된다 (sourceArticleId 없이 createdFrom:"direct"로 저장).
   */
  articleId?: string;
  pendingQuote?: string;
  /**
   * 카드 애니메이션 단일 소스:
   *   0        = 시트 닫힘
   *   midH     = 시트 50% (normal open)
   *   kbH      = 시트 65% (keyboard open at mid)
   * 수동 스와이프(full)는 이 값을 변경하지 않아 카드가 scale50/ty50 에 고정된다.
   */
  cardSheetHAnim?: Animated.Value;
  /** 외부에서 애니메이션 close를 트리거하기 위한 ref. 배경 탭 해제 등에서 사용. */
  closeHandleRef?: React.MutableRefObject<(() => void) | null>;
}

export default function ThoughtsBottomSheet({
  visible,
  onClose,
  onWillClose,
  openNonce = 0,
  interactive = true,
  articleId,
  pendingQuote,
  cardSheetHAnim,
  closeHandleRef,
}: ThoughtsBottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const queryClient = useQueryClient();

  const defaultPanelHeight = screenHeight * PANEL_RATIO;
  const maxPanelHeight = screenHeight - insets.top - SAFE_TOP_EXTRA;

  // ── Animated values ───────────────────────────────────────────────────────
  //
  // 두 레이어 분리 (native / non-native driver 혼용 금지):
  //   outerHeight (non-native) — 패널 height, 키보드에 따라 신축
  //   inputPadAnim (non-native) — inputBar paddingBottom, 키보드 위로 인풋 밀기
  //   slideAnim   (native)     — open/close translateY
  //
  const outerHeightAnim = useRef(new Animated.Value(defaultPanelHeight)).current;
  // 쉬는 상태 하단 여백: 홈인디케이터 등 safeArea 존중
  // ref로 유지해 keyboard 리스너 클로저에서 항상 최신값 접근
  const restPadRef = useRef(Math.max(insets.bottom, 8));
  restPadRef.current = Math.max(insets.bottom, 8);
  // inputPadAnim: restPad(쉬는 상태) ↔ keyboardHeight(키보드 활성)
  const inputPadAnim = useRef(new Animated.Value(restPadRef.current)).current;
  const slideAnim = useRef(new Animated.Value(defaultPanelHeight)).current;
  const slideAnimRef = useRef(slideAnim);

  // 스와이프 단계: "full" = 전체 확장, "mid" = 중간 스냅
  const snapStageRef = useRef<"full" | "mid">("full");
  // 키보드 오픈 직전 단계 기록 — hide 시 복원에 사용
  const prevSnapStageRef = useRef<"mid" | null>(null);
  // 항상 최신 midPanelHeight를 PanResponder 클로저에서 쓸 수 있도록 ref로 유지
  const midPanelHeightRef = useRef(screenHeight * PANEL_MID_RATIO);
  midPanelHeightRef.current = screenHeight * PANEL_MID_RATIO;
  // 핸들 드래그용 — 제스처 시작 시 outerHeightAnim 현재값 캡처
  const startHeightRef = useRef(defaultPanelHeight);
  // onPanResponderMove에서 직접 기록 → release에서 _value 내부 API 없이 정확히 읽음
  const currentDragHeightRef = useRef(defaultPanelHeight);
  // 최신 defaultPanelHeight / maxPanelHeight 를 PanResponder 클로저에 공급
  const defaultPanelHeightRef = useRef(defaultPanelHeight);
  defaultPanelHeightRef.current = defaultPanelHeight;
  const maxPanelHeightRef = useRef(maxPanelHeight);
  maxPanelHeightRef.current = maxPanelHeight;

  // ── outerHListenRef ───────────────────────────────────────────────────────
  // outerHListenRef: tracks outerHeightAnim (non-native, listener always fires)
  // so PanResponder closures can read the current outer height synchronously.
  const outerHListenRef = useRef(defaultPanelHeight);
  // cardSheetHAnimRef: stable ref to the prop so doClose (created in useCallback)
  // always accesses the latest value without needing to re-create the callback.
  const cardSheetHAnimRef = useRef(cardSheetHAnim);
  cardSheetHAnimRef.current = cardSheetHAnim;
  // 시트가 화면에 떠 있는지 여부 — 전역 키보드 리스너가 시트와 무관한 키보드
  // (질문 카드 답변 입력 등)에 반응하지 않도록 게이트로 쓴다.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    const sub = outerHeightAnim.addListener(({ value }) => {
      outerHListenRef.current = value;
    });
    return () => outerHeightAnim.removeListener(sub);
  }, [outerHeightAnim]);

  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const keyboardVisibleRef = useRef(false);
  keyboardVisibleRef.current = keyboardVisible;
  /** 마지막으로 받은 키보드 높이 — 롱프레스 경로처럼 이미 열린 키보드로 진입 시 사용 */
  const lastKbHeightRef = useRef(0);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const listScrollYRef = useRef(0);
  const listViewportHeightRef = useRef(0);
  const cardLayoutRef = useRef<Record<string, { y: number; height: number }>>({});
  const [thoughtCardWidth, setThoughtCardWidth] = useState(
    Math.max(0, screenWidth - Spacing.screenPx * 2),
  );
  const [inputHeightMeasurement, setInputHeightMeasurement] =
    useState<ThoughtInputHeightMeasurement>();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const editorRef = useRef<EditorState | null>(null);
  editorRef.current = editor;
  const thoughtTypography = useMemo(() => {
    const fontSize = thoughtCardWidth * THOUGHT_FONT_RATIO;
    return {
      fontSize,
      lineHeight: fontSize * THOUGHT_LINE_HEIGHT_RATIO,
    };
  }, [thoughtCardWidth]);
  const inputMinHeight =
    thoughtTypography.lineHeight * THOUGHT_INPUT_MIN_LINES +
    THOUGHT_INPUT_VERTICAL_PADDING;
  const inputHeight = resolveThoughtInputHeight({
    editorKey: editor?.key,
    width: thoughtCardWidth,
    minHeight: inputMinHeight,
    measurement: inputHeightMeasurement,
  });
  const showKeyboardToolbar = shouldShowReadingThoughtToolbar({
    visible,
    editorActive: editor != null,
    editorFocused,
    keyboardVisible,
    native: Platform.OS !== "web",
  });

  const dismissEditorKeyboard = useCallback(() => {
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const measureWebInputHeight = useCallback((key: string) => {
    if (Platform.OS !== "web") return;
    const element = inputRef.current as unknown as {
      scrollHeight?: number;
      style?: { height: string };
    } | null;
    if (!element?.style || typeof element.scrollHeight !== "number") return;

    // A controlled textarea's fixed React Native height can itself become the
    // scrollHeight floor. Temporarily release it so shrinking and initial
    // prefilled quotes are both measured from the real DOM content.
    const previousHeight = element.style.height;
    element.style.height = "0px";
    const contentHeight = element.scrollHeight;
    element.style.height = previousHeight;
    setInputHeightMeasurement({
      editorKey: key,
      width: thoughtCardWidth,
      contentHeight,
    });
  }, [thoughtCardWidth]);

  useLayoutEffect(() => {
    if (Platform.OS !== "web" || !editor) return;
    measureWebInputHeight(editor.key);
    const frame = requestAnimationFrame(() => measureWebInputHeight(editor.key));
    return () => cancelAnimationFrame(frame);
  }, [editor?.key, editor?.text, measureWebInputHeight]);
  /** 같은 편집 저장을 요청한 닫기/전환은 하나의 물리 요청을 함께 기다린다. */
  const commitSingleFlightRef = useRef(createKeyedSingleFlight<boolean>());
  /** 연속 닫기 탭이 저장과 close 애니메이션을 여러 번 시작하지 않게 한다. */
  const closeRequestRef = useRef<Promise<boolean> | null>(null);
  const [optimisticThoughts, setOptimisticThoughts] = useState<OptimisticReadingThought[]>([]);
  const optimisticThoughtsRef = useRef(optimisticThoughts);
  optimisticThoughtsRef.current = optimisticThoughts;
  const commitOptimisticThoughts = useCallback((next: OptimisticReadingThought[]) => {
    optimisticThoughtsRef.current = next;
    setOptimisticThoughts(next);
  }, []);
  const addTransitionLockRef = useRef(false);
  /** optimistic 삭제: 화면에서 즉시 숨길 ID 집합 */
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  // ── Data ─────────────────────────────────────────────────────────────────

  const thoughtsQuery = useListThoughts(
    { sourceArticleId: articleId },
    {
      query: {
        queryKey: getListThoughtsQueryKey({ sourceArticleId: articleId }),
        enabled: visible && !!articleId,
      },
    },
  );
  const thoughts = (thoughtsQuery.data ?? []) as Thought[];
  const articleOptimisticThoughts = optimisticThoughts.filter(
    (thought) => thought.sourceArticleId === articleId,
  );
  const displayedThoughts = mergeReadingThoughtsById(thoughts, articleOptimisticThoughts);
  const createThought = useCreateThought();
  const updateThought = useUpdateThought();
  const deleteThought = useDeleteThought();

  const invalidateThoughts = useCallback(() => {
    return Promise.all([
      queryClient.invalidateQueries({
        queryKey: getListThoughtsQueryKey({ sourceArticleId: articleId }),
      }),
      queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() }),
    ]);
  }, [queryClient, articleId]);

  const cancelThoughtQueries = useCallback(() => {
    return Promise.all([
      queryClient.cancelQueries({
        queryKey: getListThoughtsQueryKey({ sourceArticleId: articleId }),
      }),
      queryClient.cancelQueries({ queryKey: getListThoughtsQueryKey() }),
    ]);
  }, [articleId, queryClient]);

  const upsertThoughtInCaches = useCallback((thought: Thought) => {
    const upsert = (previous: Thought[] | undefined) => {
      if (!previous) return previous;
      const index = previous.findIndex((item) => item.id === thought.id);
      if (index < 0) return [...previous, thought];
      const next = [...previous];
      next[index] = thought;
      return next;
    };
    queryClient.setQueryData<Thought[]>(getListThoughtsQueryKey(), upsert);
    queryClient.setQueryData<Thought[]>(
      getListThoughtsQueryKey({ sourceArticleId: articleId }),
      upsert,
    );
  }, [articleId, queryClient]);

  const removeThoughtFromCaches = useCallback((thoughtId: string) => {
    const remove = (previous: Thought[] | undefined) =>
      previous?.filter((item) => item.id !== thoughtId);
    queryClient.setQueryData<Thought[]>(getListThoughtsQueryKey(), remove);
    queryClient.setQueryData<Thought[]>(
      getListThoughtsQueryKey({ sourceArticleId: articleId }),
      remove,
    );
  }, [articleId, queryClient]);

  const refreshAndReconcileThoughtFences = useCallback(async () => {
    try {
      await invalidateThoughts();
    } catch (error) {
      console.warn("[ThoughtsBottomSheet] thought refetch failed:", error);
      return;
    }
    const refreshed = queryClient.getQueryData<Thought[]>(
      getListThoughtsQueryKey({ sourceArticleId: articleId }),
    ) ?? [];
    commitOptimisticThoughts(reconcileConfirmedThoughts(
      refreshed,
      optimisticThoughtsRef.current,
    ));
    setDeletedIds((current) => reconcileDeletedThoughtIds(refreshed, current));
  }, [articleId, commitOptimisticThoughts, invalidateThoughts, queryClient]);

  // ── Keyboard: 패널 height + inputBar padding 동시 신축 ─────────────────────

  const animKbOptions = useCallback(
    (toHeight: number, toPad: number) => {
      const timingBase = {
        duration: KB_ANIM_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false as const,
      };
      return Animated.parallel([
        Animated.timing(outerHeightAnim, { toValue: toHeight, ...timingBase }),
        Animated.timing(inputPadAnim, { toValue: toPad, ...timingBase }),
      ]);
    },
    [outerHeightAnim, inputPadAnim],
  );

  useEffect(() => {
    // iOS: keyboardWillShow fires before keyboard appears → can animate in sync
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (e) => {
      // 시트가 닫혀 있을 때 발생한 키보드(예: 질문 카드 답변 입력)에는 반응하지
      // 않는다. 반응하면 cardSheetHAnim이 움직여 리더 프레임 전체가 축소된다.
      if (!visibleRef.current) return;
      const kh = e.endCoordinates.height;
      lastKbHeightRef.current = kh;
      setKeyboardVisible(true);
      if (snapStageRef.current === "mid") {
        // 중간 단계에서 키보드 열림 → 65%로 시트 확장, snapStage는 "mid" 유지
        // cardSheetHAnim을 kbH(65%)로 timing → read.tsx 리스너가 상단 면 기준 축소 적용
        prevSnapStageRef.current = "mid";
        const targetH = Math.min(screenHeight * 0.65, maxPanelHeight);
        const timingBase = { duration: KB_ANIM_DURATION, easing: Easing.out(Easing.cubic), useNativeDriver: false as const };
        const animations: Animated.CompositeAnimation[] = [animKbOptions(targetH, kh + 8)];
        if (cardSheetHAnimRef.current) {
          animations.push(Animated.timing(cardSheetHAnimRef.current, { toValue: targetH, ...timingBase }));
        }
        Animated.parallel(animations).start();
      } else {
        // 전체 단계에서 키보드 열림 → 높이 그대로, inputPad만 올림
        // (defaultPanelHeight + kh 가 maxPanelHeight 보다 작을 수 있어
        //  animKbOptions로 outerHeight를 변경하면 시트가 내려가는 버그 발생)
        prevSnapStageRef.current = null;
        snapStageRef.current = "full";
        Animated.timing(inputPadAnim, {
          toValue: kh + 8,
          duration: KB_ANIM_DURATION,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
      }
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      if (!visibleRef.current) return;
      setKeyboardVisible(false);
      if (prevSnapStageRef.current === "mid") {
        // 중간 단계에서 키보드가 열렸다가 닫힘 → mid 높이(50%)로 복원
        // ⚠️ Animated.parallel을 사용하면 onPanResponderRelease의 snapToHeight가
        //    outerHeightAnim에 새 spring을 시작할 때, stopTogether:true(기본값)에 의해
        //    같은 그룹의 inputPadAnim·cardSheetHAnim 도 함께 강제 종료된다.
        // Fix: 세 값을 독립적으로 start() — 하나가 외부에서 중단돼도 나머지는 계속 실행.
        prevSnapStageRef.current = null;
        snapStageRef.current = "mid";
        const midH = screenHeight * PANEL_MID_RATIO;
        const timingBase = { duration: KB_ANIM_DURATION, easing: Easing.out(Easing.cubic), useNativeDriver: false as const };
        Animated.timing(outerHeightAnim, { toValue: midH, ...timingBase }).start();
        Animated.timing(inputPadAnim, { toValue: restPadRef.current, ...timingBase }).start();
        if (cardSheetHAnimRef.current) {
          Animated.timing(cardSheetHAnimRef.current, { toValue: midH, ...timingBase }).start();
        }
      } else {
        // 전체 단계 복귀: 패널 높이는 그대로, inputPad만 복원
        Animated.timing(inputPadAnim, {
          toValue: restPadRef.current,
          duration: KB_ANIM_DURATION,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
      }
    });

    return () => { showSub.remove(); hideSub.remove(); };
  }, [animKbOptions, defaultPanelHeight, maxPanelHeight, screenHeight]);

  // ── Close ─────────────────────────────────────────────────────────────────

  const doClose = useCallback(() => {
    // 이 close 세션의 토큰. 닫히는 도중 다시 열리면 open effect가 토큰을 올려
    // 아래 완료 콜백이 무효화된다 → 새로 열린 시트를 stale 콜백이 닫지 못한다.
    sessionTokenRef.current += 1;
    const closeToken = sessionTokenRef.current;
    // keyboardWillHide가 mid 복원 애니메이션을 실행하지 않도록 먼저 초기화
    prevSnapStageRef.current = null;
    Keyboard.dismiss();
    // 애니메이션 시작 전에 즉시 상호작용 잠금 해제를 알린다.
    // 여기서는 잠금 해제 외의 setState를 절대 하지 않는다 — reader의 panGesture가
    // runOnJS(true)라서, close 시점에 리스트/리더가 리렌더되면 JS 스레드가 막혀
    // 스와이프·FAB 터치가 씹히는 "공백 시간"이 생긴다. 내부 상태 초기화는
    // 애니메이션 완료 후(아래 start 콜백)로 미룬다 — 재오픈 전에 항상 실행된다.
    onWillClose?.();
    const springBase = { damping: 32, stiffness: 400 };
    const animations: Animated.CompositeAnimation[] = [
      Animated.spring(slideAnimRef.current, { toValue: screenHeight, ...springBase, useNativeDriver: true }),
    ];
    if (cardSheetHAnimRef.current) {
      animations.push(Animated.spring(cardSheetHAnimRef.current, { toValue: 0, ...springBase, useNativeDriver: false }));
    }
    Animated.parallel(animations).start(() => {
      // 닫히는 도중 재오픈되었다면(토큰 불일치) 이 콜백은 stale — 아무것도 하지 않는다.
      // finished 가드 대신 토큰을 쓰는 이유: 애니메이션이 취소돼도(finished:false)
      // 정상 close라면 반드시 정리가 실행되어야 하기 때문.
      if (closeToken !== sessionTokenRef.current) return;
      onClose();
    });
  }, [screenHeight, onWillClose, onClose]);

  const doCloseRef = useRef(doClose);
  doCloseRef.current = doClose;

  // 외부(read.tsx 배경 탭 등)에서 doClose를 트리거할 수 있도록 ref 노출
  useEffect(() => {
    if (closeHandleRef) {
      closeHandleRef.current = () => doCloseRef.current();
    }
    return () => {
      if (closeHandleRef) closeHandleRef.current = null;
    };
  }, [closeHandleRef]);

  // open/close 세션 토큰. doClose가 증가시키고 open effect도 증가시켜,
  // 닫히는 도중 재오픈된 경우 이전 close의 완료 콜백을 무효화한다.
  const sessionTokenRef = useRef(0);

  // ── 스와이프·편집 상태 초기화 헬퍼 ─────────────────────────────────────────
  // 시트가 닫히거나 articleId가 바뀔 때 반드시 호출해 cross-context state leak을 방지한다.
  const resetTransientState = useCallback(() => {
    setEditorFocused(false);
    setEditor(null);
  }, []);

  // ── Open ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (visible) {
      // 새 세션 시작 — 진행 중이던 close의 완료 콜백을 무효화한다.
      // (close 애니메이션 도중 FAB/롱프레스로 재오픈하는 경로)
      sessionTokenRef.current += 1;
      closeRequestRef.current = null;
      // 닫힌 뒤 백그라운드 저장이 아직 진행 중이거나 실패했다면 같은 스냅샷을
      // 복원한다. 성공/빈 입력으로 정리된 경우에만 새 편집기를 만든다.
      const recoverableEditor = editorRef.current;
      if (!recoverableEditor?.pending && !recoverableEditor?.error) {
        resetTransientState();
        setEditor({
          key: createClientId(),
          text: normalizeThoughtLineBreaks(pendingQuote ?? ""),
          initialText: "",
          requestGeneration: 1,
          pending: false,
        });
      }
      // 시트는 defaultPanelHeight(50% = mid) 높이로 열린다 → snapStage = "mid"
      // "full"로 설정하면 키보드 열릴 때 65% 분기가 동작하지 않음
      snapStageRef.current = "mid";
      prevSnapStageRef.current = null;

      // ⚠️ stopTogether 충돌 방지:
      //   과거에는 cardSheetHAnim spring을 포함한 parallel 그룹과,
      //   키보드 분기의 cardSheetHAnim timing을 같은 tick에서 start()했다.
      //   timing이 시작되는 순간 stopTogether:true(기본값)에 의해 첫 그룹 전체가
      //   강제 종료되고, slideAnim spring도 함께 중단돼 시트가 슬라이드인되지 않았다.
      //
      //   Fix: 애니메이션 시작 전에 키보드 상태를 먼저 평가해
      //   outerHeightAnim·inputPadAnim 두 값을 setValue로 즉시 세팅하고,
      //   slideAnim·cardSheetHAnim 은 각각 독립 spring으로 실행한다.
      //   parallel 그룹이 없으므로 stopTogether 충돌 없음.
      //
      //   cardSheetHAnim은 0→targetH spring: slideAnim이 defaultPanelHeight→0으로
      //   spring될 때 같은 진폭·파라미터(non-keyboard 경로)라 카드 축소가 시트
      //   슬라이드인과 정확히 동기화된다. 이전에 setValue로 즉시 세팅하던 방식은
      //   카드가 시트보다 먼저 작아지는 시각적 튀김을 유발했다.
      if (keyboardVisibleRef.current && lastKbHeightRef.current > 0) {
        // 롱프레스 → 메모 경로: keyboardWillShow가 다시 발화되지 않으므로 여기서 직접 세팅
        const kh = lastKbHeightRef.current;
        const openH = Math.min(screenHeight * 0.65, maxPanelHeight);
        prevSnapStageRef.current = "mid";
        outerHeightAnim.setValue(openH);
        inputPadAnim.setValue(kh + 8);
        cardSheetHAnimRef.current?.setValue(0);
        if (cardSheetHAnimRef.current) {
          Animated.spring(cardSheetHAnimRef.current, {
            toValue: openH,
            damping: 28,
            stiffness: 220,
            useNativeDriver: false,
          }).start();
        }
      } else {
        // FAB 진입(키보드 미열림): outer/pad는 즉시, card는 slideAnim과 동기 spring
        outerHeightAnim.setValue(defaultPanelHeight);
        inputPadAnim.setValue(restPadRef.current);
        cardSheetHAnimRef.current?.setValue(0);
        if (cardSheetHAnimRef.current) {
          Animated.spring(cardSheetHAnimRef.current, {
            toValue: defaultPanelHeight,
            damping: 28,
            stiffness: 220,
            useNativeDriver: false,
          }).start();
        }
      }

      // slideAnim 시작 위치 세팅 → spring 하나만 단독 실행
      slideAnim.setValue(defaultPanelHeight);
      Animated.spring(slideAnim, { toValue: 0, damping: 28, stiffness: 220, useNativeDriver: true }).start();

      setTimeout(() => {
        inputRef.current?.focus();
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 300);
    }
    // openNonce도 dep에 포함: close 애니메이션 중 재오픈 시 visible이 계속 true라
    // false→true 전이가 없으므로, nonce 변화로 open 시퀀스를 다시 구동한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, openNonce]);

  // articleId가 바뀌면 (다른 글로 전환) 편집·스와이프 상태를 즉시 초기화한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (visible) resetTransientState(); }, [articleId]);

  // ── Save ─────────────────────────────────────────────────────────────────

  const commitEditor = useCallback(async (): Promise<boolean> => {
    const current = editorRef.current;
    if (!current) return true;
    const committedText = normalizeThoughtLineBreaks(current.text);
    // 다른 편집 저장 뒤에 대기하더라도 캡처 이후 입력이 바뀌지 않게 즉시 잠근다.
    setEditor((value) => value?.key === current.key
      ? { ...value, pending: true, error: undefined }
      : value);
    return commitSingleFlightRef.current.run(current.key, async () => {
      const action = getThoughtInlineCommitAction({
        isExisting: !!current.thought,
        text: committedText,
        initialText: current.initialText,
      });
      try {
        if (action === "create" || action === "update" || action === "delete") {
          // 저장 이전에 시작된 목록 요청을 모두 retire한 뒤 캐시를 확정해야 한다.
          await cancelThoughtQueries();
        }
        if (current.thought) {
          if (action === "delete") {
            await deleteThought.mutateAsync({ id: current.thought.id });
            await cancelThoughtQueries();
            removeThoughtFromCaches(current.thought.id);
            setDeletedIds((prev) => new Set([...prev, current.thought!.id]));
          } else if (action === "update") {
            const saved = await updateThought.mutateAsync({
              id: current.thought.id,
              data: { content: committedText },
            }) as Thought;
            await cancelThoughtQueries();
            upsertThoughtInCaches(saved);
            commitOptimisticThoughts([
              ...optimisticThoughtsRef.current.filter((item) => item.id !== saved.id),
              {
                id: saved.id,
                content: normalizeThoughtLineBreaks(saved.content ?? committedText),
                sourceArticleId: saved.sourceArticleId ?? articleId,
                createdAt: saved.createdAt,
                saveState: "confirmed",
                requestGeneration: 1,
              },
            ]);
          }
        } else if (action === "create") {
          const saved = await createThought.mutateAsync({
            data: {
              clientId: current.key,
              requestGeneration: current.requestGeneration,
              content: committedText,
              createdFrom: "reading",
              sourceArticleId: articleId,
            },
          }) as Thought;
          await cancelThoughtQueries();
          upsertThoughtInCaches(saved);
          commitOptimisticThoughts([
            ...optimisticThoughtsRef.current.filter((item) => item.id !== saved.id),
            {
              id: saved.id,
              content: normalizeThoughtLineBreaks(saved.content ?? committedText),
              sourceArticleId: saved.sourceArticleId ?? articleId,
              createdAt: saved.createdAt,
              saveState: "confirmed",
              requestGeneration: 1,
            },
          ]);
        }
        // 확정 overlay/tombstone이 지연 목록 응답을 막는 동안 서버 목록을 재조회한다.
        void refreshAndReconcileThoughtFences();
        setEditor((value) => isCurrentEditorCommit(value?.key, current.key) ? null : value);
        Keyboard.dismiss();
        return true;
      } catch (e) {
        console.warn("[ThoughtsBottomSheet] inline commit failed:", e);
        setEditor((value) => isCurrentEditorCommit(value?.key, current.key) ? {
          ...value,
          pending: false,
          requestGeneration:
            !current.thought && action === "create"
              ? current.requestGeneration + 1
              : current.requestGeneration,
          error: current.thought
            ? (action === "delete" ? "삭제하지 못했어요. 다시 시도해 주세요." : "수정하지 못했어요. 다시 시도해 주세요.")
            : "저장하지 못했어요. 다시 시도해 주세요.",
        } : value);
        return false;
      }
    });
  }, [
    articleId,
    cancelThoughtQueries,
    commitOptimisticThoughts,
    createThought,
    deleteThought,
    removeThoughtFromCaches,
    refreshAndReconcileThoughtFences,
    updateThought,
    upsertThoughtInCaches,
  ]);

  const saveOptimisticThought = useCallback((
    optimistic: OptimisticReadingThought,
    requestGeneration: number,
  ) => {
    void (async () => {
      let saved: Thought;
      try {
        await cancelThoughtQueries();
        saved = await createThought.mutateAsync({
          data: {
            clientId: optimistic.id,
            requestGeneration,
            content: optimistic.content,
            createdFrom: "reading",
            sourceArticleId: optimistic.sourceArticleId,
          },
        }) as Thought;
        await cancelThoughtQueries();
      } catch (error) {
        console.warn("[ThoughtsBottomSheet] optimistic create failed:", error);
        commitOptimisticThoughts(optimisticThoughtsRef.current.map((item) =>
          item.id === optimistic.id && item.requestGeneration === requestGeneration
            ? {
                ...item,
                saveState: "failed",
                error: "저장하지 못했어요. 다시 시도해 주세요.",
              }
            : item
        ));
        return;
      }

      const current = optimisticThoughtsRef.current.find((item) => item.id === optimistic.id);
      if (!isCurrentOptimisticRequest(current, requestGeneration)) return;
      upsertThoughtInCaches(saved);
      commitOptimisticThoughts(optimisticThoughtsRef.current.map((item) =>
        item.id === optimistic.id && item.requestGeneration === requestGeneration
          ? { ...item, saveState: "confirmed", error: undefined }
          : item
      ));
      try {
        await invalidateThoughts();
      } catch (error) {
        // Creation already succeeded. Keep the confirmed local fence so a
        // transient refetch failure cannot turn a saved card into a retry.
        console.warn("[ThoughtsBottomSheet] thought refetch failed:", error);
        return;
      }
      const refreshed = queryClient.getQueryData<Thought[]>(
        getListThoughtsQueryKey({ sourceArticleId: optimistic.sourceArticleId }),
      ) ?? [];
      const latest = optimisticThoughtsRef.current.find((item) => item.id === optimistic.id);
      if (!isCurrentOptimisticRequest(latest, requestGeneration)) return;
      commitOptimisticThoughts(reconcileConfirmedThoughts(
        refreshed,
        optimisticThoughtsRef.current,
      ));
    })();
  }, [
    commitOptimisticThoughts,
    cancelThoughtQueries,
    createThought,
    invalidateThoughts,
    queryClient,
    upsertThoughtInCaches,
  ]);

  const retryOptimisticThought = useCallback((id: string) => {
    const current = optimisticThoughtsRef.current.find((item) => item.id === id);
    if (!current || current.saveState !== "failed") return;
    const retrying = {
      ...current,
      saveState: "pending" as const,
      error: undefined,
      requestGeneration: current.requestGeneration + 1,
    };
    commitOptimisticThoughts(
      optimisticThoughtsRef.current.map((item) => item.id === id ? retrying : item),
    );
    saveOptimisticThought(retrying, retrying.requestGeneration);
  }, [commitOptimisticThoughts, saveOptimisticThought]);

  const openNextNewEditorImmediately = useCallback(() => {
    if (addTransitionLockRef.current) return;
    addTransitionLockRef.current = true;
    const current = editorRef.current;
    const action = current && !current.thought
      ? getThoughtInlineCommitAction({
          isExisting: false,
          text: current.text,
          initialText: current.initialText,
        })
      : null;

    if (current && !current.thought && action === "create") {
      const optimistic: OptimisticReadingThought = {
        id: current.key,
        content: normalizeThoughtLineBreaks(current.text),
        sourceArticleId: articleId,
        createdAt: new Date().toISOString(),
        saveState: "pending",
        requestGeneration: 1,
      };
      commitOptimisticThoughts([
        ...optimisticThoughtsRef.current.filter((item) => item.id !== optimistic.id),
        optimistic,
      ]);
      saveOptimisticThought(optimistic, optimistic.requestGeneration);
    }

    const nextKey = createClientId();
    setEditor({
      key: nextKey,
      text: "",
      initialText: "",
      requestGeneration: 1,
      pending: false,
    });
    setTimeout(() => {
      inputRef.current?.focus();
      scrollRef.current?.scrollToEnd({ animated: true });
      addTransitionLockRef.current = false;
    }, 0);
  }, [articleId, commitOptimisticThoughts, saveOptimisticThought]);

  const openEditor = useCallback(async (thought?: Thought) => {
    const openSession = sessionTokenRef.current;
    if (editorRef.current && !(await commitEditor())) return;
    if (openSession !== sessionTokenRef.current) return;
    const key = thought?.id ?? createClientId();
    const text = normalizeThoughtLineBreaks(thought?.content ?? "");
    setEditor({
      key,
      thought,
      text,
      initialText: text,
      requestGeneration: 1,
      pending: false,
    });
    setTimeout(() => {
      inputRef.current?.focus();
      const layout = cardLayoutRef.current[key];
      if (layout) {
        const target = layout.y + layout.height - listViewportHeightRef.current + 16;
        scrollRef.current?.scrollTo({ y: Math.max(0, target), animated: true });
      }
      else scrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
  }, [commitEditor]);

  const scrollEditorBottomIntoView = useCallback((key: string) => {
    setTimeout(() => {
      const layout = cardLayoutRef.current[key];
      if (!layout) {
        scrollRef.current?.scrollToEnd({ animated: true });
        return;
      }
      const target = layout.y + layout.height - listViewportHeightRef.current + 16;
      scrollRef.current?.scrollTo({ y: Math.max(0, target), animated: true });
    }, 0);
  }, []);

  const updateThoughtCardLayout = useCallback((
    key: string,
    layout: { width: number; y: number; height: number },
  ) => {
    const previous = cardLayoutRef.current[key];
    cardLayoutRef.current[key] = { y: layout.y, height: layout.height };
    setThoughtCardWidth((current) =>
      Math.abs(current - layout.width) < 0.5 ? current : layout.width,
    );
    if (
      editorRef.current?.key === key
      && (!previous || Math.abs(previous.height - layout.height) >= 0.5)
    ) {
      scrollEditorBottomIntoView(key);
    }
  }, [scrollEditorBottomIntoView]);

  const handleEditorContentSizeChange = useCallback((
    key: string,
    contentHeight: number,
  ) => {
    if (Platform.OS === "web") {
      measureWebInputHeight(key);
      return;
    }
    setInputHeightMeasurement((current) => {
      const next = {
        editorKey: key,
        width: thoughtCardWidth,
        contentHeight,
      };
      return current
        && current.editorKey === next.editorKey
        && Math.abs(current.width - next.width) < 0.5
        && Math.abs(current.contentHeight - next.contentHeight) < 0.5
        ? current
        : next;
    });
  }, [measureWebInputHeight, thoughtCardWidth]);

  // 모든 닫기 경로(배경 탭, 핸들 드래그, 외부 ref)는 동일한 저장 수명주기를 거친다.
  // 최신 스냅샷 저장을 시작한 직후 결과를 기다리지 않고 닫기 애니메이션을 시작한다.
  doCloseRef.current = () => {
    if (closeRequestRef.current) return;
    const closeRequest = startImmediateClose(commitEditor, doClose);
    closeRequestRef.current = closeRequest;
  };

  // ── Handle-bar pan responder ──────────────────────────────────────────────

  // ── 공용 스냅-백 spring ───────────────────────────────────────────────────

  const springBack = () => {
    const springBase = { damping: 32, stiffness: 400 };
    Animated.spring(slideAnimRef.current, { toValue: 0, ...springBase, useNativeDriver: true }).start();
  };

  // ── 리스트 스와이프 release 로직 ─────────────────────────────────────────
  //   드래그 거리·속도 기반으로 full/mid/close 직접 결정 (강제 2단계 없음)

  const onSwipeRelease = (gs: { dy: number; vy: number }) => {
    if (gs.dy > SWIPE_CLOSE_DY || gs.vy > SWIPE_CLOSE_VEL) {
      const currentH = Math.max(0, outerHListenRef.current - gs.dy);
      let target = getSnapTarget(
        currentH, gs.vy,
        maxPanelHeightRef.current, midPanelHeightRef.current,
      );
      // full 단계에서 직접 닫힘 차단 — 반드시 mid를 먼저 거쳐야 함
      if (target <= 0 && snapStageRef.current === "full") {
        target = midPanelHeightRef.current;
      }
      if (target <= 0) {
        doCloseRef.current();
      } else {
        snapStageRef.current = target >= maxPanelHeightRef.current * 0.9 ? "full" : "mid";
        const springBase = { damping: 28, stiffness: 220 };
        const animations: Animated.CompositeAnimation[] = [
          Animated.spring(slideAnimRef.current, { toValue: 0, ...springBase, useNativeDriver: true }),
          Animated.spring(outerHeightAnim, { toValue: target, ...springBase, useNativeDriver: false }),
        ];
        Animated.parallel(animations).start();
      }
    } else {
      springBack();
    }
  };

  const onSwipeReleaseRef = useRef(onSwipeRelease);
  onSwipeReleaseRef.current = onSwipeRelease;

  // ── 핸들바 드래그: outerHeightAnim 직접 조작, 3단계 스냅 ─────────────────
  //   full(100%) ↔ mid(50%) ↔ close(0%) — 위아래 자유 드래그 가능

  // 목표 높이로 spring, snapStageRef 동기화
  const snapToHeight = (target: number) => {
    if (target <= 0) { doCloseRef.current(); return; }
    snapStageRef.current = target >= maxPanelHeightRef.current * 0.9 ? "full" : "mid";
    const springBase = { damping: 32, stiffness: 400, useNativeDriver: false as const };
    Animated.spring(outerHeightAnim, { toValue: target, ...springBase }).start();
    // 드래그 중 setValue로 변경된 cardSheetHAnim을 원래 위치로 복원.
    // full 스냅 시에도 카드는 scale50/ty50 고정이므로 목표는 항상 midH 이하.
    if (cardSheetHAnimRef.current) {
      const cardTarget = Math.min(target, midPanelHeightRef.current);
      Animated.spring(cardSheetHAnimRef.current, { toValue: cardTarget, ...springBase }).start();
    }
  };
  const snapToHeightRef = useRef(snapToHeight);
  snapToHeightRef.current = snapToHeight;

  const handlePan = useRef(
    PanResponder.create({
      // 핸들바는 터치 시작부터 제스처를 소유 → onPanResponderGrant 보장
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // 핸들바 터치 시작 = 키보드 해제 (드래그든 단순 탭이든 동일)
        if (keyboardVisibleRef.current) Keyboard.dismiss();
        // stopAnimation: 진행 중인 outerHeightAnim 애니메이션을 멈추고 정확한
        // 현재값을 동기로 캡처한다. outerHeightAnim만 중단되며,
        // keyboardWillHide가 시작한 inputPadAnim·cardSheetHAnim 은 독립 실행
        // 중이므로 영향을 받지 않는다(Animated.parallel 에서 분리된 구조).
        outerHeightAnim.stopAnimation((stoppedValue) => {
          startHeightRef.current = stoppedValue;
          currentDragHeightRef.current = stoppedValue;
          outerHListenRef.current = stoppedValue;
        });
      },
      onPanResponderMove: (_, gs) => {
        const newH = Math.max(
          0,
          Math.min(maxPanelHeightRef.current, startHeightRef.current - gs.dy),
        );
        currentDragHeightRef.current = newH;
        outerHeightAnim.setValue(newH);
        // outerHListenRef update: addListener fires asynchronously, so sync here
        outerHListenRef.current = newH;
        // cardSheetHAnim: 드래그로 시트가 midH 아래로 내려갈 때 카드 비례 복원.
        // midH 이상은 scale50/ty50 고정 (full 스와이프 시 카드 추가 변형 없음).
        cardSheetHAnimRef.current?.setValue(
          Math.min(newH, midPanelHeightRef.current),
        );
      },
      onPanResponderRelease: (_, gs) => {
        // currentDragHeightRef: move에서 직접 기록한 값 — _value 내부 API 불필요
        // full 스냅 목표 = maxPanelHeight (키보드 확장 시와 동일한 노치 근처 높이)
        let target = getSnapTarget(
          currentDragHeightRef.current, gs.vy,
          maxPanelHeightRef.current, midPanelHeightRef.current,
        );
        // full 단계에서 직접 닫힘 차단
        if (target <= 0 && snapStageRef.current === "full") {
          target = midPanelHeightRef.current;
        }
        snapToHeightRef.current(target);
      },
      onPanResponderTerminate: () => {
        let target = getSnapTarget(
          currentDragHeightRef.current, 0,
          maxPanelHeightRef.current, midPanelHeightRef.current,
        );
        // full 단계에서 직접 닫힘 차단
        if (target <= 0 && snapStageRef.current === "full") {
          target = midPanelHeightRef.current;
        }
        snapToHeightRef.current(target);
      },
    }),
  ).current;

  // ── List pull-to-close ────────────────────────────────────────────────────

  const listPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        listScrollYRef.current <= 0 && gs.dy > 8 && gs.dy > Math.abs(gs.dx) * 1.5,
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderMove: (_, gs) => {
        const dy = Math.max(0, gs.dy);
        slideAnimRef.current.setValue(dy);
      },
      onPanResponderRelease: (_, gs) => { onSwipeReleaseRef.current(gs); },
      onPanResponderTerminate: () => { springBack(); },
    }),
  ).current;

  if (!visible) return null;

  return (
    // Outer: non-native — height 신축
    // pointerEvents: close 애니메이션 중(interactive=false)에는 터치를 완전히
    // 통과시켜야 한다. 이 컨테이너는 닫히는 동안에도 하단 절반을 계속 점유하므로,
    // 여기서 막지 않으면 FAB·페이지 스와이프가 애니메이션이 끝날 때까지 죽는다.
    <Animated.View
      style={[styles.outerWrap, { height: outerHeightAnim }]}
      pointerEvents={interactive ? "auto" : "none"}
    >
      {/* Inner: native — translateY open/close */}
      <Animated.View
        style={[styles.panel, { transform: [{ translateY: slideAnim }] }]}
      >
        {/* ── Drag handle ─────────────────────────────────────────────── */}
          <View style={styles.header}>
            <View style={styles.dragZone} {...handlePan.panHandlers}>
              <View style={styles.handle} />
            </View>
        </View>

        {/* ── Thought list ─────────────────────────────────────────────── */}
        <View style={styles.listWrap} {...listPan.panHandlers}>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            onLayout={(event) => {
              listViewportHeightRef.current = event.nativeEvent.layout.height;
            }}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
            onScroll={(e) => {
              listScrollYRef.current = e.nativeEvent.contentOffset.y;
            }}
          >
            {thoughtsQuery.isLoading ? (
              <View style={styles.emptyWrap}>
                <ActivityIndicator size="small" color={Colors.zinc300} />
              </View>
            ) : (
              <>
                {displayedThoughts
                  .filter((t) => !deletedIds.has(t.id))
                  .map((t) => "saveState" in t ? (
                    <View
                      key={t.id}
                      style={styles.card}
                      onLayout={(event) => updateThoughtCardLayout(t.id, event.nativeEvent.layout)}
                    >
                      <Text style={[styles.cardText, thoughtTypography]}>{t.content}</Text>
                      {t.saveState === "failed" && (
                        <View style={styles.errorRow}>
                          <Text style={styles.errorText}>{t.error}</Text>
                          <Pressable
                            onPress={() => retryOptimisticThought(t.id)}
                            style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
                            accessibilityRole="button"
                            accessibilityLabel="단상 저장 다시 시도"
                            accessibilityState={{ busy: false }}
                          >
                            <Text style={styles.retryText}>다시 시도</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  ) : editor?.thought?.id === t.id ? (
                    <View
                      key={t.id}
                      onLayout={(event) => {
                        updateThoughtCardLayout(t.id, event.nativeEvent.layout);
                      }}
                      style={styles.editorCard}
                    >
                      <TextInput
                        ref={inputRef}
                        value={editor.text}
                        onChangeText={(text) => setEditor((value) => value ? {
                          ...value,
                          text: normalizeThoughtLineBreaks(text),
                          error: undefined,
                        } : value)}
                        editable={!editor.pending}
                        style={[
                          styles.cardInput,
                          thoughtTypography,
                          { minHeight: inputMinHeight, height: inputHeight },
                        ]}
                        multiline
                        underlineColorAndroid="transparent"
                        scrollEnabled={false}
                        textAlignVertical="top"
                        placeholder="단상을 적어보세요"
                        placeholderTextColor={Colors.zinc400}
                        cursorColor={Colors.cursorAccent}
                        selectionColor={Colors.cursorAccent}
                        accessibilityLabel="단상 내용"
                        onFocus={() => setEditorFocused(true)}
                        onBlur={() => setEditorFocused(false)}
                        onContentSizeChange={(event) =>
                          handleEditorContentSizeChange(
                            editor.key,
                            event.nativeEvent.contentSize.height,
                          )
                        }
                      />
                      {editor.error && (
                        <View style={styles.errorRow}>
                          <Text style={styles.errorText}>{editor.error}</Text>
                          <Pressable
                            onPress={() => void commitEditor()}
                            style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
                            accessibilityRole="button"
                            accessibilityLabel="단상 저장 다시 시도"
                          >
                            <Text style={styles.retryText}>다시 시도</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  ) : (
                    <Pressable
                      key={t.id}
                      onPress={() => void openEditor(t)}
                      style={({ pressed }) => [styles.card, pressed && styles.buttonPressed]}
                      onLayout={(event) => updateThoughtCardLayout(t.id, event.nativeEvent.layout)}
                      accessibilityRole="button"
                      accessibilityLabel="단상 수정"
                    >
                      <Text style={[styles.cardText, thoughtTypography]}>{t.content ?? ""}</Text>
                    </Pressable>
                  ))}
                {editor && !editor.thought && (
                  <View
                    onLayout={(event) => {
                      updateThoughtCardLayout(editor.key, event.nativeEvent.layout);
                    }}
                    style={styles.editorCard}
                  >
                    <TextInput
                      ref={inputRef}
                      value={editor.text}
                      onChangeText={(text) => setEditor((value) => value ? {
                        ...value,
                        text: normalizeThoughtLineBreaks(text),
                        error: undefined,
                      } : value)}
                      editable={!editor.pending}
                      style={[
                        styles.cardInput,
                        thoughtTypography,
                        { minHeight: inputMinHeight, height: inputHeight },
                      ]}
                      multiline
                      underlineColorAndroid="transparent"
                      scrollEnabled={false}
                      textAlignVertical="top"
                      placeholder="단상을 적어보세요"
                      placeholderTextColor={Colors.zinc400}
                      cursorColor={Colors.cursorAccent}
                      selectionColor={Colors.cursorAccent}
                      accessibilityLabel="새 단상 내용"
                      onFocus={() => setEditorFocused(true)}
                      onBlur={() => setEditorFocused(false)}
                      onContentSizeChange={(event) =>
                        handleEditorContentSizeChange(
                          editor.key,
                          event.nativeEvent.contentSize.height,
                        )
                      }
                    />
                    {editor.error && (
                      <View style={styles.errorRow}>
                        <Text style={styles.errorText}>{editor.error}</Text>
                        <Pressable
                          onPress={() => void commitEditor()}
                          style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
                          accessibilityRole="button"
                          accessibilityLabel="단상 저장 다시 시도"
                        >
                          <Text style={styles.retryText}>다시 시도</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                )}
                <Pressable
                  onPress={() => {
                    if (editor && !editor.thought) openNextNewEditorImmediately();
                    else void openEditor();
                  }}
                  disabled={!!editor?.pending || addTransitionLockRef.current}
                  style={({ pressed }) => [
                    styles.addCardButton,
                    pressed && styles.buttonPressed,
                    (editor?.pending || addTransitionLockRef.current) && styles.buttonDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="새 단상 추가"
                  accessibilityState={{ disabled: !!editor?.pending || addTransitionLockRef.current }}
                >
                  <Feather name="plus" size={22} color={Colors.zinc500} />
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
        {showKeyboardToolbar && (
          <MemoToolbar
            mode="restricted"
            keyboardVisible={keyboardVisible}
            onDismissKeyboard={dismissEditorKeyboard}
          />
        )}
        <Animated.View style={{ height: inputPadAnim }} pointerEvents="none" />
        {!keyboardVisible && (
          <ScalePressable
            onPress={() => doCloseRef.current()}
            disabled={!!editor?.pending}
            hitSlop={8}
            scaleTo={0.9}
            style={[styles.closeButtonWrap, { bottom: insets.bottom + 24 }]}
            contentStyle={styles.closeButtonContent}
            accessibilityRole="button"
            accessibilityLabel="단상 창 닫기"
            accessibilityState={{ disabled: !!editor?.pending }}
          >
            <Feather name="x" size={22} color={Colors.zinc600} />
          </ScalePressable>
        )}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outerWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
      },
      android: { elevation: 12 },
      web: {
        boxShadow: "0 -6px 20px rgba(0,0,0,0.10)",
      } as object,
      default: {},
    }),
  },
  panel: {
    height: "100%",
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    flexDirection: "column",
  },
  header: {
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 4,
  },
  dragZone: {
    height: 26,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.zinc200,
    marginTop: 10,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  listWrap: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 4,
    paddingBottom: 84,
    gap: 10,
  },
  emptyWrap: {
    paddingVertical: 28,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: Colors.zinc500,
    fontFamily: "Pretendard-Regular",
  },
  card: {
    borderRadius: 16,
    padding: 16,
    gap: 7,
    backgroundColor: Colors.white,
    ...Shadows.card,
  },
  cardText: {
    color: Colors.zinc600,
    fontFamily: ReaderTokens.fontFamily.serif,
  },
  editorCard: {
    borderRadius: 16,
    padding: 16,
    gap: 7,
    backgroundColor: Colors.white,
    ...Shadows.card,
  },
  cardInput: {
    fontFamily: ReaderTokens.fontFamily.serif,
    color: Colors.zinc600,
    paddingHorizontal: 0,
    paddingTop: 4,
    paddingBottom: 4,
    textAlignVertical: "top",
    ...Platform.select({
      web: { outlineStyle: "none" } as object,
      default: {},
    }),
  },
  addCardButton: {
    width: "100%",
    height: 72,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Colors.zinc300,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonWrap: {
    position: "absolute",
    right: 20,
    width: 48,
    height: 48,
    zIndex: 5,
  },
  closeButtonContent: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.10,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
      web: { boxShadow: "0 2px 8px rgba(0,0,0,0.10)" } as object,
      default: {},
    }),
  },
  errorRow: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 6,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: "#dc2626",
    fontFamily: "Pretendard-Regular",
  },
  retryButton: {
    height: 32,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  retryText: {
    fontSize: 12,
    color: Colors.zinc700,
    textDecorationLine: "underline",
    fontFamily: "Pretendard-SemiBold",
    fontWeight: "600",
  },
});
