import React, { useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography } from "@/constants/tokens";
import { useListStoredSentences, getListStoredSentencesQueryKey } from "@workspace/api-client-react";
import type { StoredSentence } from "@workspace/api-client-react";

export type InlineMenuMode = "blockType" | "quotePicker" | "addMenu";

interface BlockTypeOption {
  key: string;
  label: string;
}

const BLOCK_TYPES: BlockTypeOption[] = [
  { key: "paragraph", label: "본문" },
  { key: "heading1", label: "제목 1" },
  { key: "heading2", label: "제목 2" },
  { key: "heading3", label: "제목 3" },
  { key: "blockquote", label: "인용" },
  { key: "bulletList", label: "글머리 기호" },
  { key: "orderedList", label: "숫자 목록" },
];

interface InlineMenuPanelProps {
  mode: InlineMenuMode;
  panelHeight: number;
  activeBlock: string;
  userId: string;
  onSelectBlock: (blockType: string) => void;
  onSelectSentence: (sentence: StoredSentence) => void;
  onSelectQuoteMenu: () => void;
  onDismiss: () => void;
}

const ADD_MENU_ITEMS = [
  { key: "quote", label: "수집한 문장", icon: "bookmark" as const },
  { key: "photo", label: "사진", icon: "image" as const },
] as const;

const ADD_MENU_HEIGHT = 96;

export default function InlineMenuPanel({
  mode,
  panelHeight,
  activeBlock,
  userId,
  onSelectBlock,
  onSelectSentence,
  onSelectQuoteMenu,
  onDismiss,
}: InlineMenuPanelProps) {
  const sentencesQuery = useListStoredSentences(
    { userId },
    {
      query: {
        queryKey: getListStoredSentencesQueryKey({ userId }),
        enabled: mode === "quotePicker" && !!userId,
      },
    },
  );

  const sentences = (sentencesQuery.data ?? []) as StoredSentence[];

  const handleSelectSentence = useCallback(
    (sentence: StoredSentence) => {
      onSelectSentence(sentence);
    },
    [onSelectSentence],
  );

  const effectivePanelHeight = mode === "addMenu" ? ADD_MENU_HEIGHT : panelHeight;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Transparent overlay above the panel — tapping it dismisses */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onDismiss}
      />

      {/* Inline panel anchored to bottom */}
      <View style={[styles.panel, { height: effectivePanelHeight }]}>
        {mode === "addMenu" ? (
          <View style={styles.scroll}>
            {ADD_MENU_ITEMS.map((item) => (
              <ScalePressable
                key={item.key}
                style={styles.addMenuRow}
                contentStyle={styles.addMenuRowContent}
                onPress={item.key === "quote" ? onSelectQuoteMenu : undefined}
              >
                <Feather name={item.icon} size={16} color={Colors.zinc500} />
                <Text style={styles.addMenuLabel}>{item.label}</Text>
              </ScalePressable>
            ))}
          </View>
        ) : mode === "blockType" ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            {BLOCK_TYPES.map((item) => {
              const isActive = item.key === activeBlock;
              return (
                <ScalePressable
                  key={item.key}
                  style={[styles.row, isActive && styles.activeRow]}
                  contentStyle={styles.rowContent}
                  onPress={() => onSelectBlock(item.key)}
                >
                  <Text style={[styles.label, isActive && styles.activeLabel]}>
                    {item.label}
                  </Text>
                  {isActive && <Text style={styles.checkmark}>✓</Text>}
                </ScalePressable>
              );
            })}
          </ScrollView>
        ) : sentencesQuery.isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color={Colors.zinc400} />
          </View>
        ) : sentences.length === 0 ? (
          <View style={styles.centerContainer}>
            <Feather name="bookmark" size={32} color={Colors.zinc300} />
            <Text style={styles.emptyTitle}>수집한 문장이 없어요</Text>
            <Text style={styles.emptySubtitle}>
              읽으면서 마음에 드는 문장을 수집해보세요
            </Text>
          </View>
        ) : (
          <ScrollView
            nestedScrollEnabled
            style={styles.scroll}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {sentences.map((item) => (
              <ScalePressable
                key={item.id}
                style={styles.sentenceItem}
                contentStyle={styles.sentenceItemContent}
                onPress={() => handleSelectSentence(item)}
              >
                <Text style={styles.sentenceText} numberOfLines={3}>
                  {item.text}
                </Text>
                {item.articleTitle && (
                  <Text style={styles.sentenceSource} numberOfLines={1}>
                    {item.articleTitle}
                  </Text>
                )}
              </ScalePressable>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    // 메모 시트(zIndex 51)·툴바(zIndex 52)보다 아래에 깔리지 않도록
    // 시트보다 높은 zIndex를 부여한다. 툴바는 패널 위에 계속 보여야 하므로
    // 툴바(52)보다는 낮게 둔다 — 패널은 화면 하단, 툴바는 그 위 영역이라
    // 실제로 겹치지 않지만 순서를 명시한다.
    zIndex: 52,
    ...Platform.select({ android: { elevation: 8 } }),
  },
  panel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.18,
        shadowRadius: 14,
      },
      android: { elevation: 12 },
    }),
  },
  scroll: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 8,
  },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  addMenuRow: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  addMenuRowContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 10,
  },
  addMenuLabel: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard",
    }),
  },
  activeRow: {
    backgroundColor: "transparent",
  },
  label: {
    ...Typography.body,
    color: Colors.zinc700,
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard",
    }),
  },
  activeLabel: {
    color: Colors.zinc900,
    fontFamily: Platform.select({
      ios: "Pretendard-SemiBold",
      default: "Pretendard-SemiBold",
    }),
    fontWeight: "600",
  },
  checkmark: {
    fontSize: 16,
    color: Colors.zinc900,
  },
  sentenceItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  sentenceItemContent: {
    alignItems: "flex-start",
    gap: 4,
  },
  sentenceText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc900,
    lineHeight: 21,
  },
  sentenceSource: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 40,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    marginTop: 8,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    textAlign: "center",
  },
});
