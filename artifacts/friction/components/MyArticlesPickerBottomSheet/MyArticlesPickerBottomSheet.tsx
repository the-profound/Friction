import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import BottomSheet from "@/components/BottomSheet/BottomSheet";

interface ArticleStub {
  id: string;
  title: string;
  status: string;
  excerpt?: string;
}

interface MyArticlesPickerBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (articleIds: string[]) => void | Promise<void>;
  articles: ArticleStub[];
  alreadyAdded?: string[];
  multiSelect?: boolean;
}

export function MyArticlesPickerBottomSheet({
  visible,
  onClose,
  onSelect,
  articles,
  alreadyAdded = [],
  multiSelect = true,
}: MyArticlesPickerBottomSheetProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (multiSelect) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else {
          next.clear();
          next.add(id);
        }
        return next;
      });
    },
    [multiSelect],
  );

  const handleConfirm = useCallback(async () => {
    const ids = Array.from(selected);
    await onSelect(ids);
    setSelected(new Set());
    onClose();
  }, [selected, onSelect, onClose]);

  const letterArticles = articles.filter((a) => a.status === "LETTER");

  return (
    <BottomSheet visible={visible} onClose={onClose} title="내 편지 선택" snapPoints={[0.65]}>
      {letterArticles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Feather name="file-text" size={32} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>완성된 편지가 없어요</Text>
          <Text style={styles.emptySubtitle}>LETTER 상태의 편지만 추가할 수 있어요</Text>
        </View>
      ) : (
        <ScrollView
          nestedScrollEnabled
          style={styles.scrollView}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {letterArticles.map((item) => {
            const isAdded = alreadyAdded.includes(item.id);
            const isSelected = selected.has(item.id);
            return (
              <ScalePressable
                key={item.id}
                style={[styles.item, isSelected && styles.itemSelected]}
                onPress={() => !isAdded && toggleSelect(item.id)}
                disabled={isAdded}
              >
                <View style={styles.itemContent}>
                  <Text style={[styles.itemTitle, isAdded && styles.itemDisabled]} numberOfLines={1}>
                    {item.title || "제목 없음"}
                  </Text>
                  {item.excerpt && (
                    <Text style={styles.itemExcerpt} numberOfLines={1}>
                      {item.excerpt}
                    </Text>
                  )}
                </View>
                {isAdded ? (
                  <Text style={styles.addedLabel}>추가됨</Text>
                ) : (
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && <Feather name="check" size={14} color={Colors.white} />}
                  </View>
                )}
              </ScalePressable>
            );
          })}
        </ScrollView>
      )}
      {selected.size > 0 && (
        <ScalePressable style={styles.confirmButton} onPress={handleConfirm}>
          <Text style={styles.confirmButtonText}>
            {selected.size}개 추가
          </Text>
        </ScalePressable>
      )}
    </BottomSheet>
  );
}
export default MyArticlesPickerBottomSheet;

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  list: {
    paddingBottom: 16,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  itemSelected: {
    backgroundColor: Colors.zinc50,
  },
  itemContent: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  itemExcerpt: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  itemDisabled: {
    color: Colors.zinc400,
  },
  addedLabel: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
    marginLeft: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.zinc300,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  checkboxSelected: {
    backgroundColor: Colors.zinc900,
    borderColor: Colors.zinc900,
  },
  confirmButton: {
    marginTop: 12,
    marginBottom: 20,
    marginHorizontal: 0,
    paddingVertical: 16,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    alignItems: "center",
  },
  confirmButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  emptyContainer: {
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
