import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors } from "@/constants/tokens";

interface DansangWidgetProps {
  /** Height of each pager slot — must match FlatList item height */
  slotHeight: number;
  /** Whether there are thought cards below (show down-hint) */
  hasThoughts?: boolean;
}

const CARD_MARGIN_H = 36;
/** Vertical margin as fraction of slotHeight — gives a taller card (~80% height) than ThoughtCard (60%) */
const CARD_MARGIN_V_RATIO = 0.10;

export default function DansangWidget({ slotHeight, hasThoughts }: DansangWidgetProps) {
  const cardMarginV = slotHeight * CARD_MARGIN_V_RATIO;

  return (
    <View style={[styles.slot, { height: slotHeight }]}>
      {/* Shadow layer — separated from content to avoid re-rasterization */}
      <View
        style={[
          styles.cardShadow,
          { top: cardMarginV, bottom: cardMarginV, left: CARD_MARGIN_H, right: CARD_MARGIN_H },
        ]}
        pointerEvents="none"
      />

      {/* Content surface */}
      <View
        style={[
          styles.cardSurface,
          { top: cardMarginV, bottom: cardMarginV, left: CARD_MARGIN_H, right: CARD_MARGIN_H },
        ]}
      >
        <Text style={styles.widgetLabel} allowFontScaling={false}>
          위젯
        </Text>
      </View>

      {/* Down-navigation hint — always visible since thoughts are below */}
      {hasThoughts !== false && (
        <View style={styles.hintBelow} pointerEvents="none">
          <Feather name="chevron-down" size={18} color={Colors.zinc300} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    alignItems: "center",
    justifyContent: "center",
  },
  hintBelow: {
    position: "absolute",
    bottom: 6,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  cardShadow: {
    position: "absolute",
    backgroundColor: Colors.white,
    borderRadius: 4,
    ...Platform.select({
      web: {
        boxShadow: "0 6px 44px rgba(0,0,0,0.18), 0 1px 8px rgba(0,0,0,0.1)",
      } as object,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 5,
      },
    }),
  },
  cardSurface: {
    position: "absolute",
    backgroundColor: Colors.white,
    borderRadius: 4,
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  widgetLabel: {
    fontSize: 16,
    color: Colors.zinc400,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard-Regular" }),
  },
});
