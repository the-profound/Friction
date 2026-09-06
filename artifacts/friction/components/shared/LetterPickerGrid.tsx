import React, { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";

import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import CanonicalCardSlot from "@/components/ArticleCardItem/CanonicalCardSlot";
import { Colors, Sizing, Spacing, Typography } from "@/constants/tokens";
import { sortAndFilterLetterPickerItems } from "@/lib/sendPickerPresentation";
import {
  LetterPickerSearchBar,
  type LetterPickerListEntry,
} from "@/components/shared/LetterPickerList";

interface LetterPickerGridProps<T> {
  visible: boolean;
  items: LetterPickerListEntry<T>[];
  selectedId: string | null;
  onSelect: (item: T) => void;
}

const GRID_COLS = 3;
const GRID_GAP = 4;

/**
 * Grid variant of the letter-picker body: same search bar, filtering, and
 * selection contract as LetterPickerList, but the results render as the
 * same 3-column cover-card grid used by the "수신자만 볼 수 있는 편지"
 * screen (ArticleCardItem projected through CanonicalCardSlot) instead of
 * compact list rows. Tapping a card selects it immediately — there is no
 * separate selection mode or overlay here; the caller (LetterPickerSelectionSheet)
 * closes the sheet right after onSelect fires.
 */
export function LetterPickerGrid<T>({
  visible,
  items,
  selectedId,
  onSelect,
}: LetterPickerGridProps<T>) {
  const { width: windowWidth } = useWindowDimensions();
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setSearchQuery("");
  }, [visible]);

  const visibleItems = useMemo(
    () => sortAndFilterLetterPickerItems(items, searchQuery),
    [items, searchQuery],
  );

  const rows = useMemo(() => {
    const result: LetterPickerListEntry<T>[][] = [];
    for (let i = 0; i < visibleItems.length; i += GRID_COLS) {
      result.push(visibleItems.slice(i, i + GRID_COLS));
    }
    return result;
  }, [visibleItems]);

  // The grid sits directly inside the sheet's own padded content area (same
  // Spacing.screenPx gutter the search bar already uses via marginHorizontal),
  // so cell width is derived the same way the recipient-only-letters grid
  // derives it — full window width minus that one gutter on each side.
  const cellWidth =
    (windowWidth - Spacing.screenPx * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const cellHeight = cellWidth * Sizing.cardRatio;

  return (
    <View style={styles.container}>
      <LetterPickerSearchBar value={searchQuery} onChange={setSearchQuery} />

      {visibleItems.length === 0 ? (
        <View style={styles.noResults}>
          <Text style={styles.noResultsText}>검색 결과가 없어요</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(_, index) => `row-${index}`}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: rowItems }) => (
            <View style={styles.gridRow}>
              {rowItems.map((entry) => {
                const isSelected = entry.id === selectedId;
                return (
                  <View
                    key={entry.id}
                    style={[styles.gridCell, { width: cellWidth }]}
                  >
                    <CanonicalCardSlot width={cellWidth} height={cellHeight}>
                      <ArticleCardItem
                        title={entry.title}
                        authorName={entry.authorName ?? undefined}
                        cover={entry.cover}
                        isActive
                        onPress={() => onSelect(entry.value)}
                      />
                    </CanonicalCardSlot>
                    {isSelected ? (
                      <View style={styles.selectedIndicator} pointerEvents="none">
                        <Feather name="check" size={14} color={Colors.zinc900} />
                      </View>
                    ) : null}
                  </View>
                );
              })}
              {Array.from({ length: GRID_COLS - rowItems.length }).map((_, i) => (
                <View key={`fill-${i}`} style={{ width: cellWidth }} />
              ))}
            </View>
          )}
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
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: Spacing.xl,
  },
  gridRow: {
    flexDirection: "row",
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  gridCell: {
    overflow: "hidden",
    position: "relative",
  },
  selectedIndicator: {
    position: "absolute",
    bottom: 8,
    left: 8,
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
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
