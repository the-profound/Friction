import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import type { OnSelectionUpdatePayload } from "@/components/WebViewMarkdownEditor/types";

interface KeyboardToolbarProps {
  selectionState: OnSelectionUpdatePayload;
  onFormatPress: () => void;
  onBoldPress: () => void;
  onItalicPress: () => void;
  onUnderlinePress: () => void;
  onDismissKeyboard?: () => void;
  onInsertDivider?: () => void;
  onShiftEnter?: () => void;
}

const BLOCK_LABELS: Record<string, string> = {
  paragraph: "본문",
  heading1: "제목 1",
  heading2: "제목 2",
  heading3: "제목 3",
  blockquote: "인용",
  bulletList: "글머리",
  orderedList: "번호",
};

export default function KeyboardToolbar({
  selectionState,
  onFormatPress,
  onBoldPress,
  onItalicPress,
  onUnderlinePress,
  onInsertDivider,
  onShiftEnter,
}: KeyboardToolbarProps) {
  const { activeBlock, isBold, isItalic, isUnderline } = selectionState;
  const blockLabel = BLOCK_LABELS[activeBlock] ?? "본문";

  return (
    <View style={styles.container}>
      <ScalePressable
        style={styles.button}
        contentStyle={styles.buttonContent}
        onPress={onFormatPress}
        hitSlop={8}
      >
        <Text style={[styles.buttonText, styles.activeText]}>{blockLabel}</Text>
      </ScalePressable>

      <ScalePressable
        style={styles.button}
        contentStyle={styles.buttonContent}
        onPress={onBoldPress}
        hitSlop={8}
      >
        <Text style={[styles.buttonText, styles.boldLabel, isBold && styles.activeText]}>
          B
        </Text>
      </ScalePressable>

      <ScalePressable
        style={styles.button}
        contentStyle={styles.buttonContent}
        onPress={onItalicPress}
        hitSlop={8}
      >
        <Text style={[styles.buttonText, styles.italicLabel, isItalic && styles.activeText]}>
          I
        </Text>
      </ScalePressable>

      <ScalePressable
        style={styles.button}
        contentStyle={styles.buttonContent}
        onPress={onUnderlinePress}
        hitSlop={8}
      >
        <Text style={[styles.buttonText, styles.underlineLabel, isUnderline && styles.activeText]}>
          U
        </Text>
      </ScalePressable>

      {onInsertDivider != null && (
        <ScalePressable
          style={styles.button}
          contentStyle={styles.buttonContent}
          onPress={onInsertDivider}
          hitSlop={8}
        >
          <Feather name="scissors" size={16} color="#a1a1aa" />
        </ScalePressable>
      )}

      {onShiftEnter != null && (
        <ScalePressable
          style={styles.button}
          contentStyle={styles.buttonContent}
          onPress={onShiftEnter}
          hitSlop={8}
        >
          <Feather name="corner-down-left" size={18} color="#a1a1aa" />
        </ScalePressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    backgroundColor: "#000000",
    height: 44,
    paddingHorizontal: 8,
  },
  button: {
    flex: 1,
    height: 44,
  },
  buttonContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#a1a1aa",
    fontSize: 14,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard" }),
  },
  boldLabel: {
    fontFamily: Platform.select({ ios: "Pretendard-Bold", default: "Pretendard-Bold" }),
    fontWeight: "700",
    fontSize: 16,
  },
  italicLabel: {
    fontStyle: "italic",
    fontSize: 16,
  },
  underlineLabel: {
    textDecorationLine: "underline",
    fontSize: 16,
  },
  activeText: {
    color: "#ffffff",
  },
});
