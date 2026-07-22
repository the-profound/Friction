import React from "react";
import { View, Text, StyleSheet } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Typography, Spacing } from "../../constants/tokens";
import type { ThoughtCreatedFrom } from "@workspace/api-client-react";

const CREATED_FROM_LABEL: Record<ThoughtCreatedFrom, string> = {
  quoted: "인용",
  question: "질문",
  reading: "메모",
  direct: "직접",
};

interface ThoughtListItemProps {
  content: string | null | undefined;
  createdFrom: ThoughtCreatedFrom;
  rightMeta: string;
  onPress: () => void;
}

function ThoughtListItem({ content, createdFrom, rightMeta, onPress }: ThoughtListItemProps) {
  return (
    <ScalePressable
      onPress={onPress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <View style={styles.tag}>
          <Text style={styles.tagText} allowFontScaling={false}>
            {CREATED_FROM_LABEL[createdFrom]}
          </Text>
        </View>
        <Text style={styles.rightMeta}>{rightMeta}</Text>
      </View>
      <Text style={styles.content} numberOfLines={2}>
        {content ?? ""}
      </Text>
    </ScalePressable>
  );
}

export default React.memo(ThoughtListItem);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 14,
    backgroundColor: Colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
    gap: 6,
  },
  pressed: {
    backgroundColor: Colors.zinc50,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tag: {
    backgroundColor: Colors.zinc100,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.zinc500,
  },
  rightMeta: {
    ...Typography.caption,
    color: Colors.zinc400,
  },
  content: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
    lineHeight: 20,
  },
});
