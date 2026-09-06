import React, { useMemo } from "react";

import {
  LetterPickerSelectionSheet,
  type LetterPickerArticle,
} from "@/components/shared/LetterPickerSheet";
import type { LetterPickerListEntry } from "@/components/shared/LetterPickerList";
import { getSendArticleAuthorName } from "@/lib/sendPickerPresentation";

export type { LetterPickerArticle } from "@/components/shared/LetterPickerSheet";

interface LetterGridPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  articles: LetterPickerArticle[];
  isLoading: boolean;
  isError: boolean;
  onRefetch: () => void;
  selectedId: string | null;
  onSelect: (article: LetterPickerArticle) => void;
  emptyAction?: { label: string; onPress: () => void };
}

/**
 * 공간 예약 흐름("글 예약 발신" / "여는 편지 글 선택") 전용 편지 선택 시트.
 *
 * 다른 화면(공간 생성 마법사의 여는 편지 설정, 개인 간 편지 보내기, 답장 편지
 * 선택)은 계속 LetterPickerSheet의 압축된 리스트형 UI를 쓴다 — 이 컴포넌트는
 * 예약 흐름에서만 사용하며, "수신자만 볼 수 있는 편지" 화면과 동일한 3열 표지
 * 카드 그리드(bodyVariant="grid")로 편지를 나열한다. 바텀시트 틀, 제목 검색창,
 * 로딩/에러/빈 상태 문구는 LetterPickerSelectionSheet를 통해 그대로 재사용한다.
 * 카드를 탭하면 별도 선택 모드 없이 즉시 onSelect가 호출되고 시트가 닫힌다.
 */
export function LetterGridPickerSheet({
  visible,
  onClose,
  articles,
  isLoading,
  isError,
  onRefetch,
  selectedId,
  onSelect,
  emptyAction,
}: LetterGridPickerSheetProps) {
  const pickerItems = useMemo<LetterPickerListEntry<LetterPickerArticle>[]>(
    () =>
      articles.map((article) => ({
        id: article.id,
        title: article.title || "제목 없음",
        authorName: getSendArticleAuthorName(article),
        cover: article.cover,
        sortAt: article.updatedAt || article.createdAt || "",
        value: article,
      })),
    [articles],
  );

  return (
    <LetterPickerSelectionSheet
      visible={visible}
      onClose={onClose}
      title="편지 선택"
      items={pickerItems}
      isLoading={isLoading}
      isError={isError}
      onRefetch={onRefetch}
      selectedId={selectedId}
      onSelect={onSelect}
      bodyVariant="grid"
      emptyTitle="완성된 편지가 없어요"
      emptyMessage="LETTER 상태의 편지만 보낼 수 있어요"
      emptyAction={emptyAction}
    />
  );
}

export default LetterGridPickerSheet;
