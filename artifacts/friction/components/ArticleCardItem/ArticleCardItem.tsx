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
  letterTypeBadge?: string | null;
  date?: string | null;
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
  letterTypeBadge,
  date,
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
              {letterTypeBadge ? (
                <View style={styles.letterTypeBadge}>
                  <Text style={[styles.letterTypeBadgeText, { fontSize: Math.max(8, Math.round(10 * scale)) }]}>
                    {letterTypeBadge}
                  </Text>
                </View>
              ) : null}
              <Text
                style={[styles.title, { color: textColor, fontSize: titleSize, lineHeight: titleSize * ReaderTokens.lineHeight.tight, marginTop: letterTypeBadge ? Math.max(4, Math.round(6 * scale)) : 0 }]}
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
              {date ? (
                <Text style={[styles.dateText, { left: 0, bottom: pad, fontSize: Math.max(7, Math.round(9 * scale)), color: "rgba(255,255,255,0.70)" }]} numberOfLines={1}>
                  {date}
                </Text>
              ) : null}
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
              {letterTypeBadge ? (
                <View style={[styles.letterTypeBadge, { backgroundColor: `${textColor}22` }]}>
                  <Text style={[styles.letterTypeBadgeText, { fontSize: Math.max(8, Math.round(10 * scale)), color: textColor }]}>
                    {letterTypeBadge}
                  </Text>
                </View>
              ) : null}
              <Text
                style={[styles.title, { color: textColor, fontSize: titleSize, lineHeight: titleSize * ReaderTokens.lineHeight.tight, marginTop: letterTypeBadge ? Math.max(4, Math.round(6 * scale)) : 0 }]}
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
              {date ? (
                <Text style={[styles.dateText, { left: 0, bottom: pad, fontSize: Math.max(7, Math.round(9 * scale)), color: textColor, opacity: 0.55 }]} numberOfLines={1}>
                  {date}
                </Text>
              ) : null}
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
  letterTypeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.30)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  letterTypeBadgeText: {
    fontFamily: ReaderTokens.fontFamily.sansBold,
    color: Colors.white,
    letterSpacing: 0.2,
  },
  dateText: {
    position: "absolute",
    fontFamily: ReaderTokens.fontFamily.sans,
    color: "rgba(255,255,255,0.75)",
    letterSpacing: 0.1,
  },
});
