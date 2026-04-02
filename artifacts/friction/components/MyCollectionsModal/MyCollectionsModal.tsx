import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import { Colors, Typography, Spacing } from "@/constants/tokens";

export interface CollectionItem {
  id: string;
  name: string;
  articleCount?: number;
}

interface MyCollectionsModalProps {
  visible: boolean;
  onClose: () => void;
  collections: CollectionItem[];
  selectedCollectionId?: string;
  onSelect: (collection: CollectionItem) => void;
  isLoading?: boolean;
}

export default function MyCollectionsModal({
  visible,
  onClose,
  collections,
  selectedCollectionId,
  onSelect,
  isLoading = false,
}: MyCollectionsModalProps) {
  const handleSelect = useCallback(
    (item: CollectionItem) => {
      onSelect(item);
      onClose();
    },
    [onSelect, onClose],
  );

  const renderItem = useCallback(
    ({ item }: { item: CollectionItem }) => {
      const isSelected = item.id === selectedCollectionId;
      return (
        <Pressable
          style={[styles.item, isSelected && styles.itemSelected]}
          onPress={() => handleSelect(item)}
        >
          <View style={styles.itemLeft}>
            <Feather
              name="folder"
              size={18}
              color={isSelected ? Colors.zinc900 : Colors.zinc500}
            />
            <Text style={[styles.itemName, isSelected && styles.itemNameSelected]}>
              {item.name}
            </Text>
          </View>
          <View style={styles.itemRight}>
            {item.articleCount !== undefined && (
              <Text style={styles.itemCount}>{item.articleCount}편</Text>
            )}
            {isSelected && (
              <Feather name="check" size={16} color={Colors.zinc900} />
            )}
          </View>
        </Pressable>
      );
    },
    [selectedCollectionId, handleSelect],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="보관할 모음 선택"
      snapPoints={[0.5]}
    >
      <View style={styles.container}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={Colors.zinc400} />
            <Text style={styles.loadingText}>모음 불러오는 중...</Text>
          </View>
        ) : collections.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>보관할 모음이 없습니다</Text>
          </View>
        ) : (
          <FlatList
            data={collections}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 8,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  itemSelected: {
    backgroundColor: Colors.zinc50,
  },
  itemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  itemName: {
    ...Typography.body,
    color: Colors.zinc700,
    flex: 1,
  },
  itemNameSelected: {
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
  },
  itemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  itemCount: {
    fontSize: 13,
    color: Colors.zinc400,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.zinc100,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.zinc400,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.zinc400,
  },
});
