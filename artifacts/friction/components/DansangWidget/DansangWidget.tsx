import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors } from "@/constants/tokens";
import {
  useGetThoughtsWidget,
  getGetThoughtsWidgetQueryKey,
} from "@workspace/api-client-react";

interface DansangWidgetProps {
  /** Height of each pager slot — must match FlatList item height */
  slotHeight: number;
  /** Whether there are thought cards below (show down-hint) */
  hasThoughts?: boolean;
  /** Whether this widget slot is currently visible (controls fetch activation) */
  visible?: boolean;
  /** Called when the user taps the write button */
  onWritePress?: () => void;
}

const CARD_MARGIN_H = 36;
/** Vertical margin as fraction of slotHeight — gives a taller card (~80% height) than ThoughtCard (60%) */
const CARD_MARGIN_V_RATIO = 0.10;

/** 1-hour stale time per Notion document spec: regenerate only after 1 hour */
const WIDGET_STALE_MS = 60 * 60 * 1000;

export default function DansangWidget({
  slotHeight,
  hasThoughts,
  visible = false,
  onWritePress,
}: DansangWidgetProps) {
  const cardMarginV = slotHeight * CARD_MARGIN_V_RATIO;

  const { data, isLoading } = useGetThoughtsWidget({
    query: {
      enabled: visible,
      queryKey: getGetThoughtsWidgetQueryKey(),
      staleTime: WIDGET_STALE_MS,
      gcTime: WIDGET_STALE_MS,
    },
  });

  const question = data?.question ?? null;
  const subtext = data?.subtext ?? null;
  const hasContent = !!question && !!subtext;

  return (
    <View style={[styles.slot, { height: slotHeight }]}>
      {/* Shadow layer — separated from content to avoid re-rasterization */}
      <View
        style={[
          styles.cardShadow,
          { top: cardMarginV, bottom: cardMarginV, left: CARD_MARGIN_H, right: CARD_MARGIN_H },
        ]}
        pointerEvents="none"
      />

      {/* Content surface */}
      <View
        style={[
          styles.cardSurface,
          { top: cardMarginV, bottom: cardMarginV, left: CARD_MARGIN_H, right: CARD_MARGIN_H },
        ]}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.zinc300} />
        ) : hasContent ? (
          <View style={styles.contentWrap}>
            {/* Widget type label */}
            <Text style={styles.label} allowFontScaling={false} numberOfLines={1}>
              아직 끝나지 않은 생각
            </Text>

            {/* AI-generated question */}
            <Text style={styles.question} allowFontScaling={false}>
              {question}
            </Text>

            {/* Sub-explanation */}
            <View style={styles.subtextBanner}>
              <Text style={styles.subtextText} allowFontScaling={false} numberOfLines={2}>
                {subtext}
              </Text>
            </View>

            {/* Write CTA button */}
            <Pressable
              style={({ pressed }) => [styles.writeButton, pressed && styles.writeButtonPressed]}
              onPress={onWritePress}
              hitSlop={8}
            >
              <Text style={styles.writeButtonText} allowFontScaling={false}>
                이 질문에 답해보기
              </Text>
            </Pressable>
          </View>
        ) : (
          /* Fallback state: no thoughts yet or AI unavailable — still show a write prompt */
          <View style={styles.contentWrap}>
            <Text style={styles.label} allowFontScaling={false} numberOfLines={1}>
              첫 단상을 남겨보세요
            </Text>
            <Text style={styles.fallbackText} allowFontScaling={false}>
              오늘 스쳐 지나간 생각을{"\n"}짧게라도 적어두세요.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.writeButton, pressed && styles.writeButtonPressed]}
              onPress={onWritePress}
              hitSlop={8}
            >
              <Text style={styles.writeButtonText} allowFontScaling={false}>
                단상 쓰기
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Down-navigation hint */}
      {hasThoughts !== false && (
        <View style={styles.hintBelow} pointerEvents="none">
          <Feather name="chevron-down" size={18} color={Colors.zinc300} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    alignItems: "center",
    justifyContent: "center",
  },
  hintBelow: {
    position: "absolute",
    bottom: 6,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  cardShadow: {
    position: "absolute",
    backgroundColor: Colors.white,
    borderRadius: 4,
    ...Platform.select({
      web: {
        boxShadow: "0 6px 44px rgba(0,0,0,0.18), 0 1px 8px rgba(0,0,0,0.1)",
      } as object,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 5,
      },
    }),
  },
  cardSurface: {
    position: "absolute",
    backgroundColor: Colors.white,
    borderRadius: 4,
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  contentWrap: {
    width: "100%",
    alignItems: "flex-start",
    gap: 12,
  },
  label: {
    fontSize: 11,
    color: Colors.zinc400,
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard-Regular",
    }),
    letterSpacing: 0.2,
  },
  question: {
    fontSize: 17,
    color: Colors.zinc800,
    fontFamily: Platform.select({
      ios: "Pretendard-Medium",
      default: "Pretendard-Medium",
    }),
    lineHeight: 26,
  },
  subtextBanner: {
    width: "100%",
    backgroundColor: "#FFE066",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  subtextText: {
    fontSize: 13,
    color: Colors.zinc800,
    fontFamily: Platform.select({
      ios: "Pretendard-ExtraLight",
      default: "Pretendard-ExtraLight",
    }),
    lineHeight: 20,
  },
  fallbackText: {
    fontSize: 15,
    color: Colors.zinc500,
    fontFamily: Platform.select({
      ios: "Pretendard-ExtraLight",
      default: "Pretendard-ExtraLight",
    }),
    lineHeight: 24,
  },
  writeButton: {
    alignSelf: "flex-start",
    backgroundColor: Colors.zinc100,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  writeButtonPressed: {
    opacity: 0.7,
  },
  writeButtonText: {
    fontSize: 13,
    color: Colors.zinc600,
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard-Regular",
    }),
  },
});
