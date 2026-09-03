import React, { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import {
  getListSpacesQueryKey,
  useListSpaces,
} from "@workspace/api-client-react";
import type { SpaceListItem } from "@workspace/api-client-react";

import ScalePressable from "@/components/shared/ScalePressable";
import SelectionModal, {
  SelectionModalState,
} from "@/components/shared/SelectionModal";
import { Colors, Spacing, Typography } from "@/constants/tokens";
import { spaceStatusLabel, spaceStatusStyle } from "@/lib/spaceStatusStyle";
import { filterActiveParticipatingSpaces } from "@/lib/sendPickerPresentation";

export interface SpacePickerModalProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  selectedSpaceId?: string | null;
  onSelect: (space: SpaceListItem) => void;
}

export function SpacePickerModal({
  visible,
  onClose,
  userId,
  selectedSpaceId,
  onSelect,
}: SpacePickerModalProps) {
  const query = useListSpaces(
    { userId },
    {
      query: {
        enabled: visible && !!userId,
        queryKey: getListSpacesQueryKey({ userId }),
      },
    },
  );
  const activeSpaces = useMemo(
    () => filterActiveParticipatingSpaces((query.data ?? []) as SpaceListItem[]),
    [query.data],
  );

  return (
    <SelectionModal visible={visible} onClose={onClose} title="공간 선택">
      {query.isLoading || query.isError || activeSpaces.length === 0 ? (
        <SelectionModalState
          isLoading={query.isLoading}
          isError={query.isError}
          onRetry={() => query.refetch()}
          emptyIcon="layers"
          emptyTitle="진행 중인 공간이 없어요"
          emptyMessage="참여 중인 ACTIVE 공간만 선택할 수 있어요"
        />
      ) : (
        <FlatList
          data={activeSpaces}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isSelected = item.id === selectedSpaceId;
            const status = spaceStatusStyle(item.status);
            return (
              <ScalePressable
                style={styles.row}
                contentStyle={[styles.rowContent, isSelected && styles.rowSelected]}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, 참여자 ${item.participantCount}명, ${spaceStatusLabel(item.status)}`}
                accessibilityState={{ selected: isSelected }}
              >
                <View style={styles.icon}>
                  <Feather name="layers" size={20} color={Colors.zinc500} />
                </View>
                <View style={styles.textWrap}>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    참여자 {item.participantCount}명
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusTag,
                    {
                      backgroundColor: status.backgroundColor,
                      borderColor: status.borderColor,
                      borderWidth: status.borderWidth,
                    },
                  ]}
                >
                  <Text style={[styles.statusText, { color: status.textColor }]}>
                    {spaceStatusLabel(item.status)}
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

export const ActiveSpacePickerModal = SpacePickerModal;

const styles = StyleSheet.create({
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: Spacing.md,
  },
  row: {
    minHeight: 82,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  rowContent: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.sm,
    flexGrow: 0,
    flexShrink: 0,
  },
  rowSelected: {
    backgroundColor: Colors.zinc50,
  },
  icon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
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
  meta: {
    ...Typography.caption,
    color: Colors.zinc500,
  },
  statusTag: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: 999,
    flexGrow: 0,
    flexShrink: 0,
  },
  statusText: {
    ...Typography.captionMedium,
    fontSize: 12,
  },
});

export default SpacePickerModal;