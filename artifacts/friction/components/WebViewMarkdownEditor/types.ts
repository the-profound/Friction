import type { ReactNode } from "react";

export interface EditorInitPayload {
  initialMarkdown: string;
  editorConfigVersion: string;
  placeholder?: string;
  titleValue?: string;
}

export type RNToWebViewCommand =
  | { type: "init"; payload: EditorInitPayload }
  | { type: "setMarkdown"; markdown: string }
  | { type: "setTitle"; title: string }
  | { type: "requestExportMarkdown"; requestId: string }
  | { type: "setEditable"; isEditable: boolean }
  | { type: "setSourceArticleSlot"; text: string };

export interface OnChangePayload {
  isDirty: boolean;
  charCount?: number;
  wordCount?: number;
}

export interface OnExportMarkdownPayload {
  requestId: string;
  markdown: string;
  isDirty: boolean;
}

export interface OnErrorPayload {
  code: string;
  message: string;
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
  | { type: "onSourceArticleSlotTap" };

export interface WebViewMarkdownEditorRef {
  setMarkdown: (markdown: string) => void;
  requestExportMarkdown: (requestId: string) => void;
  setEditable: (isEditable: boolean) => void;
  setTitle: (title: string) => void;
  blur: () => void;
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
  belowTitleSlot?: ReactNode;
  sourceArticleSlotText?: string | null;
  onSourceArticleSlotTap?: () => void;
}
