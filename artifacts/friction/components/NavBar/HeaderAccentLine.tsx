import React from "react";
import { StyleSheet, View } from "react-native";

import { Colors } from "@/constants/tokens";

interface HeaderAccentLineProps {
  titleLineHeight: number;
}

export function HeaderAccentLine({ titleLineHeight }: HeaderAccentLineProps) {
  const titleBottomOffset = 15 + (36 - titleLineHeight) / 2;
  const lineGap = 2.5;

  return (
    <View style={styles.container} accessibilityElementsHidden>
      <View
        style={[
          styles.line,
          { bottom: titleBottomOffset - lineGap },
        ]}
      />
      <View
        style={[
          styles.line,
          { bottom: titleBottomOffset + titleLineHeight + lineGap },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    pointerEvents: "none",
    zIndex: 2,
  },
  line: {
    position: "absolute",
    left: "50%",
    marginLeft: -48,
    width: 96,
    height: 1,
    backgroundColor: Colors.noticeAccent,
  },
});