import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { ArticleCover } from "@workspace/api-client-react";

import ArticleListItem, {
  ARTICLE_LIST_ITEM_HEIGHT,
} from "@/components/ArticleListItem/ArticleListItem";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Sizing, Spacing, Typography } from "@/constants/tokens";
import { sortAndFilterLetterPickerItems } from "@/lib/sendPickerPresentation";

export interface LetterPickerListEntry<T> {
  id: string;
  title: string;
  authorName?: string | null;
  cover?: ArticleCover | null;
  sortAt: string;
  value: T;
}

interface LetterPickerListProps<T> {
  visible: boolean;
  items: LetterPickerListEntry<T>[];
  selectedId: string | null;
  onSelect: (item: T) => void;
}

const ITEM_EXTENT = ARTICLE_LIST_ITEM_HEIGHT + Spacing.cardGap;

export function LetterPickerList<T>({
  visible,
  items,
  selectedId,
  onSelect,
}: LetterPickerListProps<T>) {
  const listRef = useRef<FlatList<LetterPickerListEntry<T>>>(null);
  const hasAutoScrolledRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState("");

  const visibleItems = useMemo(
    () => sortAndFilterLetterPickerItems(items, searchQuery),
    [items, searchQuery],
  );

  useEffect(() => {
    if (visible) {
      hasAutoScrolledRef.current = false;
      setSearchQuery("");
      return;
    }
    setSearchQuery("");
  }, [visible]);

  useEffect(() => {
    if (!visible || !selectedId || hasAutoScrolledRef.current) return;
    const selectedIndex = visibleItems.findIndex(
      (item) => item.id === selectedId,
    );
    if (selectedIndex < 0) return;

    hasAutoScrolledRef.current = true;
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index: selectedIndex,
        animated: false,
        viewPosition: 0.5,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, visible, visibleItems]);

  const handleScrollToIndexFailed = ({
    index,
    averageItemLength,
  }: {
    index: number;
    averageItemLength: number;
  }) => {
    listRef.current?.scrollToOffset({
      offset: Math.max(0, index * averageItemLength),
      animated: false,
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <Feather name="search" size={16} color={Colors.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="제목으로 검색"
          placeholderTextColor={Colors.searchPlaceholder}
          cursorColor={Colors.cursorAccent}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          accessibilityLabel="편지 제목 검색"
        />
        {searchQuery.length > 0 ? (
          <ScalePressable
            style={styles.clearButton}
            contentStyle={styles.clearButtonContent}
            onPress={() => setSearchQuery("")}
            accessibilityRole="button"
            accessibilityLabel="검색어 지우기"
          >
            <Feather name="x" size={16} color={Colors.zinc400} />
          </ScalePressable>
        ) : null}
      </View>

      {visibleItems.length === 0 ? (
        <View style={styles.noResults}>
          <Text style={styles.noResultsText}>검색 결과가 없어요</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={visibleItems}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          getItemLayout={(_, index) => ({
            length: ITEM_EXTENT,
            offset: ITEM_EXTENT * index,
            index,
          })}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          renderItem={({ item }) => {
            const isSelected = item.id === selectedId;
            return (
              <ArticleListItem
                articleId={item.id}
                title={item.title}
                authorName={item.authorName}
                cover={item.cover}
                selected={isSelected}
                onPress={() => onSelect(item.value)}
                accessibilityLabel={`${item.title.trim() || "제목 없음"} 편지 선택${isSelected ? ", 선택됨" : ""}`}
              />
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
  searchRow: {
    height: Sizing.searchBarHeight,
    marginHorizontal: Spacing.screenPx,
    marginBottom: Spacing.cardGap,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderRadius: Sizing.searchBarHeight / 2,
    backgroundColor: Colors.searchBarBg,
  },
  searchInput: {
    ...Typography.searchInput,
    flex: 1,
    minWidth: 0,
    color: Colors.searchText,
    padding: 0,
  },
  clearButton: {
    width: 36,
    height: 36,
    flexGrow: 0,
    flexShrink: 0,
  },
  clearButtonContent: {
    width: 36,
    height: 36,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: Spacing.xl,
  },
  noResults: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
  },
  noResultsText: {
    ...Typography.body,
    color: Colors.zinc500,
  },
});
