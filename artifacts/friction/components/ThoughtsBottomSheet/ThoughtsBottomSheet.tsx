/**
 * ThoughtsBottomSheet
 *
 * 읽기 화면 하단에서 슬라이드 업하는 단상 패널.
 * • 배경 딤 없음 — 편지는 그대로 보이고, 불투명 흰 패널이 하단을 덮는다.
 * • 키보드 오픈 시: bottom:0 유지, 패널 height 확장 + inputBar paddingBottom 동시 증가.
 *   → 인풋이 키보드 바로 위에 위치. 패널은 "슬라이드"가 아닌 "늘어남".
 * • 최대 높이 = screenHeight - safeTop (노치 침범 방지).
 * • TextInput 멀티라인, 내용에 따라 자동 높이 증가, returnKey = return.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
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
  useUpdateThought,
  useListThoughts,
} from "@workspace/api-client-react";
import type { Thought } from "@workspace/api-client-react";
import { Colors, Spacing } from "@/constants/tokens";

const PANEL_RATIO = 0.5;
/** 스와이프 1단계 중간 스냅 높이 비율 */
const PANEL_MID_RATIO = 0.5;
/** 노치/상단 안전 영역 아래 추가 여백 */
const SAFE_TOP_EXTRA = 8;
/** 키보드 애니메이션보다 빠르게 — 앞서서 끝나야 반응이 빠르게 느껴짐 */
const KB_ANIM_DURATION = 160;

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

function formatRelativeDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}일 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 좌 스와이프 시 노출되는 액션 버튼(편집/삭제) 전체 너비 */
const ACTION_WIDTH = 104;

interface SwipeableThoughtCardProps {
  thought: Thought;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onEdit: (thought: Thought) => void;
  onDelete: (id: string) => void;
}

