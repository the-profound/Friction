import React, { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import {
  getListInboxQueryKey,
  getListSpacesQueryKey,
  useListInbox,
  useListSpaces,
} from "@workspace/api-client-react";
import type { InboxItem, SpaceListItem } from "@workspace/api-client-react";

import BottomSheet from "@/components/BottomSheet/BottomSheet";
import ScalePressable from "@/components/shared/ScalePressable";
import { SelectionModalState } from "@/components/shared/SelectionModal";
import { LetterPickerGrid } from "@/components/shared/LetterPickerGrid";
import type { LetterPickerListEntry } from "@/components/shared/LetterPickerList";
import { Colors, Spacing, Typography } from "@/constants/tokens";
import { spaceStatusLabel, spaceStatusStyle } from "@/lib/spaceStatusStyle";
import {
  filterActiveParticipatingSpaces,
  filterReadReplyLetters,
  filterReplyLettersBySpace,
} from "@/lib/sendPickerPresentation";

export interface ReplyLetterPickerModalProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  selectedInboxId?: string | null;
  onSelect: (item: InboxItem) => void;
}

type ReplyPickerStep = "space" | "letters";

/**
 * 답장할 편지 선택 흐름: 공간 선택(1단계) → 그 공간에서 내가 받은, 답장
 * 가능한(읽음 + 도착 완료) 편지의 3열 그리드(2단계). 제목 검색창은 이
 * 흐름에서 쓰지 않는다 — 그리드에 최신순으로 전부 나열한다.
 *
 * 두 단계는 하나의 BottomSheet 안에서 진행된다 — 별도의 공간 선택 모달을
 * 빌려오지 않고, 그 모달이 쓰는 것과 동일한 데이터/시각 스타일만 이 시트
 * 본문 안에 직접 그린다. 그리드 단계의 "뒤로" 버튼만
 * 공간 단계로 되돌리고, 시트 자체의 닫기(배경 탭/드래그)는 두 단계 모두
 * 전체 흐름을 닫는다.
 */
export function ReplyLetterPickerModal({
  visible,
  onClose,
  userId,
  selectedInboxId,
  onSelect,
}: ReplyLetterPickerModalProps) {
  const [step, setStep] = useState<ReplyPickerStep>("space");
  const [selectedSpace, setSelectedSpace] = useState<SpaceListItem | null>(
    null,
  );

  // Every fresh entry into the reply flow starts at space selection — a
  // letters-step selection left over from a previous open must not survive.
  useEffect(() => {
    if (visible) {
      setStep("space");
      setSelectedSpace(null);
    }
  }, [visible]);

  const spacesQuery = useListSpaces(
    { userId },
    {
      query: {
        enabled: visible && !!userId,
        queryKey: getListSpacesQueryKey({ userId }),
      },
    },
  );
  const activeSpaces = useMemo(
    () =>
      filterActiveParticipatingSpaces(
        (spacesQuery.data ?? []) as SpaceListItem[],
      ),
    [spacesQuery.data],
  );

  const inboxQuery = useListInbox(
    { recipientId: userId },
    {
      query: {
        enabled: visible && !!userId,
        queryKey: getListInboxQueryKey({ recipientId: userId }),
      },
    },
  );
  const replyCandidates = useMemo(
    () => filterReadReplyLetters((inboxQuery.data ?? []) as InboxItem[]),
    [inboxQuery.data],
  );
  const spaceLetters = useMemo(
    () =>
      selectedSpace
        ? filterReplyLettersBySpace(replyCandidates, selectedSpace.id)
        : [],
    [replyCandidates, selectedSpace],
  );
  const pickerItems = useMemo<LetterPickerListEntry<InboxItem>[]>(
    () =>
      spaceLetters.map((item) => ({
        id: item.id,
        title: item.article?.title || "제목 없음",
        authorName: item.senderDisplayName || "참여자",
        cover: item.article?.cover,
        sortAt: item.visibleAt,
        value: item,
      })),
    [spaceLetters],
  );

  const isLettersStep = step === "letters" && !!selectedSpace;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={isLettersStep ? selectedSpace!.name : "공간 선택"}
      snapPoints={[0.85]}
      keyboardAware
      headerLeft={
        isLettersStep ? (
          <ScalePressable
            style={styles.backButton}
            contentStyle={styles.backButtonContent}
            onPress={() => setStep("space")}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="공간 선택으로 돌아가기"
          >
            <Feather name="chevron-left" size={20} color={Colors.zinc500} />
          </ScalePressable>
        ) : undefined
      }
    >
      {isLettersStep ? (
        inboxQuery.isLoading || inboxQuery.isError ? (
          <SelectionModalState
            isLoading={inboxQuery.isLoading}
            isError={inboxQuery.isError}
            onRetry={() => inboxQuery.refetch()}
            emptyIcon="mail"
            emptyTitle="답장할 수 있는 편지가 없어요"
          />
        ) : pickerItems.length === 0 ? (
          <SelectionModalState
            isLoading={false}
            isError={false}
            onRetry={() => inboxQuery.refetch()}
            emptyIcon="mail"
            emptyTitle="답장할 수 있는 편지가 없어요"
            emptyMessage="이 공간에서 받은 편지 중, 이미 읽고 도착 시각이 지난 편지만 답장으로 선택할 수 있어요"
          />
        ) : (
          <LetterPickerGrid
            visible={visible}
            items={pickerItems}
            selectedId={selectedInboxId ?? null}
            showSearch={false}
            onSelect={(item) => {
              onSelect(item);
              onClose();
            }}
          />
        )
      ) : spacesQuery.isLoading || spacesQuery.isError || activeSpaces.length === 0 ? (
        <SelectionModalState
          isLoading={spacesQuery.isLoading}
          isError={spacesQuery.isError}
          onRetry={() => spacesQuery.refetch()}
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
            const isSelected = item.id === selectedSpace?.id;
            const status = spaceStatusStyle(item.status);
            return (
              <ScalePressable
                style={styles.row}
                contentStyle={[styles.rowContent, isSelected && styles.rowSelected]}
                onPress={() => {
                  setSelectedSpace(item);
                  setStep("letters");
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
    </BottomSheet>
  );
}

export const ReadLetterPickerModal = ReplyLetterPickerModal;

export default ReplyLetterPickerModal;

const styles = StyleSheet.create({
  backButton: {
    width: 28,
    height: 28,
    flexGrow: 0,
    flexShrink: 0,
  },
  backButtonContent: {
    width: 28,
    height: 28,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
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
