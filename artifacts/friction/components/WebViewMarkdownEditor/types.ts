import type { ReactNode } from "react";

export interface EditorInitPayload {
  initialMarkdown: string;
  editorConfigVersion: string;
  placeholder?: string;
  titleValue?: string;
}

export interface OverflowRange {
  pageIndex: number;
  startCharOffset: number;
}

export type RNToWebViewCommand =
  | { type: "init"; payload: EditorInitPayload }
  | { type: "setMarkdown"; markdown: string }
  | { type: "setTitle"; title: string }
  | { type: "requestExportMarkdown"; requestId: string }
  | { type: "setEditable"; isEditable: boolean }
  | { type: "setSourceArticleSlot"; text: string }
  | { type: "setOverflowRanges"; ranges: OverflowRange[] | null }
  | { type: "setOverflowProbeConfig"; availableContentHeightPx: number | null }
  | { type: "setBodyMetrics"; fontSizePx: number; letterSpacingPx: number; titleFontSizePx?: number }
  | { type: "setBlockType"; blockType: string }
  | { type: "toggleMark"; mark: string }
  | { type: "insertDivider" }
  | { type: "insertHardBreak" }
  | { type: "insertImage"; url: string }
  | { type: "autoSplitImages" }
  | { type: "scrollToBlock"; pageIndex: number; blockIndex: number }
  | { type: "setSpellHighlight"; original: string; contextHint: string; occurrenceIndex: number }
  | { type: "clearSpellHighlight" }
  | { type: "applySpellFix"; original: string; replacement: string; contextHint: string; occurrenceIndex: number };

export interface OnChangePayload {
  isDirty: boolean;
  charCount?: number;
  wordCount?: number;
}

export interface OnExportMarkdownPayload {
  requestId: string;
  markdown: string;
  isDirty: boolean;
  docVersion?: number;
}

export interface OnErrorPayload {
  code: string;
  message: string;
}

export interface OnSelectionUpdatePayload {
  activeBlock: string;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
}

export type WebViewToRNEvent =
  | { type: "onReady" }
  | { type: "onChange"; payload: OnChangePayload }
  | { type: "onExportMarkdown"; payload: OnExportMarkdownPayload }
  | { type: "onTitleChange"; payload: { title: string } }
  | { type: "onError"; payload: OnErrorPayload }
  | { type: "onKeyboardShow" }
  | { type: "onKeyboardHide" }
  | { type: "onSwipeDownToDismiss" }
  | { type: "onSourceArticleSlotTap" }
  | { type: "onTextSelect"; text: string; isEmpty: boolean }
  | { type: "onSelectionUpdate"; payload: OnSelectionUpdatePayload }
  | { type: "onSelHandleDragStart" }
  | { type: "onSelHandleDragEnd" }
  | { type: "onAutoSplitComplete"; payload: { hadConsecutiveImages: boolean } };

export interface WebViewMarkdownEditorRef {
  setMarkdown: (markdown: string) => void;
  requestExportMarkdown: (requestId: string) => void;
  setEditable: (isEditable: boolean) => void;
  setTitle: (title: string) => void;
  blur: () => void;
  setOverflowRanges: (ranges: OverflowRange[] | null) => void;
  setOverflowProbeConfig: (availableContentHeightPx: number | null) => void;
  setBlockType: (blockType: string) => void;
  toggleMark: (mark: string) => void;
  insertDivider: () => void;
  insertHardBreak: () => void;
  insertImage: (url: string) => void;
  autoSplitImages: () => Promise<{ hadConsecutiveImages: boolean }>;
  scrollToBlock: (pageIndex: number, blockIndex: number) => void;
  setSpellHighlight: (original: string, contextHint: string, occurrenceIndex: number) => void;
  clearSpellHighlight: () => void;
  applySpellFix: (original: string, replacement: string, contextHint: string, occurrenceIndex: number) => void;
}

export interface WebViewMarkdownEditorProps {
  initialMarkdown: string;
  titleValue?: string;
  editorConfigVersion?: string;
  placeholder?: string;
  editable?: boolean;
  onReady?: () => void;
  onChange?: (payload: OnChangePayload) => void;
  onExportMarkdown?: (payload: OnExportMarkdownPayload) => void;
  onTitleChange?: (title: string) => void;
  onError?: (payload: OnErrorPayload) => void;
  onKeyboardVisibilityChange?: (visible: boolean) => void;
  onSelectionUpdate?: (payload: OnSelectionUpdatePayload) => void;
  belowTitleSlot?: ReactNode;
  sourceArticleSlotText?: string | null;
  onSourceArticleSlotTap?: () => void;
  bodyFontSize?: number;
  bodyLetterSpacing?: number;
  titleFontSize?: number;
  /**
   * 제목/원본연결 슬롯을 숨기고 하단 여백을 줄여 컴팩트한 "캡슐" 형태로
   * 렌더링한다. 읽기 메모(read.tsx)처럼 본문만 필요한 경우 사용한다.
   * 기본값 false — 기록 탭 등 기존 사용처는 영향 없음.
   */
  hideTitle?: boolean;
}
