import React, { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { AntDesign } from "@expo/vector-icons";
import {
  Colors,
  ReaderTokens,
  Shadows,
  Typography,
} from "@/constants/tokens";

type StoredSentenceCardProps = {
  text: string;
  source: string;
  date: string;
  isFavorite: boolean;
  bodyFontSize: number;
  sourceFontSize?: number;
  leading?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export default function StoredSentenceCard({
  text,
  source,
  date,
  isFavorite,
  bodyFontSize,
  sourceFontSize,
  leading,
  style,
}: StoredSentenceCardProps) {
  return (
    <View style={[styles.card, style]}>
      {isFavorite ? (
        <View
          style={styles.favoriteBadge}
          pointerEvents="none"
          accessible={false}
        >
          <AntDesign name="heart" size={16} color={Colors.noticeAccent} />
        </View>
      ) : null}
      {leading}
      <View style={styles.content}>
        <Text
          style={[
            styles.body,
            {
              fontSize: bodyFontSize,
              lineHeight: bodyFontSize * ReaderTokens.lineHeight.relaxed,
            },
          ]}
        >
          {text}
        </Text>
        <View style={styles.meta}>
          <Text
            style={[
              styles.source,
              sourceFontSize === undefined
                ? null
                : { fontSize: sourceFontSize, lineHeight: sourceFontSize * 1.5 },
            ]}
          >
            {source}
          </Text>
          <Text style={styles.date}>{date}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
    borderRadius: 16,
    backgroundColor: Colors.white,
    ...Shadows.card,
  },
  favoriteBadge: {
    position: "absolute",
    top: -8,
    left: 10,
    zIndex: 1,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 18,
  },
  body: {
    fontFamily: ReaderTokens.fontFamily.serif,
    color: Colors.zinc900,
    textAlign: "justify",
  },
  meta: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
  },
  source: {
    flex: 1,
    minWidth: 0,
    ...Typography.caption,
    fontFamily: ReaderTokens.fontFamily.serifBold,
    fontWeight: "600",
    color: Colors.noticeAccent,
  },
  date: {
    flexShrink: 0,
    ...Typography.caption,
    color: Colors.zinc500,
    textAlign: "right",
  },
});