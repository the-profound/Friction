import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ImageBackground,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Sizing, ReaderTokens } from "../../constants/tokens";
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

function ArticleCardItem({
  title,
  authorName,
  collectionName,
  onPress,
  cover,
  isRead = false,
  isActive = true,
}: ArticleCardItemProps) {
  const textColor = cover?.textColor ?? Colors.zinc900;

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

const TITLE_SIZE = 32;
const AUTHOR_SIZE = 24;
const COLLECTION_SIZE = 16;

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
    padding: 24,
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
    bottom: 24,
    right: 24,
    alignItems: "flex-end",
  },
  author: {
    fontFamily: ReaderTokens.fontFamily.sansBold,
    fontSize: AUTHOR_SIZE,
    lineHeight: AUTHOR_SIZE * 1.3,
  },
  collection: {
    fontFamily: ReaderTokens.fontFamily.sansBold,
    fontSize: COLLECTION_SIZE,
    lineHeight: COLLECTION_SIZE * 1.3,
  },
});
