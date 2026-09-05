import React from "react";
import { StyleSheet, View } from "react-native";

import { Colors } from "@/constants/tokens";

interface HeaderAccentLineProps {
  titleLineHeight: number;
  /**
   * Height of the flex row that contains the title.
   * Pass the actual max-child height so the lines are centred on the title
   * text regardless of whether a back button (44 px) or action buttons (36 px)
   * set the row height.
   */
  rowHeight: number;
}

export function HeaderAccentLine({ titleLineHeight, rowHeight }: HeaderAccentLineProps) {
  // Container paddingBottom is 15 px.  The title text is vertically centred
  // inside the row, so its bottom edge sits at 15 + (rowHeight - titleLineHeight) / 2
  // above the shell bottom.
  const titleBottomOffset = 15 + (rowHeight - titleLineHeight) / 2;
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