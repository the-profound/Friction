import React, { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import {
  getListNeighborsQueryKey,
  useListNeighbors,
} from "@workspace/api-client-react";
import type { NeighborWithUser } from "@workspace/api-client-react";

import ScalePressable from "@/components/shared/ScalePressable";
import SelectionModal, {
  SelectionModalState,
} from "@/components/shared/SelectionModal";
import { Colors, Spacing, Typography } from "@/constants/tokens";

export interface NeighborPickerModalProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  selectedNeighborId?: string | null;
  onSelect: (neighbor: NeighborWithUser) => void;
}

export function NeighborPickerModal({
  visible,
  onClose,
  userId,
  selectedNeighborId,
  onSelect,
}: NeighborPickerModalProps) {
  const query = useListNeighbors(
    { userId },
    {
      query: {
        enabled: visible && !!userId,
        queryKey: getListNeighborsQueryKey({ userId }),
      },
    },
  );
  const neighbors = useMemo(
    () => (query.data ?? []) as NeighborWithUser[],
    [query.data],
  );

  return (
    <SelectionModal visible={visible} onClose={onClose} title="사람 선택">
      {query.isLoading || query.isError || neighbors.length === 0 ? (
        <SelectionModalState
          isLoading={query.isLoading}
          isError={query.isError}
          onRetry={() => query.refetch()}
          emptyIcon="users"
          emptyTitle="아직 이웃이 없어요"
          emptyMessage="이웃만 사람으로 선택할 수 있어요"
        />
      ) : (
        <FlatList
          data={neighbors}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isSelected = item.neighborUserId === selectedNeighborId;
            const nickname = item.user?.nickname?.trim() || "이름 없음";
            return (
              <ScalePressable
                style={styles.row}
                contentStyle={[styles.rowContent, isSelected && styles.rowSelected]}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={`${nickname}${item.user?.email ? `, ${item.user.email}` : ""}`}
                accessibilityState={{ selected: isSelected }}
              >
                <View style={styles.avatar}>
                  <Feather name="user" size={19} color={Colors.zinc500} />
                </View>
                <View style={styles.textWrap}>
                  <Text style={styles.name} numberOfLines={1}>
                    {nickname}
                  </Text>
                  <Text style={styles.secondary} numberOfLines={1}>
                    {item.user?.email ?? ""}
                  </Text>
                </View>
                {isSelected ? (
                  <Feather
                    name="check"
                    size={18}
                    color={Colors.zinc900}
                    accessibilityLabel="선택됨"
                  />
                ) : null}
              </ScalePressable>
            );
          }}
        />
      )}
    </SelectionModal>
  );
}

export const PersonPickerModal = NeighborPickerModal;

const styles = StyleSheet.create({
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: Spacing.md,
  },
  row: {
    minHeight: 72,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  rowContent: {
    minHeight: 72,
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
  avatar: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: Colors.zinc100,
    flexGrow: 0,
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xs,
  },
  name: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  secondary: {
    ...Typography.caption,
    color: Colors.zinc500,
  },
});

export default NeighborPickerModal;