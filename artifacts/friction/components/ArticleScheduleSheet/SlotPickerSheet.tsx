import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Typography } from "@/constants/tokens";

/** A single reservable slot: either one round's opening-letter slot (one per
 * round, only offered while that round doesn't already have a PENDING/SENT
 * opening reservation), or one of the user's assigned CENTER round slots.
 * Only slots that don't already have a PENDING or SENT reservation should
 * ever appear here. */
export type EmptySlot =
  | { kind: "opening"; roundId: string; roundNumber: number | null; maxDate: string | null }
  | { kind: "center"; date: string; roundId: string; roundNumber: number | null };

function formatShortDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${m}/${d}`;
}

function slotItemLabel(slot: EmptySlot): string {
  if (slot.kind === "opening") {
    const roundLabel = slot.roundNumber != null ? `${slot.roundNumber}회차` : "";
    return `${roundLabel} 여는 편지`;
  }
  const roundLabel = slot.roundNumber != null ? `${slot.roundNumber}회차` : "중심글";
  return `${roundLabel} 중심글 · ${formatShortDate(slot.date)} 06:00`;
}

interface SlotPickerSheetProps {
  visible: boolean;
  isLoading: boolean;
  slots: EmptySlot[];
  onSelect: (slot: EmptySlot) => void;
  onClose: () => void;
}

/** First step of the "새 글 예약하기" flow: pick which empty slot the new
 * letter should fill before choosing which article goes into it. */
export function SlotPickerSheet({
  visible,
  isLoading,
  slots,
  onSelect,
  onClose,
}: SlotPickerSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="어디에 올릴까요?" snapPoints={[0.6]}>
      {isLoading ? (
        <View style={styles.empty}>
          <Text style={styles.emptySub}>불러오는 중...</Text>
        </View>
      ) : slots.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="check-circle" size={32} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>이미 글을 모두 올렸어요!</Text>
        </View>
      ) : (
        <ScrollView
          nestedScrollEnabled
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {slots.map((slot, idx) => (
            <ScalePressable
              key={slot.kind === "opening" ? `opening:${slot.roundId}` : `${slot.roundId}:${slot.date}`}
              style={[styles.item, idx === 0 && styles.itemFirst]}
              contentStyle={styles.itemContent}
              onPress={() => onSelect(slot)}
            >
              <Feather
                name={slot.kind === "opening" ? "mail" : "edit-3"}
                size={16}
                color={Colors.zinc500}
              />
              <Text style={styles.itemText}>{slotItemLabel(slot)}</Text>
              <Feather name="chevron-right" size={16} color={Colors.zinc300} />
            </ScalePressable>
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
  item: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  itemContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 4,
  },
  itemFirst: {
    borderTopWidth: 0,
  },
  itemText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
    flex: 1,
  },
});
