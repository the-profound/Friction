import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { Platform } from "react-native";
import {
  buildDateSnapOffsets,
  findNearestDateSnapOffset,
} from "@/lib/dateGroupCarousel";

interface UseDateGroupSnapOptions {
  /** Ordered keys for date groups only; special headers are intentionally omitted. */
  dateKeys: readonly string[];
}

/**
 * Makes vertical date snapping follow measured group/header positions rather
 * than a guessed, fixed group height. It also keeps a short post-scroll press
 * guard for React Native Web's trailing click behavior.
 */
export function useDateGroupSnap<T>({ dateKeys }: UseDateGroupSnapOptions) {
  const listRef = useRef<FlatList<T>>(null);
  const measuredOffsetsRef = useRef(new Map<string, number>());
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressGuardRef = useRef(false);
  const [snapOffsets, setSnapOffsets] = useState<number[]>([]);
  const dateKeysSignature = useMemo(() => dateKeys.join("|"), [dateKeys]);

  const rebuildSnapOffsets = useCallback(() => {
    const next = buildDateSnapOffsets(dateKeys, measuredOffsetsRef.current);
    setSnapOffsets((current) =>
      current.length === next.length && current.every((value, index) => value === next[index])
        ? current
        : next,
    );
  }, [dateKeys]);

  const onDateGroupLayout = useCallback(
    (dateKey: string) => (event: LayoutChangeEvent) => {
      // The group wrapper begins with the shared date header, so this is the
      // header's actual top edge even when the cards have variable heights.
      const offset = Math.round(event.nativeEvent.layout.y);
      if (measuredOffsetsRef.current.get(dateKey) === offset) return;
      measuredOffsetsRef.current.set(dateKey, offset);
      rebuildSnapOffsets();
    },
    [rebuildSnapOffsets],
  );

  useEffect(() => {
    const keys = new Set(dateKeys);
    for (const key of measuredOffsetsRef.current.keys()) {
      if (!keys.has(key)) measuredOffsetsRef.current.delete(key);
    }
    rebuildSnapOffsets();
  }, [dateKeysSignature, rebuildSnapOffsets]);

  const snapToNearestDate = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // iOS/Android ScrollView owns its own velocity-aware snapToOffsets settling.
    // Correcting at drag-end would stop a fast fling before it reaches the next
    // date. Web has no equivalent reliable native snap, so it uses this fallback.
    if (Platform.OS !== "web") return;
    const currentOffset = event.nativeEvent.contentOffset.y;
    if (currentOffset <= 0) return;
    const targetOffset = findNearestDateSnapOffset(currentOffset, snapOffsets);
    if (targetOffset !== null && Math.abs(targetOffset - currentOffset) > 1) {
      listRef.current?.scrollToOffset({ offset: targetOffset, animated: true });
    }
  }, [snapOffsets]);

  const scheduleWebDateSnap = useCallback((offset: number) => {
    if (Platform.OS !== "web") return;
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    snapTimerRef.current = setTimeout(() => {
      snapTimerRef.current = null;
      if (offset <= 0) return;
      const targetOffset = findNearestDateSnapOffset(offset, snapOffsets);
      if (targetOffset !== null && Math.abs(targetOffset - offset) > 1) {
        listRef.current?.scrollToOffset({ offset: targetOffset, animated: true });
      }
    }, 110);
  }, [snapOffsets]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    pressGuardRef.current = true;
    if (pressGuardTimerRef.current) clearTimeout(pressGuardTimerRef.current);
    pressGuardTimerRef.current = setTimeout(() => {
      pressGuardRef.current = false;
      pressGuardTimerRef.current = null;
    }, 180);
    scheduleWebDateSnap(event.nativeEvent.contentOffset.y);
  }, [scheduleWebDateSnap]);

  useEffect(() => () => {
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    if (pressGuardTimerRef.current) clearTimeout(pressGuardTimerRef.current);
  }, []);

  return {
    listRef,
    snapOffsets,
    onDateGroupLayout,
    onScroll,
    onMomentumScrollEnd: snapToNearestDate,
    onScrollEndDrag: snapToNearestDate,
    shouldIgnoreVerticalPress: () => pressGuardRef.current,
  };
}