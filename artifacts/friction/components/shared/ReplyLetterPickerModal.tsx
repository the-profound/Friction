import React, { useMemo } from "react";

import {
  getListInboxQueryKey,
  useListInbox,
} from "@workspace/api-client-react";
import type { InboxItem } from "@workspace/api-client-react";

import { LetterPickerSelectionSheet } from "@/components/shared/LetterPickerSheet";
import type { LetterPickerListEntry } from "@/components/shared/LetterPickerList";
import { filterReadReplyLetters } from "@/lib/sendPickerPresentation";

export interface ReplyLetterPickerModalProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  selectedInboxId?: string | null;
  onSelect: (item: InboxItem) => void;
}

export function ReplyLetterPickerModal({
  visible,
  onClose,
  userId,
  selectedInboxId,
  onSelect,
}: ReplyLetterPickerModalProps) {
  const query = useListInbox(
    { recipientId: userId },
    {
      query: {
        enabled: visible && !!userId,
        queryKey: getListInboxQueryKey({ recipientId: userId }),
      },
    },
  );
  const letters = useMemo(() => {
    return filterReadReplyLetters((query.data ?? []) as InboxItem[]);
  }, [query.data]);
  const pickerItems = useMemo<LetterPickerListEntry<InboxItem>[]>(
    () =>
      letters.map((item) => ({
        id: item.id,
        title: item.article?.title || "제목 없음",
        authorName: item.senderDisplayName || "참여자",
        cover: item.article?.cover,
        sortAt: item.visibleAt,
        value: item,
      })),
    [letters],
  );

  return (
    <LetterPickerSelectionSheet
      visible={visible}
      onClose={onClose}
      title="답장할 편지 선택"
      items={pickerItems}
      isLoading={query.isLoading}
      isError={query.isError}
      onRefetch={() => query.refetch()}
      selectedId={selectedInboxId ?? null}
      onSelect={onSelect}
      emptyIcon="mail"
      emptyTitle="읽은 편지가 없어요"
      emptyMessage="읽은 편지만 답장할 편지로 선택할 수 있어요"
    />
  );
}

export const ReadLetterPickerModal = ReplyLetterPickerModal;

export default ReplyLetterPickerModal;
