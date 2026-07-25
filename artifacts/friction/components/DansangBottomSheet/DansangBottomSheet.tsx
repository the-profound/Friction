/**
 * DansangBottomSheet
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

interface ThoughtCardProps {
  thought: Thought;
}

function ThoughtCard({ thought }: ThoughtCardProps) {
  const [expanded, setExpanded] = useState(false);
  const content = thought.content ?? "";
  const isLong = content.length > 100;
  return (
    <Pressable
      onPress={() => { if (isLong) setExpanded((v) => !v); }}
      style={styles.card}
    >
      <Text style={styles.cardDate}>{formatRelativeDate(thought.createdAt)}</Text>
      <Text style={styles.cardText} numberOfLines={expanded ? undefined : 3}>
        {content}
      </Text>
      {isLong && !expanded && <Text style={styles.moreLink}>...더보기</Text>}
    </Pressable>
  );
}

export interface DansangBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  articleId: string;
  pendingQuote?: string;
  effectiveSheetHeightAnim?: Animated.Value;
  /** 외부에서 애니메이션 close를 트리거하기 위한 ref. 배경 탭 해제 등에서 사용. */
  closeHandleRef?: React.MutableRefObject<(() => void) | null>;
}

export default function DansangBottomSheet({
  visible,
  onClose,
  articleId,
  pendingQuote,
  effectiveSheetHeightAnim,
  closeHandleRef,
}: DansangBottomSheetProps) {
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

  // ── Effective sheet height exposure ──────────────────────────────────────
  // slideAnim uses useNativeDriver:true — addListener on it is unreliable
  // during native spring animations (JS callbacks may be skipped entirely).
  // Instead, we drive effectiveSheetHeightAnim explicitly in parallel with
  // every animation/setValue that changes the panel's visible height.
  //
  // outerHListenRef: tracks outerHeightAnim (non-native, listener always fires)
  // so PanResponder closures can read the current outer height synchronously.
  const outerHListenRef = useRef(defaultPanelHeight);
  // effectiveSheetHeightAnimRef: stable ref to the prop so PanResponder
  // closures (created once) always access the latest value.
  const effectiveSheetHeightAnimRef = useRef(effectiveSheetHeightAnim);
  effectiveSheetHeightAnimRef.current = effectiveSheetHeightAnim;

  useEffect(() => {
    const sub = outerHeightAnim.addListener(({ value }) => {
      outerHListenRef.current = value;
    });
    return () => outerHeightAnim.removeListener(sub);
  }, [outerHeightAnim]);

  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const listScrollYRef = useRef(0);

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
      const animations: Animated.CompositeAnimation[] = [
        Animated.timing(outerHeightAnim, { toValue: toHeight, ...timingBase }),
        Animated.timing(inputPadAnim, { toValue: toPad, ...timingBase }),
      ];
      if (effectiveSheetHeightAnim) {
        animations.push(Animated.timing(effectiveSheetHeightAnim, { toValue: toHeight, ...timingBase }));
      }
      return Animated.parallel(animations);
    },
    [outerHeightAnim, inputPadAnim, effectiveSheetHeightAnim],
  );

  useEffect(() => {
    // iOS: keyboardWillShow fires before keyboard appears → can animate in sync
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (e) => {
      const kh = e.endCoordinates.height;
      const targetH = Math.min(defaultPanelHeight + kh, maxPanelHeight);
      snapStageRef.current = "full";
      setKeyboardVisible(true);
      animKbOptions(targetH, kh + 8).start();
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      // outerHeightAnim은 건드리지 않음 — 패널은 전체 확장 상태 유지
      // (키보드가 올라오면서 커진 패널은 키보드가 내려가도 그대로 유지)
      Animated.timing(inputPadAnim, {
        toValue: restPadRef.current,
        duration: KB_ANIM_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    });

    return () => { showSub.remove(); hideSub.remove(); };
  }, [animKbOptions, defaultPanelHeight, maxPanelHeight]);

  // ── Close ─────────────────────────────────────────────────────────────────

  const doClose = useCallback(() => {
    Keyboard.dismiss();
    const springBase = { damping: 32, stiffness: 400 };
    const animations: Animated.CompositeAnimation[] = [
      Animated.spring(slideAnimRef.current, { toValue: screenHeight, ...springBase, useNativeDriver: true }),
    ];
    if (effectiveSheetHeightAnim) {
      animations.push(Animated.spring(effectiveSheetHeightAnim, { toValue: 0, ...springBase, useNativeDriver: false }));
    }
    Animated.parallel(animations).start(({ finished }) => {
      if (finished) {
        setInputText("");
        onClose();
      }
    });
  }, [screenHeight, onClose, effectiveSheetHeightAnim]);

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

  // ── Open ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (visible) {
      setInputText(pendingQuote ?? "");
      snapStageRef.current = "full";
      outerHeightAnim.setValue(defaultPanelHeight);
      inputPadAnim.setValue(restPadRef.current);
      slideAnim.setValue(defaultPanelHeight);
      effectiveSheetHeightAnim?.setValue(0);
      const springBase = { damping: 28, stiffness: 220 };
      const animations: Animated.CompositeAnimation[] = [
        Animated.spring(slideAnim, { toValue: 0, ...springBase, useNativeDriver: true }),
      ];
      if (effectiveSheetHeightAnim) {
        animations.push(Animated.spring(effectiveSheetHeightAnim, { toValue: defaultPanelHeight, ...springBase, useNativeDriver: false }));
      }
      Animated.parallel(animations).start();
      if (pendingQuote) {
        setTimeout(() => inputRef.current?.focus(), 300);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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
      await createThought.mutateAsync({
        data: { content: text, createdFrom: "reading", sourceArticleId: articleId },
      });
      invalidateThoughts();
      setInputText("");
    } catch (e) {
      console.warn("[DansangBottomSheet] save failed:", e);
    } finally {
      setIsSending(false);
    }
  }, [inputText, isSending, createThought, articleId, invalidateThoughts]);

  // ── Handle-bar pan responder ──────────────────────────────────────────────

  // ── 공용 스냅-백 spring ───────────────────────────────────────────────────

  const springBack = () => {
    const springBase = { damping: 32, stiffness: 400 };
    const animations: Animated.CompositeAnimation[] = [
      Animated.spring(slideAnimRef.current, { toValue: 0, ...springBase, useNativeDriver: true }),
    ];
    const eff = effectiveSheetHeightAnimRef.current;
    if (eff) {
      animations.push(Animated.spring(eff, { toValue: outerHListenRef.current, ...springBase, useNativeDriver: false }));
    }
    Animated.parallel(animations).start();
  };

  // ── 리스트 스와이프 release 로직 ─────────────────────────────────────────
  //   드래그 거리·속도 기반으로 full/mid/close 직접 결정 (강제 2단계 없음)

  const onSwipeRelease = (gs: { dy: number; vy: number }) => {
    if (gs.dy > SWIPE_CLOSE_DY || gs.vy > SWIPE_CLOSE_VEL) {
      const currentH = Math.max(0, outerHListenRef.current - gs.dy);
      const target = getSnapTarget(
        currentH, gs.vy,
        maxPanelHeightRef.current, midPanelHeightRef.current,
      );
      if (target <= 0) {
        doCloseRef.current();
      } else {
        snapStageRef.current = target >= maxPanelHeightRef.current * 0.9 ? "full" : "mid";
        const springBase = { damping: 28, stiffness: 220 };
        const animations: Animated.CompositeAnimation[] = [
          Animated.spring(slideAnimRef.current, { toValue: 0, ...springBase, useNativeDriver: true }),
          Animated.spring(outerHeightAnim, { toValue: target, ...springBase, useNativeDriver: false }),
        ];
        const eff = effectiveSheetHeightAnimRef.current;
        if (eff) animations.push(Animated.spring(eff, { toValue: target, ...springBase, useNativeDriver: false }));
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
    const animations: Animated.CompositeAnimation[] = [
      Animated.spring(outerHeightAnim, { toValue: target, ...springBase }),
    ];
    const eff = effectiveSheetHeightAnimRef.current;
    if (eff) animations.push(Animated.spring(eff, { toValue: target, ...springBase }));
    Animated.parallel(animations).start();
  };
  const snapToHeightRef = useRef(snapToHeight);
  snapToHeightRef.current = snapToHeight;

  const handlePan = useRef(
    PanResponder.create({
      // 핸들바는 터치 시작부터 제스처를 소유 → onPanResponderGrant 보장
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // 진행 중인 spring을 중단하고 현재 위치를 드래그 시작점으로 캡처
        outerHeightAnim.stopAnimation((stoppedValue) => {
          startHeightRef.current = stoppedValue;
          currentDragHeightRef.current = stoppedValue;
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
        effectiveSheetHeightAnimRef.current?.setValue(newH);
      },
      onPanResponderRelease: (_, gs) => {
        // currentDragHeightRef: move에서 직접 기록한 값 — _value 내부 API 불필요
        // full 스냅 목표 = maxPanelHeight (키보드 확장 시와 동일한 노치 근처 높이)
        const target = getSnapTarget(
          currentDragHeightRef.current, gs.vy,
          maxPanelHeightRef.current, midPanelHeightRef.current,
        );
        snapToHeightRef.current(target);
      },
      onPanResponderTerminate: () => {
        const target = getSnapTarget(
          currentDragHeightRef.current, 0,
          maxPanelHeightRef.current, midPanelHeightRef.current,
        );
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
        const eff = effectiveSheetHeightAnimRef.current;
        if (eff) eff.setValue(Math.max(0, outerHListenRef.current - dy));
      },
      onPanResponderRelease: (_, gs) => { onSwipeReleaseRef.current(gs); },
      onPanResponderTerminate: () => { springBack(); },
    }),
  ).current;

  if (!visible) return null;

  return (
    // Outer: non-native — height 신축
    <Animated.View style={[styles.outerWrap, { height: outerHeightAnim }]}>
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
            ) : thoughts.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>아직 단상이 없어요</Text>
              </View>
            ) : (
              thoughts.map((t) => <ThoughtCard key={t.id} thought={t} />)
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
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="새 단상 작성하기..."
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
  card: {
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
    padding: 14,
    gap: 5,
  },
  cardDate: {
    fontSize: 11,
    color: Colors.zinc400,
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
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 8,
    gap: 8,
    backgroundColor: Colors.white,
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
