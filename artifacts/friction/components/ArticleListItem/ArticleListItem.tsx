import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Typography, Spacing } from "../../constants/tokens";
import type { ArticleStatus } from "../../lib/policies";

interface Author {
  name: string;
  avatarUrl?: string;
}

interface ArticleListItemProps {
  title: string;
  onPress: () => void;
  preview?: string;
  author?: Author;
  timestamp?: Date;
  statusBadge?: ArticleStatus;
  deliveryBadge?: "sent" | "scheduled";
  isRead?: boolean;
  rightMeta?: string;
  coverImageUrl?: string;
}

const STATUS_BADGE_COLORS: Record<ArticleStatus, { bg: string; text: string }> = {
  DRAFT: { bg: Colors.zinc200, text: Colors.zinc600 },
  DIVIDING: { bg: "#e4b4b9", text: Colors.zinc700 },
  CLOSING: { bg: "#d17b85", text: "#333336" },
  LETTER: { bg: "#D1FAE5", text: "#059669" },
};

const DELIVERY_BADGE_COLORS = {
  sent: { bg: "#DBEAFE", text: "#1D4ED8" },
  scheduled: { bg: "#FEF9C3", text: "#92400E" },
};

function ArticleListItem({
  title,
  onPress,
  preview,
  author,
  timestamp,
  statusBadge,
  deliveryBadge,
  isRead,
  rightMeta,
  coverImageUrl,
}: ArticleListItemProps) {
  return (
    <ScalePressable
      onPress={onPress}
      style={styles.container}
      contentStyle={styles.containerContent}
    >
      {({ pressed }) => (
      <>
      {pressed ? <View style={styles.pressed} pointerEvents="none" /> : null}
      <View style={styles.inner}>
        <View style={styles.content}>
          <View style={styles.topRow}>
            <Text style={styles.title} numberOfLines={3}>
              {title}
            </Text>
            {rightMeta ? <Text style={styles.rightMeta}>{rightMeta}</Text> : null}
          </View>
          {preview ? (
            <Text style={styles.preview} numberOfLines={1}>
              {preview}
            </Text>
          ) : null}
          <View style={styles.metaRow}>
            {author ? <Text style={styles.metaText}>{author.name}</Text> : null}
            {timestamp ? <Text style={styles.metaText}>{formatDate(timestamp)}</Text> : null}
            {statusBadge ? (
              <View style={[styles.badge, { backgroundColor: STATUS_BADGE_COLORS[statusBadge].bg }]}>
                <Text style={[styles.badgeText, { color: STATUS_BADGE_COLORS[statusBadge].text }]}>
                  {statusBadge === "DRAFT" ? "작성 중" : statusBadge === "DIVIDING" ? "검토 중" : statusBadge === "CLOSING" ? "마감 중" : "완성"}
                </Text>
              </View>
            ) : null}
            {deliveryBadge ? (
              <View style={[styles.badge, { backgroundColor: DELIVERY_BADGE_COLORS[deliveryBadge].bg }]}>
                <Text style={[styles.badgeText, { color: DELIVERY_BADGE_COLORS[deliveryBadge].text }]}>
                  {deliveryBadge === "sent" ? "발신됨" : "발신 예정"}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        {coverImageUrl ? (
          <Image
            source={{ uri: coverImageUrl }}
            style={styles.coverThumbnail}
            resizeMode="cover"
          />
        ) : null}
      </View>
      </>
      )}
    </ScalePressable>
  );
}

export default React.memo(ArticleListItem);

function formatDate(date: Date): string {
  const m = (date.getMonth() + 1).toString();
  const d = date.getDate().toString();
  return `${m}/${d}`;
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  containerContent: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 14,
    backgroundColor: Colors.white,
  },
  pressed: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.zinc50,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    flex: 1,
  },
  rightMeta: {
    ...Typography.caption,
    color: Colors.zinc500,
    marginLeft: 8,
  },
  preview: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  metaText: {
    ...Typography.caption,
    color: Colors.zinc500,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  coverThumbnail: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: Colors.zinc100,
    flexShrink: 0,
  },
});
