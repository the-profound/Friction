export interface EditorInitPayload {
  initialMarkdown: string;
  editorConfigVersion: string;
  placeholder?: string;
}

export type RNToWebViewCommand =
  | { type: "init"; payload: EditorInitPayload }
  | { type: "setMarkdown"; markdown: string }
  | { type: "requestExportMarkdown"; requestId: string }
  | { type: "setEditable"; isEditable: boolean };

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
  | { type: "onError"; payload: OnErrorPayload };

export interface WebViewMarkdownEditorRef {
  setMarkdown: (markdown: string) => void;
  requestExportMarkdown: (requestId: string) => void;
  setEditable: (isEditable: boolean) => void;
}

export interface WebViewMarkdownEditorProps {
  initialMarkdown: string;
  editorConfigVersion?: string;
  placeholder?: string;
  editable?: boolean;
  onReady?: () => void;
  onChange?: (payload: OnChangePayload) => void;
  onExportMarkdown?: (payload: OnExportMarkdownPayload) => void;
  onError?: (payload: OnErrorPayload) => void;
}
