import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ImageBackground,
} from "react-native";
import { Colors, Typography, Sizing } from "../../constants/tokens";
import type { ArticleCover } from "@workspace/api-client-react";

interface ArticleCardItemProps {
  title: string;
  authorName?: string;
  onPress: () => void;
  cover?: ArticleCover | null;
  isRead?: boolean;
  isActive?: boolean;
}

const DEFAULT_BG = Colors.zinc50;
const DEFAULT_TEXT = Colors.zinc900;
const READ_TEXT = Colors.zinc400;

export default function ArticleCardItem({
  title,
  authorName,
  onPress,
  cover,
  isRead = false,
  isActive = true,
}: ArticleCardItemProps) {
  const textColor = isRead
    ? READ_TEXT
    : cover?.textColor ?? DEFAULT_TEXT;

  const textAlign = cover?.align === "center" ? ("center" as const) : ("left" as const);

  const content = (
    <View style={styles.inner}>
      {authorName ? (
        <Text
          style={[styles.author, { color: textColor, textAlign }]}
          numberOfLines={1}
        >
          {authorName}
        </Text>
      ) : null}
      <Text
        style={[styles.title, { color: textColor, textAlign }]}
        numberOfLines={2}
      >
        {title}
      </Text>
    </View>
  );

  const coverType = cover?.type ?? "default";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        !isActive && styles.inactive,
        pressed && styles.pressed,
      ]}
    >
      {coverType === "image" && cover?.imageUrl ? (
        <ImageBackground
          source={{ uri: cover.imageUrl }}
          style={styles.backgroundImage}
          resizeMode="cover"
        >
          <View style={styles.imageOverlay} />
          {content}
        </ImageBackground>
      ) : (
        <View
          style={[
            styles.solidBackground,
            {
              backgroundColor:
                coverType === "color" && cover?.bgColor
                  ? cover.bgColor
                  : DEFAULT_BG,
            },
          ]}
        >
          {content}
        </View>
      )}
    </Pressable>
  );
}

const CARD_W = Sizing.cardSlotW;
const CARD_H = CARD_W * Sizing.cardRatio;

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 16,
    overflow: "hidden",
  },
  inactive: {
    opacity: Colors.cardInactiveOpacity,
    transform: [{ scale: 0.97 }],
  },
  pressed: {
    opacity: 0.85,
  },
  backgroundImage: {
    flex: 1,
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  solidBackground: {
    flex: 1,
  },
  inner: {
    flex: 1,
    padding: 24,
    justifyContent: "flex-end",
  },
  author: {
    ...Typography.caption,
    marginBottom: 6,
  },
  title: {
    ...Typography.bodySemiBold,
    fontSize: 20,
  },
});
