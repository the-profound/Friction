import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors, Sizing, ReaderTokens, Shadows } from "@/constants/tokens";

interface EnvelopeFrontCardProps {
  recipientName?: string | null;
  senderName?: string | null;
  senderLocation?: string | null;
  cardWidth?: number;
  isActive?: boolean;
  carouselShadow?: boolean;
}

const CARD_W = Sizing.cardSlotW;

/**
 * Layer 1 — the BACK of the envelope (default face, before flip).
 *
 * Top-left:    recipientName (수신인, 나의 닉네임) + underline + blank underline
 * Bottom-right: senderName (발신자) + underline + senderLocation (발신처/컬렉션명) + underline
 *
 * Noto Serif KR throughout. Matches mockup image_1782222038207.png.
 */
export default function EnvelopeFrontCard({
  recipientName,
  senderName,
  senderLocation,
  cardWidth,
  isActive = true,
  carouselShadow = false,
}: EnvelopeFrontCardProps) {
  const w = cardWidth ?? CARD_W;
  const h = w * Sizing.cardRatio;
  const scale = w / CARD_W;
  const pad = Math.round(28 * scale);
  const borderRadius = Math.max(8, Math.round(18 * scale));

  const recipientSize = Math.round(16 * scale);
  const senderSize    = Math.round(24 * scale);
  const locationSize  = Math.round(16 * scale);

  const lineColor = "rgba(0,0,0,0.28)";
  const lineW     = Math.round(150 * scale);
  const lineGap   = Math.round(24 * scale);

  return (
    <View
      style={[
        styles.shadowHost,
        { width: w, height: h, borderRadius },
        carouselShadow && styles.carouselShadow,
        !isActive && styles.inactive,
      ]}
    >
      <View style={[styles.card, { borderRadius }]}>
      {/* ── Top-left: 수신인(나) + 두 줄 밑줄 ── */}
      <View style={{ position: "absolute", top: pad, left: pad }}>
        {recipientName ? (
          <Text
            style={[styles.recipientName, { fontSize: recipientSize, lineHeight: recipientSize * 1.35 }]}
            numberOfLines={1}
          >
            {recipientName}
          </Text>
        ) : null}
        {/* 첫 번째 밑줄 (이름 바로 아래) */}
        <View style={{ width: lineW, height: 1, backgroundColor: lineColor, marginTop: Math.round(4 * scale) }} />
        {/* 두 번째 빈 밑줄 */}
        <View style={{ width: lineW, height: 1, backgroundColor: lineColor, marginTop: lineGap }} />
      </View>

      {/* ── Bottom-right: 발신자 + 밑줄 + 발신처 + 밑줄 ── */}
      <View style={{ position: "absolute", bottom: pad, right: pad, alignItems: "flex-end" }}>
        {senderName ? (
          <Text
            style={[styles.senderName, { fontSize: senderSize, lineHeight: senderSize * 1.35 }]}
            numberOfLines={1}
          >
            {senderName}
          </Text>
        ) : null}
        {/* 발신자 아래 밑줄 */}
        <View
          style={{
            width: lineW,
            height: 1,
            backgroundColor: lineColor,
            marginTop: Math.round(4 * scale),
            marginBottom: Math.round(8 * scale),
          }}
        />
        {senderLocation ? (
          <Text
            style={[styles.senderLocation, { fontSize: locationSize, lineHeight: locationSize * 1.4 }]}
            numberOfLines={1}
          >
            {senderLocation}
          </Text>
        ) : null}
        {/* 발신처 아래 밑줄 */}
        <View style={{ width: lineW, height: 1, backgroundColor: lineColor, marginTop: Math.round(4 * scale) }} />
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadowHost: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
  },
  card: {
    flex: 1,
    backgroundColor: Colors.white,
    overflow: "hidden",
  },
  carouselShadow: {
    ...Shadows.carouselCard,
  },
  inactive: {
    opacity: Colors.cardInactiveOpacity,
    transform: [{ scale: 0.97 }],
  },
  recipientName: {
    fontFamily: ReaderTokens.fontFamily.notoSerifBold,
    color: Colors.zinc900,
    letterSpacing: 0.1,
  },
  senderName: {
    fontFamily: ReaderTokens.fontFamily.notoSerifExtraBold,
    color: Colors.zinc900,
    letterSpacing: 0.2,
  },
  senderLocation: {
    fontFamily: ReaderTokens.fontFamily.notoSerifBold,
    color: Colors.zinc700,
    letterSpacing: 0.1,
  },
});
