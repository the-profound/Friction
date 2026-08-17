import React from "react";
import { View, Text, StyleSheet, Platform, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography } from "@/constants/tokens";
import type { ThoughtCreatedFrom } from "@workspace/api-client-react";

const CREATED_FROM_LABEL: Record<ThoughtCreatedFrom, string> = {
  quoted: "인용",
  question: "질문",
  reading: "메모",
  direct: "직접",
};

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
  content: string | null | undefined;
  createdFrom: ThoughtCreatedFrom;
  createdAt: string;
  /** Height of each pager slot — must match FlatList item height */
  slotHeight: number;
  /** Whether this card is the first in the list (hide up-hint) */
  isFirst?: boolean;
  /** Whether this card is the last in the list (hide down-hint) */
  isLast?: boolean;
  /** Tap handler — enters inline edit mode */
  onPress?: () => void;
}

const CARD_MARGIN_H = 36;
/** Vertical margin as fraction of slotHeight — gives ~60% card height */
const CARD_MARGIN_V_RATIO = 0.20;

export default function ThoughtCard({
  content,
  createdFrom,
  createdAt,
  slotHeight,
  isFirst,
  isLast,
  onPress,
}: ThoughtCardProps) {
  const cardMarginV = slotHeight * CARD_MARGIN_V_RATIO;

  return (
    <Pressable
      onPress={onPress}
      android_ripple={null}
      style={[styles.slot, { height: slotHeight }]}
    >
      {/* Up-navigation hint */}
      {!isFirst && (
        <View style={styles.hintAbove} pointerEvents="none">
          <Feather name="chevron-up" size={18} color={Colors.zinc300} />
        </View>
      )}

      {/* Shadow layer — separated from content to avoid re-rasterization at scale */}
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
        <View style={styles.topRow}>
          <View style={styles.tag}>
            <Text style={styles.tagText} allowFontScaling={false}>
              {CREATED_FROM_LABEL[createdFrom]}
            </Text>
          </View>
          <Text style={styles.dateText} allowFontScaling={false}>
            {formatRelativeDate(createdAt)}
          </Text>
        </View>
        <Text style={styles.contentText}>
          {content ?? ""}
        </Text>
      </View>

      {/* Down-navigation hint */}
      {!isLast && (
        <View style={styles.hintBelow} pointerEvents="none">
          <Feather name="chevron-down" size={18} color={Colors.zinc300} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: {
    alignItems: "center",
    justifyContent: "center",
  },
  hintAbove: {
    position: "absolute",
    top: 6,
    left: 0,
    right: 0,
    alignItems: "center",
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
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  tag: {
    backgroundColor: Colors.zinc100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: Platform.select({ ios: "Pretendard-SemiBold", default: "Pretendard-SemiBold" }),
    color: Colors.zinc500,
  },
  dateText: {
    ...Typography.caption,
    color: Colors.zinc500,
  },
  contentText: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc800,
    lineHeight: 26,
  },
});
