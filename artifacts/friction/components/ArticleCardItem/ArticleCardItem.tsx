import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ImageBackground,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Sizing, ReaderTokens, readerFontSize } from "../../constants/tokens";
import type { ArticleCover } from "@workspace/api-client-react";

interface ArticleCardItemProps {
  title: string;
  authorName?: string;
  collectionName?: string | null;
  onPress: () => void;
  cover?: ArticleCover | null;
  isRead?: boolean;
  isActive?: boolean;
}

const DEFAULT_BG = Colors.zinc50;
const DEFAULT_TEXT = Colors.zinc900;
const READ_TEXT = Colors.zinc400;

function ArticleCardItem({
  title,
  authorName,
  collectionName,
  onPress,
  cover,
  isRead = false,
  isActive = true,
}: ArticleCardItemProps) {
  const textColor = isRead
    ? READ_TEXT
    : cover?.textColor ?? DEFAULT_TEXT;

  const coverType = cover?.type ?? "default";

  const content = (
    <View style={styles.inner} pointerEvents="none">
      <Text
        style={[styles.title, { color: textColor }]}
        numberOfLines={4}
      >
        {title}
      </Text>
      <View style={styles.senderBlock}>
        {authorName ? (
          <Text
            style={[styles.author, { color: textColor }]}
            numberOfLines={1}
          >
            {authorName}
          </Text>
        ) : null}
        {collectionName ? (
          <Text
            style={[styles.collection, { color: textColor }]}
            numberOfLines={1}
          >
            {collectionName}
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <ScalePressable
      onPress={onPress}
      style={[styles.card, !isActive && styles.inactive]}
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
    </ScalePressable>
  );
}

export default React.memo(ArticleCardItem);

const CARD_W = Sizing.cardSlotW;
const CARD_H = CARD_W * Sizing.cardRatio;

const TITLE_SIZE = readerFontSize(6.5, CARD_W);
const AUTHOR_SIZE = readerFontSize(3.2, CARD_W);
const COLLECTION_SIZE = readerFontSize(2.8, CARD_W);

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
    padding: 20,
    justifyContent: "flex-start",
  },
  title: {
    fontFamily: ReaderTokens.fontFamily.sansBold,
    fontSize: TITLE_SIZE,
    lineHeight: TITLE_SIZE * ReaderTokens.lineHeight.tight,
    alignSelf: "flex-start",
  },
  senderBlock: {
    position: "absolute",
    bottom: 16,
    right: 16,
    alignItems: "flex-end",
  },
  author: {
    fontFamily: ReaderTokens.fontFamily.sans,
    fontSize: AUTHOR_SIZE,
    lineHeight: AUTHOR_SIZE * ReaderTokens.lineHeight.relaxed,
  },
  collection: {
    fontFamily: ReaderTokens.fontFamily.sans,
    fontSize: COLLECTION_SIZE,
    lineHeight: COLLECTION_SIZE * ReaderTokens.lineHeight.relaxed,
    opacity: 0.7,
  },
});
