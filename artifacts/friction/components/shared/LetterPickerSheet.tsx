import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import ScalePressable from "@/components/shared/ScalePressable";
import {
  LetterPickerList,
  type LetterPickerListEntry,
} from "@/components/shared/LetterPickerList";
import { LetterPickerGrid } from "@/components/shared/LetterPickerGrid";
import { Colors, Typography } from "@/constants/tokens";
import type { ArticleCover } from "@workspace/api-client-react";
import { getSendArticleAuthorName } from "@/lib/sendPickerPresentation";

export const DEFAULT_LETTER_PICKER_EMPTY_MESSAGE =
  "'편지' 상태의 글만 공유할 수 있어요. 기록함에서 단상을 작성하고, 검토 작업과 마감 작업을 거쳐, '편지'로 완성해주세요!";

export interface LetterPickerArticle {
  id: string;
  title?: string | null;
  authorNickname?: string | null;
  cover?: ArticleCover | null;
  createdAt?: string;
  updatedAt?: string;
}

interface LetterPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  articles: LetterPickerArticle[];
  isLoading: boolean;
  isError: boolean;
  onRefetch: () => void;
  selectedId: string | null;
  onSelect: (article: LetterPickerArticle) => void;
  emptyAction?: { label: string; onPress: () => void };
}

interface LetterPickerSelectionSheetProps<T> {
  visible: boolean;
  onClose: () => void;
  title: string;
  items: LetterPickerListEntry<T>[];
  isLoading: boolean;
  isError: boolean;
  onRefetch: () => void;
  selectedId: string | null;
  onSelect: (item: T) => void;
  emptyIcon?: React.ComponentProps<typeof Feather>["name"];
  emptyTitle: string;
  emptyMessage?: string;
  emptyAction?: { label: string; onPress: () => void };
  /**
   * "list" (default) renders the compact ArticleListItem rows every other
   * picker uses. "grid" renders the 3-column cover-card grid — currently
   * only the space-reservation schedule sheet opts into it via
   * LetterGridPickerSheet.
   */
  bodyVariant?: "list" | "grid";
}

export function LetterPickerSelectionSheet<T>({
  visible,
  onClose,
  title,
  items,
  isLoading,
  isError,
  onRefetch,
  selectedId,
  onSelect,
  emptyIcon = "file-text",
  emptyTitle,
  emptyMessage,
  emptyAction,
  bodyVariant = "list",
}: LetterPickerSelectionSheetProps<T>) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      snapPoints={[0.85]}
      keyboardAware
    >
      {isLoading ? (
        <View style={styles.empty}>
          <Text style={styles.emptySub}>불러오는 중...</Text>
        </View>
      ) : isError ? (
        <View style={styles.empty}>
          <Feather name="alert-circle" size={32} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기 실패</Text>
          <ScalePressable onPress={onRefetch}>
            <Text style={[styles.emptySub, { color: Colors.zinc900 }]}>
              다시 시도
            </Text>
          </ScalePressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Feather name={emptyIcon} size={32} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          {emptyMessage ? (
            <Text style={styles.emptySub}>{emptyMessage}</Text>
          ) : null}
          {emptyAction ? (
            <ScalePressable
              style={styles.emptyActionOuter}
              contentStyle={styles.emptyAction}
              onPress={emptyAction.onPress}
              accessibilityRole="button"
            >
              <Text style={styles.emptyActionText}>{emptyAction.label}</Text>
            </ScalePressable>
          ) : null}
        </View>
      ) : bodyVariant === "grid" ? (
        <LetterPickerGrid
          visible={visible}
          items={items}
          selectedId={selectedId}
          onSelect={(item) => {
            onSelect(item);
            onClose();
          }}
        />
      ) : (
        <LetterPickerList
          visible={visible}
          items={items}
          selectedId={selectedId}
          onSelect={(item) => {
            onSelect(item);
            onClose();
          }}
        />
      )}
    </BottomSheet>
  );
}

export function LetterPickerSheet({
  visible,
  onClose,
  articles,
  isLoading,
  isError,
  onRefetch,
  selectedId,
  onSelect,
  emptyAction,
}: LetterPickerSheetProps) {
  const pickerItems = useMemo<LetterPickerListEntry<LetterPickerArticle>[]>(
    () =>
      articles.map((article) => ({
        id: article.id,
        title: article.title || "제목 없음",
        authorName: getSendArticleAuthorName(article),
        cover: article.cover,
        sortAt: article.updatedAt || article.createdAt || "",
        value: article,
      })),
    [articles],
  );

  return (
    <LetterPickerSelectionSheet
      visible={visible}
      onClose={onClose}
      title="편지 선택"
      items={pickerItems}
      isLoading={isLoading}
      isError={isError}
      onRefetch={onRefetch}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyTitle="완성된 편지가 없어요"
      emptyMessage={DEFAULT_LETTER_PICKER_EMPTY_MESSAGE}
      emptyAction={emptyAction}
    />
  );
}

const styles = StyleSheet.create({
  empty: {
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
  emptySub: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    textAlign: "center",
  },
  emptyActionOuter: {
    marginTop: 8,
    height: 44,
    alignSelf: "center",
    flexGrow: 0,
    flexShrink: 0,
  },
  emptyAction: {
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: Colors.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyActionText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.primaryActionForeground,
  },
});
