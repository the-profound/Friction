import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { OnSelectionUpdatePayload } from "@/components/WebViewMarkdownEditor/types";

interface KeyboardToolbarProps {
  selectionState: OnSelectionUpdatePayload;
  onFormatPress: () => void;
  onBoldPress: () => void;
  onItalicPress: () => void;
  onUnderlinePress: () => void;
  onDismissKeyboard: () => void;
  onInsertDivider?: () => void;
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
  onDismissKeyboard,
  onInsertDivider,
}: KeyboardToolbarProps) {
  const { activeBlock, isBold, isItalic, isUnderline } = selectionState;
  const blockLabel = BLOCK_LABELS[activeBlock] ?? "본문";

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.button}
        onPress={onFormatPress}
        hitSlop={8}
      >
        <Text style={[styles.buttonText, styles.activeText]}>{blockLabel}</Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={onBoldPress}
        hitSlop={8}
      >
        <Text style={[styles.buttonText, styles.boldLabel, isBold && styles.activeText]}>
          B
        </Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={onItalicPress}
        hitSlop={8}
      >
        <Text style={[styles.buttonText, styles.italicLabel, isItalic && styles.activeText]}>
          I
        </Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={onUnderlinePress}
        hitSlop={8}
      >
        <Text style={[styles.buttonText, styles.underlineLabel, isUnderline && styles.activeText]}>
          U
        </Text>
      </Pressable>

      {onInsertDivider != null && (
        <Pressable
          style={styles.dividerButton}
          onPress={onInsertDivider}
          hitSlop={8}
        >
          <MaterialCommunityIcons name="content-cut" size={14} color="#a1a1aa" />
        </Pressable>
      )}

      <Pressable
        style={styles.button}
        onPress={onDismissKeyboard}
        hitSlop={8}
      >
        <MaterialCommunityIcons name="keyboard-off-outline" size={20} color="#a1a1aa" />
      </Pressable>
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
    paddingBottom: Platform.OS === "ios" ? 0 : 0,
  },
  button: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: 44,
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
  dividerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    height: 44,
    paddingHorizontal: 6,
  },
  dividerLabel: {
    color: "#a1a1aa",
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard" }),
  },
});
