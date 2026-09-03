import React, { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import {
  getListInboxQueryKey,
  useListInbox,
} from "@workspace/api-client-react";
import type { Article, InboxItem } from "@workspace/api-client-react";

import ScalePressable from "@/components/shared/ScalePressable";
import ArticleCardCover from "@/components/ArticleCardItem/ArticleCardCover";
import SelectionModal, {
  SelectionModalState,
} from "@/components/shared/SelectionModal";
import { Colors, Spacing, Typography } from "@/constants/tokens";
import { filterReadReplyLetters } from "@/lib/sendPickerPresentation";

export interface ReplyLetterPickerModalProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  selectedInboxId?: string | null;
  onSelect: (item: InboxItem) => void;
}

function LetterThumbnail({ article }: { article: Article }) {
  return (
    <View style={styles.thumbnail} accessibilityLabel="편지 표지">
      <ArticleCardCover
        cover={article.cover}
        title={article.title || "제목 없음"}
        width={52}
        height={68}
        borderRadius={7}
      />
    </View>
  );
}

export function ReplyLetterPickerModal({
  visible,
  onClose,
  userId,
  selectedInboxId,
  onSelect,
}: ReplyLetterPickerModalProps) {
  const query = useListInbox(
    { recipientId: userId },
    {
      query: {
        enabled: visible && !!userId,
        queryKey: getListInboxQueryKey({ recipientId: userId }),
      },
    },
  );
  const letters = useMemo(() => {
    return filterReadReplyLetters((query.data ?? []) as InboxItem[]);
  }, [query.data]);

  return (
    <SelectionModal visible={visible} onClose={onClose} title="답장할 편지 선택">
      {query.isLoading || query.isError || letters.length === 0 ? (
        <SelectionModalState
          isLoading={query.isLoading}
          isError={query.isError}
          onRetry={() => query.refetch()}
          emptyIcon="mail"
          emptyTitle="읽은 편지가 없어요"
          emptyMessage="읽은 편지만 답장할 편지로 선택할 수 있어요"
        />
      ) : (
        <FlatList
          data={letters}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const article = item.article!;
            const isSelected = item.id === selectedInboxId;
            return (
              <ScalePressable
                style={styles.row}
                contentStyle={[styles.rowContent, isSelected && styles.rowSelected]}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={`${article.title || "제목 없음"}${isSelected ? ", 선택됨" : ""}`}
                accessibilityState={{ selected: isSelected }}
              >
                <LetterThumbnail article={article} />
                <View style={styles.textWrap}>
                  <Text style={styles.title} numberOfLines={2}>
                    {article.title || "제목 없음"}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {item.senderDisplayName || "참여자"}
                  </Text>
                </View>
                {isSelected ? (
                  <Feather name="check" size={18} color={Colors.zinc900} />
                ) : null}
              </ScalePressable>
            );
          }}
        />
      )}
    </SelectionModal>
  );
}

export const ReadLetterPickerModal = ReplyLetterPickerModal;

const styles = StyleSheet.create({
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: Spacing.md,
  },
  row: {
    minHeight: 88,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  rowContent: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.lg,
    paddingHorizontal: Spacing.sm,
    flexGrow: 0,
    flexShrink: 0,
  },
  rowSelected: {
    backgroundColor: Colors.zinc50,
  },
  thumbnail: {
    width: 52,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: 7,
    flexGrow: 0,
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xs,
  },
  title: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  meta: {
    ...Typography.caption,
    color: Colors.zinc500,
  },
});

export default ReplyLetterPickerModal;