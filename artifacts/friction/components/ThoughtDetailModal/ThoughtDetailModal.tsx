import React, { useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Text,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import SimilarThoughtPopup from "@/components/SimilarThoughtPopup/SimilarThoughtPopup";
import HighlightedText from "@/components/HighlightedText/HighlightedText";
import { Colors, Typography, Spacing } from "../../constants/tokens";
import type { Thought, ThoughtCreatedFrom } from "@workspace/api-client-react";

const CREATED_FROM_LABEL: Record<ThoughtCreatedFrom, string> = {
  quoted: "인용",
  question: "질문",
  reading: "메모",
  direct: "직접",
};

interface ThoughtDetailModalProps {
  thought: Thought | null;
  onClose: () => void;
  onRecommend?: (thought: Thought) => void;
  similarPopupThoughtId?: string | null;
  onCloseSimilarPopup?: () => void;
}

function ThoughtDetailModal({
  thought,
  onClose,
  onRecommend,
  similarPopupThoughtId,
  onCloseSimilarPopup,
}: ThoughtDetailModalProps) {
  const insets = useSafeAreaInsets();
  const [highlightKeywords, setHighlightKeywords] = useState<string[]>([]);

  const handleHighlightChange = (k: string[]) => {
    setHighlightKeywords(k);
  };

  const handleCloseSimilarPopup = () => {
    setHighlightKeywords([]);
    onCloseSimilarPopup?.();
  };

  return (
    <BottomSheet
      visible={thought !== null}
      onClose={onClose}
      snapPoints={[0.65]}
      enableDragDown
      dismissable
      overlay={
        <SimilarThoughtPopup
          visible={similarPopupThoughtId != null}
          thoughtId={similarPopupThoughtId ?? null}
          onClose={handleCloseSimilarPopup}
          onHighlightChange={handleHighlightChange}
        />
      }
    >
      <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          {thought && (
            <View style={styles.tag}>
              <Text style={styles.tagText} allowFontScaling={false}>
                {CREATED_FROM_LABEL[thought.createdFrom]}
              </Text>
            </View>
          )}
          <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={8}>
            <Feather name="x" size={20} color={Colors.zinc500} />
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <HighlightedText
            text={thought?.content ?? ""}
            keywords={highlightKeywords}
            style={styles.content}
          />
        </ScrollView>
        {onRecommend && thought && (
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.recommendButton}
              onPress={() => onRecommend(thought)}
              hitSlop={8}
            >
              <Text style={styles.recommendText}>추천</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

export default ThoughtDetailModal;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  tag: {
    backgroundColor: Colors.zinc100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.zinc500,
  },
  closeButton: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  content: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc800,
    lineHeight: 24,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingTop: 12,
  },
  recommendButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: Colors.zinc100,
  },
  recommendText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.zinc700,
    fontFamily: "Pretendard-SemiBold",
  },
});
