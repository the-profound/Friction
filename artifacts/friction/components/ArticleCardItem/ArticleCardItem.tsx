import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Colors, Typography, Sizing } from "../../constants/tokens";

interface Author {
  name: string;
  avatarUrl?: string;
}

interface ArticleCardItemProps {
  title: string;
  onPress: () => void;
  preview?: string;
  author?: Author;
  timestamp?: Date;
  isRead?: boolean;
  isActive?: boolean;
}

export default function ArticleCardItem({
  title,
  onPress,
  preview,
  author,
  timestamp,
  isRead = false,
  isActive = true,
}: ArticleCardItemProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        !isActive && styles.inactive,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.inner}>
        {author && (
          <Text style={[styles.author, isRead && styles.readText]} numberOfLines={1}>
            {author.name}
          </Text>
        )}
        <Text style={[styles.title, isRead && styles.readText]} numberOfLines={1}>
          {title}
        </Text>
        {preview && (
          <Text style={[styles.preview, isRead && styles.readText]} numberOfLines={2}>
            {preview}
          </Text>
        )}
        {timestamp && (
          <Text style={styles.timestamp}>
            {formatTime(timestamp)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

const CARD_W = Sizing.cardSlotW;
const CARD_H = CARD_W * Sizing.cardRatio;

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 16,
    backgroundColor: Colors.zinc50,
    overflow: "hidden",
  },
  inactive: {
    opacity: Colors.cardInactiveOpacity,
    transform: [{ scale: 0.97 }],
  },
  pressed: {
    opacity: 0.85,
  },
  inner: {
    flex: 1,
    padding: 24,
    justifyContent: "flex-end",
  },
  author: {
    ...Typography.caption,
    color: Colors.zinc500,
    marginBottom: 6,
  },
  title: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    marginBottom: 8,
  },
  preview: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    lineHeight: 20,
    marginBottom: 12,
  },
  timestamp: {
    ...Typography.caption,
    color: Colors.zinc400,
  },
  readText: {
    color: Colors.zinc400,
  },
});