function SwipeableThoughtCard({
  thought,
  openId,
  setOpenId,
  onEdit,
  onDelete,
}: SwipeableThoughtCardProps) {
  const [expanded, setExpanded] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = openId === thought.id;
  const isOpenRef = useRef(false);
  isOpenRef.current = isOpen;

  // 외부에서 다른 카드가 열리면 이 카드를 닫는다
  useEffect(() => {
    if (!isOpen) {
      Animated.spring(translateX, {
        toValue: 0,
        damping: 35,
        stiffness: 260,
        useNativeDriver: true,
      }).start();
    }
  }, [isOpen, translateX]);

  const snapTo = (open: boolean) => {
    const target = open ? -ACTION_WIDTH : 0;
    setOpenId(open ? thought.id : null);
    Animated.spring(translateX, {
      toValue: target,
      damping: 35,
      stiffness: 260,
      useNativeDriver: true,
    }).start();
  };

  const startXRef = useRef(0);
  const startOpenRef = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > Math.abs(gs.dy) && Math.abs(gs.dx) > 6,
      onPanResponderGrant: () => {
        startXRef.current = isOpenRef.current ? -ACTION_WIDTH : 0;
        startOpenRef.current = isOpenRef.current;
        translateX.stopAnimation();
      },
      onPanResponderMove: (_, gs) => {
        const raw = startXRef.current + gs.dx;
        // 오른쪽 스와이프는 0까지만, 왼쪽은 ACTION_WIDTH까지만
        const clamped = Math.max(-ACTION_WIDTH, Math.min(0, raw));
        translateX.setValue(clamped);
      },
      onPanResponderRelease: (_, gs) => {
        const currentOffset = startXRef.current + gs.dx;
        // 1/3.5 이상 열렸거나 충분한 속도면 열림으로 스냅, 아니면 닫힘
        const shouldOpen = currentOffset < -(ACTION_WIDTH / 3.5) || gs.vx < -0.3;
        snapTo(shouldOpen);
      },
      onPanResponderTerminate: () => {
        snapTo(startOpenRef.current);
      },
    }),
  ).current;

  const content = thought.content ?? "";
  const isLong = content.length > 100;

  const handleCardPress = () => {
    if (isOpen) {
      snapTo(false);
      return;
    }
    if (isLong) setExpanded((v) => !v);
  };

  return (
    <View style={styles.cardContainer}>
      {/* 액션 버튼: 카드 우측에 절대 배치, 클리핑 뒤에 숨겨진다 */}
      <View style={styles.actionBtns}>
        <Pressable
          style={[styles.actionBtn, styles.editBtn]}
          onPress={() => {
            snapTo(false);
            onEdit(thought);
          }}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Feather name="edit-2" size={17} color="#fff" />
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.deleteBtn]}
          onPress={() => {
            snapTo(false);
            onDelete(thought.id);
          }}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Feather name="trash-2" size={17} color="#fff" />
        </Pressable>
      </View>

      {/* 카드 텍스트 박스 — translateX로 밀림 */}
      <Animated.View
        style={[styles.cardSlide, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable onPress={handleCardPress} style={styles.card}>
          <Text style={styles.cardDate}>{formatRelativeDate(thought.createdAt)}</Text>
          <Text style={styles.cardText} numberOfLines={expanded ? undefined : 3}>
            {content}
          </Text>
          {isLong && !expanded && <Text style={styles.moreLink}>...더보기</Text>}
        </Pressable>
      </Animated.View>
    </View>
  );
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
  const { height: screenHeight } = useWindowDimensions();
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
  const keyboardVisibleRef = useRef(false);
  keyboardVisibleRef.current = keyboardVisible;
  /** 마지막으로 받은 키보드 높이 — 롱프레스 경로처럼 이미 열린 키보드로 진입 시 사용 */
  const lastKbHeightRef = useRef(0);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const listScrollYRef = useRef(0);

  /** 현재 열린 스와이프 카드 ID (하나만 열림) */
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  /** 편집 중인 단상 (null이면 새 단상 작성 모드) */
  const [editingThought, setEditingThought] = useState<Thought | null>(null);
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
  const createThought = useCreateThought();
  const updateThought = useUpdateThought();
  const deleteThought = useDeleteThought();

  const invalidateThoughts = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: getListThoughtsQueryKey({ sourceArticleId: articleId }),
    });
    queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() });
  }, [queryClient, articleId]);

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
      // 애니메이션 완료 후 일괄 초기화
      setEditingThought(null);
      setOpenCardId(null);
      setDeletedIds(new Set());
      setInputText("");
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
    setEditingThought(null);
    setOpenCardId(null);
    setDeletedIds(new Set());
  }, []);

  // ── Open ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (visible) {
      // 새 세션 시작 — 진행 중이던 close의 완료 콜백을 무효화한다.
      // (close 애니메이션 도중 FAB/롱프레스로 재오픈하는 경로)
      sessionTokenRef.current += 1;
      // 새 시트 세션 시작 — 이전 편집·스와이프 상태를 모두 초기화
      resetTransientState();
      setInputText(pendingQuote ?? "");
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

      if (pendingQuote) {
        setTimeout(() => inputRef.current?.focus(), 300);
      }
    }
    // openNonce도 dep에 포함: close 애니메이션 중 재오픈 시 visible이 계속 true라
    // false→true 전이가 없으므로, nonce 변화로 open 시퀀스를 다시 구동한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, openNonce]);

  // articleId가 바뀌면 (다른 글로 전환) 편집·스와이프 상태를 즉시 초기화한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (visible) resetTransientState(); }, [articleId]);

  useEffect(() => {
    if (visible && pendingQuote) {
      setInputText(pendingQuote);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuote]);

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isSending) return;
    setIsSending(true);
    try {
      // 편집 모드 가드: editingThought가 현재 articleId 소속인 경우만 PATCH 사용.
      // articleId가 바뀐 뒤 잔류한 stale editingThought를 PATCH하는 cross-context 버그를 방지.
      const isValidEdit =
        editingThought != null &&
        (articleId
          ? editingThought.sourceArticleId === articleId
          : editingThought.sourceArticleId == null);

      if (isValidEdit && editingThought) {
        await updateThought.mutateAsync({
          id: editingThought.id,
          data: { content: text },
        });
        setEditingThought(null);
      } else {
        // 잘못된 편집 상태가 남아있으면 조용히 초기화 후 새 단상으로 저장
        if (editingThought) setEditingThought(null);
        if (articleId) {
          // 글 읽기 화면 컨텍스트: sourceArticleId 포함
          await createThought.mutateAsync({
            data: { content: text, createdFrom: "reading", sourceArticleId: articleId },
          });
        } else {
          // 단상 탭 FAB 컨텍스트: sourceArticleId 없이 direct 단상으로 저장
          await createThought.mutateAsync({
            data: { content: text, createdFrom: "direct" },
          });
        }
      }
      invalidateThoughts();
      setInputText("");
    } catch (e) {
      console.warn("[ThoughtsBottomSheet] save failed:", e);
    } finally {
      setIsSending(false);
    }
  }, [inputText, isSending, editingThought, updateThought, createThought, articleId, invalidateThoughts]);

  // ── Edit / Delete handlers ────────────────────────────────────────────────

  const handleEdit = useCallback((thought: Thought) => {
    setEditingThought(thought);
    setInputText(thought.content ?? "");
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    // Optimistic: 즉시 목록에서 숨기기
    setDeletedIds((prev) => new Set([...prev, id]));
    try {
      await deleteThought.mutateAsync({ id });
      invalidateThoughts();
    } catch (e) {
      // 실패 시 복원
      setDeletedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      console.warn("[ThoughtsBottomSheet] delete failed:", e);
    }
  }, [deleteThought, invalidateThoughts]);

  const cancelEdit = useCallback(() => {
    setEditingThought(null);
    setInputText("");
    Keyboard.dismiss();
  }, []);

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
        {/* ── Drag handle + title ─────────────────────────────────────── */}
        <View style={styles.header} {...handlePan.panHandlers}>
          <View style={styles.handle} />
          <Text style={styles.title}>단상</Text>
        </View>

        {/* ── Thought list ─────────────────────────────────────────────── */}
        <View style={styles.listWrap} {...listPan.panHandlers}>
          <ScrollView
            style={styles.scroll}
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
            ) : thoughts.filter((t) => !deletedIds.has(t.id)).length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>아직 단상이 없어요</Text>
              </View>
            ) : (
              thoughts
                .filter((t) => !deletedIds.has(t.id))
                .map((t) => (
                  <SwipeableThoughtCard
                    key={t.id}
                    thought={t}
                    openId={openCardId}
                    setOpenId={setOpenCardId}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                ))
            )}
          </ScrollView>
        </View>

        {/* ── Persistent input bar ─────────────────────────────────────── */}
        {/* paddingBottom 애니메이션: 키보드 높이만큼 인풋을 키보드 위로 밀어 올림 */}
        <Animated.View
          style={[
            styles.inputBar,
            { paddingBottom: inputPadAnim },
          ]}
        >
          {/* 편집 모드 인디케이터 */}
          {editingThought && (
            <View style={styles.editingBanner}>
              <Text style={styles.editingLabel}>편집 중</Text>
              <Pressable
                onPress={cancelEdit}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={15} color={Colors.zinc500} />
              </Pressable>
            </View>
          )}
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder={editingThought ? "단상 수정하기..." : "새 단상 작성하기..."}
              placeholderTextColor={Colors.zinc400}
              multiline
              returnKeyType="default"
            />
            {inputText.trim().length > 0 && (
              <Pressable
                onPress={handleSend}
                disabled={isSending}
                style={({ pressed }) => [styles.sendBtn, pressed && { opacity: 0.6 }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {isSending ? (
                  <ActivityIndicator size="small" color={Colors.zinc500} />
                ) : (
                  <Feather name="arrow-up-circle" size={28} color={Colors.zinc800} />
                )}
              </Pressable>
            )}
          </View>
        </Animated.View>
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
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.zinc200,
    marginTop: 10,
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontFamily: "Pretendard-SemiBold",
    fontWeight: "600",
    color: Colors.zinc900,
    letterSpacing: -0.3,
    textAlign: "center",
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
    paddingBottom: 12,
    gap: 10,
  },
  emptyWrap: {
    paddingVertical: 28,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: Colors.zinc400,
    fontFamily: "Pretendard-Regular",
  },
  cardContainer: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 12,
  },
  cardSlide: {
    // 카드 텍스트 박스 — translateX 로 밀려남
    // flex:1로 cardContainer 전체 너비를 채우고, 배경색을 여기에 두어
    // borderRadius 없는 직사각형으로 버튼 영역을 완전히 덮/가린다.
    // (borderRadius는 cardContainer의 overflow:hidden이 처리)
    flex: 1,
    backgroundColor: Colors.zinc50,
  },
  actionBtns: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: ACTION_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  actionBtn: {
    width: ACTION_WIDTH / 2 - 4,
    height: ACTION_WIDTH / 2 - 4,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  editBtn: {
    backgroundColor: Colors.zinc600,
  },
  deleteBtn: {
    backgroundColor: "#ef4444",
  },
  card: {
    borderRadius: 12,
    padding: 14,
    gap: 5,
  },
  cardDate: {
    fontSize: 12,
    color: Colors.zinc500,
    fontFamily: "Pretendard-Regular",
  },
  cardText: {
    fontSize: 14,
    color: Colors.zinc700,
    lineHeight: 21,
    fontFamily: "Pretendard-Regular",
  },
  moreLink: {
    fontSize: 13,
    color: Colors.zinc400,
    fontFamily: "Pretendard-Regular",
  },
  inputBar: {
    flexDirection: "column",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 8,
    gap: 4,
    backgroundColor: Colors.white,
  },
  editingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  editingLabel: {
    fontSize: 12,
    color: Colors.zinc600,
    fontFamily: "Pretendard-SemiBold",
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    color: Colors.zinc800,
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 14,
    backgroundColor: Colors.zinc100,
    borderRadius: 16,
    minHeight: 40,
    maxHeight: 160,
    textAlignVertical: "top",
  },
  sendBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
});
