import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TextInput,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { Feather } from "@expo/vector-icons";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import { Colors, Typography, Spacing } from "@/constants/tokens";

export interface CollectionItem {
  id: string;
  name: string;
  articleCount?: number;
}

type ModalTab = "list" | "create";

interface MyCollectionsModalProps {
  visible: boolean;
  onClose: () => void;
  collections: CollectionItem[];
  selectedCollectionId?: string;
  onSelect: (collection: CollectionItem) => void;
  onCreateAndSelect?: (name: string, description: string) => Promise<void>;
  isLoading?: boolean;
}

export default function MyCollectionsModal({
  visible,
  onClose,
  collections,
  selectedCollectionId,
  onSelect,
  onCreateAndSelect,
  isLoading = false,
}: MyCollectionsModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>("list");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const resetForm = useCallback(() => {
    setNewName("");
    setNewDescription("");
    setActiveTab("list");
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSelect = useCallback(
    (item: CollectionItem) => {
      resetForm();
      onSelect(item);
    },
    [onSelect, resetForm],
  );

  const handleCreate = useCallback(async () => {
    if (!newName.trim() || !onCreateAndSelect) return;
    setIsCreating(true);
    try {
      await onCreateAndSelect(newName.trim(), newDescription.trim());
      resetForm();
    } finally {
      setIsCreating(false);
    }
  }, [newName, newDescription, onCreateAndSelect, resetForm]);

  const renderItem = useCallback(
    ({ item }: { item: CollectionItem }) => {
      const isSelected = item.id === selectedCollectionId;
      return (
        <ScalePressable
          onPress={() => handleSelect(item)}
          contentStyle={[styles.itemContent, isSelected && styles.itemSelected]}
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
        </ScalePressable>
      );
    },
    [selectedCollectionId, handleSelect],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title="보관할 모음 선택"
      snapPoints={[0.75]}
      keyboardAware
    >
      <View style={styles.container}>
        {onCreateAndSelect && (
          <View style={styles.tabBar}>
            <ScalePressable onPress={() => setActiveTab("list")}>
              <View style={[styles.tab, activeTab === "list" && styles.tabActive]}>
                <Text style={[styles.tabText, activeTab === "list" && styles.tabTextActive]}>
                  내 모음
                </Text>
              </View>
            </ScalePressable>
            <ScalePressable onPress={() => setActiveTab("create")}>
              <View style={[styles.tab, activeTab === "create" && styles.tabActive]}>
                <Text style={[styles.tabText, activeTab === "create" && styles.tabTextActive]}>
                  새 모음에 추가
                </Text>
              </View>
            </ScalePressable>
          </View>
        )}

        {activeTab === "list" ? (
          isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={Colors.zinc400} />
              <Text style={styles.loadingText}>모음 불러오는 중...</Text>
            </View>
          ) : collections.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>보관할 모음이 없어요</Text>
              <Text style={styles.emptySubtext}>새 모음에 추가 탭에서 만들어보세요</Text>
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
          )
        ) : (
          <View style={styles.createForm}>
            <TextInput
              style={styles.createInput}
              placeholder="모음 이름"
              placeholderTextColor={Colors.zinc400}
              cursorColor={Colors.cursorAccent}
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <TextInput
              style={[styles.createInput, styles.createInputMulti]}
              placeholder="설명 (선택사항)"
              placeholderTextColor={Colors.zinc400}
              cursorColor={Colors.cursorAccent}
              value={newDescription}
              onChangeText={setNewDescription}
              multiline
              textAlignVertical="top"
            />
            <ScalePressable
              onPress={handleCreate}
              disabled={!newName.trim() || isCreating}
            >
              <View style={[styles.confirmButton, (!newName.trim() || isCreating) && styles.confirmDisabled]}>
                {isCreating ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.confirmButtonText}>만들기</Text>
                )}
              </View>
            </ScalePressable>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabBar: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.zinc50,
  },
  tabActive: {
    backgroundColor: Colors.zinc900,
  },
  tabText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc500,
  },
  tabTextActive: {
    color: Colors.white,
    fontWeight: "600",
  },
  listContent: {
    paddingVertical: 4,
  },
  itemContent: {
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
    color: Colors.zinc500,
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
    color: Colors.zinc500,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 6,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.zinc500,
  },
  emptySubtext: {
    fontSize: 13,
    color: Colors.zinc500,
  },
  createForm: {
    paddingTop: 4,
    gap: 12,
  },
  createInput: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc900,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  createInputMulti: {
    minHeight: 72,
    lineHeight: 22,
  },
  confirmButton: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  confirmDisabled: {
    backgroundColor: Colors.zinc300,
  },
  confirmButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
});
