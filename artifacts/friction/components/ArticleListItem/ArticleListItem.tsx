import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
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
  isRead?: boolean;
  rightMeta?: string;
}

const STATUS_BADGE_COLORS: Record<ArticleStatus, { bg: string; text: string }> = {
  DRAFT: { bg: Colors.zinc200, text: Colors.zinc600 },
  DIVIDING: { bg: "#DBEAFE", text: "#2563EB" },
  CLOSING: { bg: "#FEF3C7", text: "#D97706" },
  LETTER: { bg: "#D1FAE5", text: "#059669" },
};

export default function ArticleListItem({
  title,
  onPress,
  preview,
  author,
  timestamp,
  statusBadge,
  isRead,
  rightMeta,
}: ArticleListItemProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {rightMeta && <Text style={styles.rightMeta}>{rightMeta}</Text>}
        </View>
        {preview && (
          <Text style={styles.preview} numberOfLines={1}>
            {preview}
          </Text>
        )}
        <View style={styles.metaRow}>
          {author && <Text style={styles.metaText}>{author.name}</Text>}
          {timestamp && <Text style={styles.metaText}>{formatDate(timestamp)}</Text>}
          {statusBadge && (
            <View style={[styles.badge, { backgroundColor: STATUS_BADGE_COLORS[statusBadge].bg }]}>
              <Text style={[styles.badgeText, { color: STATUS_BADGE_COLORS[statusBadge].text }]}>
                {statusBadge === "DRAFT" ? "작성 중" : statusBadge === "DIVIDING" ? "분할 중" : statusBadge === "CLOSING" ? "마감 중" : "완성"}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function formatDate(date: Date): string {
  const m = (date.getMonth() + 1).toString();
  const d = date.getDate().toString();
  return `${m}/${d}`;
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 14,
    backgroundColor: Colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  pressed: {
    backgroundColor: Colors.zinc50,
  },
  content: {
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
    color: Colors.zinc400,
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
    color: Colors.zinc400,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
});
