import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ImageBackground,
} from "react-native";
import { Colors, Typography, Sizing, ReaderTokens, readerFontSize, readerLetterSpacing } from "../../constants/tokens";
import type { ArticleCover } from "@workspace/api-client-react";

interface ArticleCardItemProps {
  title: string;
  authorName?: string;
  collectionName?: string | null;
  onPress: () => void;
  cover?: ArticleCover | null;
  isRead?: boolean;
  isActive?: boolean;
  /** When set, renders a "MM월 DD일 인사" badge at the top-left. Format: YYYY-MM-DD. */
  noticeDate?: string | null;
  /** When true, renders a "답장" badge at the top-left of the card. */
  isReply?: boolean;
}

function formatNoticeLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return "인사";
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return "인사";
  return `${month}월 ${day}일 인사`;
}

const DEFAULT_BG = Colors.zinc50;
const DEFAULT_TEXT = Colors.zinc900;
const READ_TEXT = Colors.zinc400;

export default function ArticleCardItem({
  title,
  authorName,
  collectionName,
  onPress,
  cover,
  isRead = false,
  isActive = true,
  noticeDate,
  isReply = false,
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

  const badges =
    noticeDate || isReply ? (
      <View style={styles.badgeStack} pointerEvents="none">
        {noticeDate ? (
          <View style={styles.noticeBadge}>
            <Text style={styles.noticeBadgeText} numberOfLines={1}>
              {formatNoticeLabel(noticeDate)}
            </Text>
          </View>
        ) : null}
        {isReply ? (
          <View style={styles.replyBadge}>
            <Text style={styles.replyBadgeText} numberOfLines={1}>답장</Text>
          </View>
        ) : null}
      </View>
    ) : null;

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
          {badges}
          {collectionName ? (
            <View style={styles.collectionTag} pointerEvents="none">
              <Text style={styles.collectionTagText} numberOfLines={1}>
                {collectionName}
              </Text>
            </View>
          ) : null}
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
          {badges}
          {collectionName ? (
            <View style={styles.collectionTag} pointerEvents="none">
              <Text style={styles.collectionTagText} numberOfLines={1}>
                {collectionName}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const CARD_W = Sizing.cardSlotW;
const CARD_H = CARD_W * Sizing.cardRatio;

const TITLE_SIZE = readerFontSize(6.5, CARD_W);
const AUTHOR_SIZE = readerFontSize(3.6, CARD_W);

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
    justifyContent: "center",
  },
  author: {
    fontFamily: ReaderTokens.fontFamily.sans,
    fontSize: AUTHOR_SIZE,
    lineHeight: AUTHOR_SIZE * ReaderTokens.lineHeight.relaxed,
    marginBottom: 6,
  },
  title: {
    fontFamily: ReaderTokens.fontFamily.serifBold,
    fontSize: TITLE_SIZE,
    lineHeight: TITLE_SIZE * ReaderTokens.lineHeight.tight,
    letterSpacing: readerLetterSpacing(ReaderTokens.letterSpacing.tightEm, TITLE_SIZE),
  },
  collectionTag: {
    position: "absolute",
    bottom: 12,
    left: 12,
    alignSelf: "flex-start",
    backgroundColor: Colors.white,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  collectionTagText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc700,
  },
  badgeStack: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "column",
    gap: 4,
  },
  noticeBadge: {
    alignSelf: "flex-start",
    backgroundColor: Colors.white,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  noticeBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
    color: "#92323D",
  },
  replyBadge: {
    alignSelf: "flex-start",
    backgroundColor: Colors.white,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  replyBadgeText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
    color: Colors.zinc900,
  },
});
