import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGetSimilarThoughts, getGetSimilarThoughtsQueryKey } from "@workspace/api-client-react";
import { Colors, Typography, Spacing } from "../../constants/tokens";
import HighlightedText from "../HighlightedText/HighlightedText";
import type { ThoughtCreatedFrom } from "@workspace/api-client-react";

const CREATED_FROM_LABEL: Record<ThoughtCreatedFrom, string> = {
  quoted: "인용",
  question: "질문",
  reading: "메모",
  direct: "직접",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

interface SimilarThoughtPopupProps {
  visible: boolean;
  thoughtId: string | null;
  onClose: () => void;
  onHighlightChange?: (k: string[]) => void;
}

export default function SimilarThoughtPopup({
  visible,
  thoughtId,
  onClose,
  onHighlightChange,
}: SimilarThoughtPopupProps) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);

  const { data: similar, isLoading } = useGetSimilarThoughts(
    thoughtId ?? "",
    { limit: 15 },
    {
      query: {
        enabled: visible && thoughtId !== null,
        queryKey: getGetSimilarThoughtsQueryKey(thoughtId ?? "", { limit: 15 }),
      },
    }
  );

  useEffect(() => {
    if (visible) {
      setIndex(0);
    }
  }, [visible, thoughtId]);

  useEffect(() => {
    if (!visible) {
      onHighlightChange?.([]);
      return;
    }
    const current = similar?.[index];
    onHighlightChange?.(current?.k ?? []);
  }, [visible, index, similar]);

  if (!visible) return null;

  const current = similar?.[index] ?? null;
  const isLast = !similar || index >= similar.length - 1;
  const isEmpty = !isLoading && (!similar || similar.length === 0);

  const rText = current?.r ?? null;
  const hKeywords = current?.h ?? null;

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />

      {!isLoading && !isEmpty && rText ? (
        <View style={styles.reasonBanner}>
          <Text style={styles.reasonText} numberOfLines={2}>{rText}</Text>
        </View>
      ) : null}

      <View
        style={[
          styles.popup,
          { paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="small" color={Colors.zinc400} />
          </View>
        ) : isEmpty ? (
          <View style={styles.centerState}>
            <Text style={styles.emptyTitle}>비슷한 단상이 없어요</Text>
            <Text style={styles.emptySubtitle}>
              단상이 더 쌓이면 유사한 생각을{"\n"}추천해드릴게요
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.metaRow}>
              {current && (
                <>
                  <View style={styles.tag}>
                    <Text style={styles.tagText} allowFontScaling={false}>
                      {CREATED_FROM_LABEL[current.createdFrom]}
                    </Text>
                  </View>
                  <Text style={styles.dateText} allowFontScaling={false}>
                    {formatDate(current.createdAt)}
                  </Text>
                </>
              )}
              <Text style={styles.counterText} allowFontScaling={false}>
                {index + 1} / {similar?.length ?? 0}
              </Text>
            </View>
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <HighlightedText
                text={current?.content ?? ""}
                keywords={hKeywords}
                style={styles.content}
              />
            </ScrollView>
          </>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.exitButton} onPress={onClose}>
            <Text style={styles.exitText}>나가기</Text>
          </TouchableOpacity>
          {!isEmpty && (
            <TouchableOpacity
              style={[styles.nextButton, isLast && styles.nextButtonDisabled]}
              onPress={() => {
                if (!isLast) setIndex((i) => i + 1);
              }}
              disabled={isLast}
            >
              <Text style={[styles.nextText, isLast && styles.nextTextDisabled]}>
                다음
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 48,
    zIndex: 9999,
  },
  reasonBanner: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#FFE066",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 6,
  },
  reasonText: {
    fontSize: 13,
    color: Colors.zinc800,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard-Regular" }),
    lineHeight: 20,
  },
  popup: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    minHeight: 220,
  },
  centerState: {
    flex: 1,
    minHeight: 120,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 24,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.zinc700,
    fontFamily: Platform.select({ ios: "Pretendard-SemiBold", default: "Pretendard-SemiBold" }),
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.zinc500,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard-Regular" }),
    textAlign: "center",
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  tag: {
    backgroundColor: Colors.zinc100,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.zinc500,
    fontFamily: Platform.select({ ios: "Pretendard-SemiBold", default: "Pretendard-SemiBold" }),
  },
  dateText: {
    fontSize: 12,
    color: Colors.zinc500,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard-Regular" }),
    flex: 1,
  },
  counterText: {
    fontSize: 12,
    color: Colors.zinc500,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard-Regular" }),
  },
  scrollView: {
    maxHeight: 200,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  content: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc800,
    lineHeight: 24,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    paddingTop: 16,
  },
  exitButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.zinc200,
  },
  exitText: {
    fontSize: 14,
    color: Colors.zinc600,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard-Regular" }),
  },
  nextButton: {
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: Colors.zinc900,
  },
  nextButtonDisabled: {
    backgroundColor: Colors.zinc200,
  },
  nextText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.white,
    fontFamily: Platform.select({ ios: "Pretendard-SemiBold", default: "Pretendard-SemiBold" }),
  },
  nextTextDisabled: {
    color: Colors.zinc400,
  },
});
