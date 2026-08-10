import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Colors, Typography, Spacing } from "@/constants/tokens";
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
}

export default function ThoughtCard({ content, createdFrom, createdAt, slotHeight }: ThoughtCardProps) {
  return (
    <View style={[styles.slot, { height: slotHeight }]}>
      {/* Shadow layer — separated from content to avoid re-rasterization at scale */}
      <View style={styles.cardShadow} pointerEvents="none" />
      {/* Content surface */}
      <View style={styles.cardSurface}>
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
    </View>
  );
}

const CARD_MARGIN_H = 32;
const CARD_MARGIN_V = 32;

const styles = StyleSheet.create({
  slot: {
    alignItems: "center",
    justifyContent: "center",
  },
  cardShadow: {
    position: "absolute",
    top: CARD_MARGIN_V,
    left: CARD_MARGIN_H,
    right: CARD_MARGIN_H,
    bottom: CARD_MARGIN_V,
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
    top: CARD_MARGIN_V,
    left: CARD_MARGIN_H,
    right: CARD_MARGIN_H,
    bottom: CARD_MARGIN_V,
    backgroundColor: Colors.white,
    borderRadius: 4,
    paddingHorizontal: 28,
    paddingVertical: 28,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
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
    color: Colors.zinc400,
  },
  contentText: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc800,
    lineHeight: 26,
  },
});
