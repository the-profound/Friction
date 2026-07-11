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
  onLongPress?: () => void;
  cover?: ArticleCover | null;
  isRead?: boolean;
  isActive?: boolean;
  cardWidth?: number;
}

const DEFAULT_BG = Colors.zinc50;

function ArticleCardItem({
  title,
  authorName,
  collectionName,
  onPress,
  onLongPress,
  cover,
  isRead = false,
  isActive = true,
  cardWidth,
}: ArticleCardItemProps) {
  const textColor = cover?.textColor ?? Colors.zinc900;
  const w = cardWidth ?? CARD_W;
  const h = w * Sizing.cardRatio;

  const coverType = cover?.type ?? "default";

  const scale = w / CARD_W;
  const titleSize = Math.max(8, Math.round(TITLE_SIZE * scale));
  const authorSize = Math.max(6, Math.round(AUTHOR_SIZE * scale));
  const collectionSize = Math.max(5, Math.round(COLLECTION_SIZE * scale));
  const pad = Math.max(6, Math.round(24 * scale));

  const borderRadius = Math.max(8, Math.round(16 * scale));

  return (
    <View style={[{ width: w, height: h }, !isActive && styles.inactive]}>
      <ScalePressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={{ width: w, height: h }}
        animatedBorderRadius={borderRadius}
      >
        {coverType === "image" && cover?.imageUrl ? (
          <ImageBackground
            source={{ uri: cover.imageUrl }}
            style={styles.backgroundImage}
            resizeMode="cover"
          >
            <View style={styles.imageOverlay} />
            <View style={[styles.inner, { padding: pad }]} pointerEvents="none">
              <Text
                style={[styles.title, { color: textColor, fontSize: titleSize, lineHeight: titleSize * ReaderTokens.lineHeight.tight }]}
                numberOfLines={4}
              >
                {title}
              </Text>
              <View style={[styles.senderBlock, { bottom: pad, right: pad }]}>
                {authorName ? (
                  <Text style={[styles.author, { color: textColor, fontSize: authorSize, lineHeight: authorSize * 1.3 }]} numberOfLines={1}>
                    {authorName}
                  </Text>
                ) : null}
                {collectionName ? (
                  <Text style={[styles.collection, { color: textColor, fontSize: collectionSize, lineHeight: collectionSize * 1.3 }]} numberOfLines={1}>
                    {collectionName}
                  </Text>
                ) : null}
              </View>
            </View>
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
            <View style={[styles.inner, { padding: pad }]} pointerEvents="none">
              <Text
                style={[styles.title, { color: textColor, fontSize: titleSize, lineHeight: titleSize * ReaderTokens.lineHeight.tight }]}
                numberOfLines={4}
              >
                {title}
              </Text>
              <View style={[styles.senderBlock, { bottom: pad, right: pad }]}>
                {authorName ? (
                  <Text style={[styles.author, { color: textColor, fontSize: authorSize, lineHeight: authorSize * 1.3 }]} numberOfLines={1}>
                    {authorName}
                  </Text>
                ) : null}
                {collectionName ? (
                  <Text style={[styles.collection, { color: textColor, fontSize: collectionSize, lineHeight: collectionSize * 1.3 }]} numberOfLines={1}>
                    {collectionName}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        )}
      </ScalePressable>

    </View>
  );
}

export default React.memo(ArticleCardItem);

const CARD_W = Sizing.cardSlotW;
const CARD_H = CARD_W * Sizing.cardRatio;

const TITLE_SIZE = 32;
const AUTHOR_SIZE = 24;
const COLLECTION_SIZE = 16;

const styles = StyleSheet.create({
  inactive: {
    opacity: Colors.cardInactiveOpacity,
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
    justifyContent: "flex-start",
  },
  title: {
    fontFamily: ReaderTokens.fontFamily.sansBold,
    alignSelf: "flex-start",
  },
  senderBlock: {
    position: "absolute",
    alignItems: "flex-end",
  },
  author: {
    fontFamily: ReaderTokens.fontFamily.sansBold,
  },
  collection: {
    fontFamily: ReaderTokens.fontFamily.sansBold,
  },
});
