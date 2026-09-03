import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import ScalePressable from "@/components/shared/ScalePressable";
import ArticleListItem from "@/components/ArticleListItem/ArticleListItem";
import { Colors, Typography } from "@/constants/tokens";
import type { ArticleCover } from "@workspace/api-client-react";
import { getSendArticleAuthorName } from "@/lib/sendPickerPresentation";

export interface LetterPickerArticle {
  id: string;
  title?: string | null;
  authorNickname?: string | null;
  cover?: ArticleCover | null;
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
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="편지 선택"
      snapPoints={[0.85]}
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
            <Text style={[styles.emptySub, { color: Colors.zinc900 }]}>다시 시도</Text>
          </ScalePressable>
        </View>
      ) : articles.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="file-text" size={32} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>완성된 편지가 없어요</Text>
          <Text style={styles.emptySub}>LETTER 상태의 편지만 보낼 수 있어요</Text>
          {emptyAction && (
            <ScalePressable
              style={styles.emptyActionOuter}
              contentStyle={styles.emptyAction}
              onPress={emptyAction.onPress}
            >
              <Text style={styles.emptyActionText}>{emptyAction.label}</Text>
            </ScalePressable>
          )}
        </View>
      ) : (
        <ScrollView
          nestedScrollEnabled
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {articles.map((article) => (
            <ArticleListItem
              key={article.id}
              articleId={article.id}
              title={article.title || "제목 없음"}
              authorName={getSendArticleAuthorName(article)}
              cover={article.cover}
              selected={selectedId === article.id}
              onPress={() => {
                onSelect(article);
                onClose();
              }}
              accessibilityLabel={`${article.title?.trim() || "제목 없음"} 편지 선택`}
            />
          ))}
        </ScrollView>
      )}
    </BottomSheet>
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
  },
  emptyActionOuter: {
    marginTop: 8,
  },
  emptyAction: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.zinc900,
  },
  emptyActionText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
});
