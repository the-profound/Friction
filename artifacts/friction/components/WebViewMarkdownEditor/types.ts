import type { ReactNode } from "react";
import type { BodyTypographyMetrics } from "@/lib/bodyLayout";

export interface EditorInitPayload {
  initialMarkdown: string;
  editorConfigVersion: string;
  editorSessionId: string;
  typography: BodyTypographyMetrics;
  layoutGeneration: number;
  placeholder?: string;
  titleValue?: string;
  /**
   * true면 TipTap 에디터 setup(setupEditor) 이전에 제목 영역을 숨긴 채
   * 렌더링한다. onReady 이후 별도 injection으로 뒤늦게 숨기면 제목 입력창이
   * 잠깐 노출되는 flash가 생기므로, init 페이로드에 포함시켜 최초 렌더링부터
   * 반영한다.
   */
  hideTitle?: boolean;
  /**
   * 마지막 블록이 비본문 블록일 때 커서용 빈 단락을 덧붙일지 여부.
   * 기본값은 true로, 기존 편집기의 이어쓰기 동작을 유지한다.
   */
  ensureTrailingParagraph?: boolean;
}

export interface OverflowRange {
  pageIndex: number;
  startCharOffset: number;
}

export type RNToWebViewCommand =
  | { type: "init"; payload: EditorInitPayload }
  | { type: "undo" }
  | { type: "redo" }
  | {
      type: "setMarkdown";
      markdown: string;
      ensureTrailingParagraph?: boolean;
      focusAtStart?: boolean;
    }
  | { type: "setTitle"; title: string }
  | { type: "requestExportMarkdown"; requestId: string }
  | { type: "setEditable"; isEditable: boolean }
  | { type: "setOverflowRanges"; ranges: OverflowRange[] | null }
  | { type: "setOverflowProbeConfig"; availableContentHeightPx: number | null; autoSplit?: boolean }
  | { type: "setBodyMetrics"; metrics: BodyTypographyMetrics; layoutGeneration: number }
  | { type: "setBodyFontMode"; mode: "fallback" }
  | { type: "setContentBottomPadding"; paddingPx: number }
  | { type: "setBlockType"; blockType: string }
  | { type: "toggleMark"; mark: string }
  | { type: "insertDivider" }
  | { type: "insertHardBreak" }
  | { type: "insertQuote"; text: string }
  | { type: "autoSplitImages" }
  | { type: "scrollToBlock"; pageIndex: number; blockIndex: number }
  | { type: "setSpellHighlight"; original: string; contextHint: string; occurrenceIndex: number }
  | { type: "clearSpellHighlight" }
  | { type: "applySpellFix"; original: string; replacement: string; contextHint: string; occurrenceIndex: number };

export interface OnChangePayload {
  isDirty: boolean;
  charCount?: number;
  wordCount?: number;
  markdown?: string;
  docVersion?: number;
  editorSessionId?: string;
}

export interface OnExportMarkdownPayload {
  requestId: string;
  markdown?: string;
  /** Title captured in the same editor turn as markdown. */
  title?: string;
  isDirty: boolean;
  docVersion?: number;
  editorSessionId?: string;
  error?: OnErrorPayload;
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
  canUndo?: boolean;
  canRedo?: boolean;
}

export type WebViewToRNEvent =
  | ({ type: "onBodyFontsReady" } & import("@/components/shared/bodyTypographyFonts").BodyFontReadyStatus)
  | { type: "onBodyTypographyDiagnostic"; payload: import("@/lib/bodyTypographyDiagnostics").BodyTypographyDiagnostic }
  | { type: "onReady"; payload?: { editorSessionId?: string } }
  | { type: "onChange"; payload: OnChangePayload }
  | { type: "onExportMarkdown"; payload: OnExportMarkdownPayload }
  | { type: "onTitleChange"; payload: { title: string } }
  | { type: "onError"; payload: OnErrorPayload }
  | { type: "onKeyboardShow" }
  | { type: "onKeyboardHide" }
  | { type: "onSwipeDownToDismiss" }
  | { type: "onTextSelect"; text: string; isEmpty: boolean }
  | { type: "onSelectionUpdate"; payload: OnSelectionUpdatePayload }
  | { type: "onSelHandleDragStart" }
  | { type: "onSelHandleDragEnd" }
  | { type: "onAutoSplitComplete"; payload: { hadConsecutiveImages: boolean } }
  | { type: "onOverflowSplit"; payload: { beforeMarkdown: string; afterMarkdown: string } };

export interface WebViewMarkdownEditorRef {
  setMarkdown: (markdown: string, options?: { focusAtStart?: boolean }) => void;
  requestExportMarkdown: (requestId: string) => void;
  setEditable: (isEditable: boolean) => void;
  setTitle: (title: string) => void;
  focus: () => void;
  focusStart: () => void;
  blur: () => void;
  undo: () => void;
  redo: () => void;
  setOverflowRanges: (ranges: OverflowRange[] | null) => void;
  setOverflowProbeConfig: (availableContentHeightPx: number | null, autoSplit?: boolean) => void;
  setBlockType: (blockType: string) => void;
  toggleMark: (mark: string) => void;
  insertDivider: () => void;
  insertHardBreak: () => void;
  insertQuote: (text: string) => void;
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
  /**
   * 마지막 블록이 비본문 블록일 때 커서용 빈 단락을 덧붙일지 여부.
   * 기본값은 true — 기록/메모/편지 편집기의 기존 동작을 유지한다.
   */
  ensureTrailingParagraph?: boolean;
  editable?: boolean;
  onReady?: (editorSessionId?: string) => void;
  onReload?: (editorSessionId: string) => void;
  onChange?: (payload: OnChangePayload) => void;
  onExportMarkdown?: (payload: OnExportMarkdownPayload) => void;
  onTitleChange?: (title: string) => void;
  onError?: (payload: OnErrorPayload) => void;
  onKeyboardVisibilityChange?: (visible: boolean) => void;
  onSelectionUpdate?: (payload: OnSelectionUpdatePayload) => void;
  /**
   * 사용자가 선택 핸들을 드래그해 텍스트 범위를 조정하는 동안 true.
   * 이 구간 동안은 상위 스와이프 제스처(예: 메모 페이지 3D 플립)를 비활성화해야
   * 선택 조작이 페이지 넘김으로 오인되지 않는다.
   */
  onTextSelectionActiveChange?: (active: boolean) => void;
  belowTitleSlot?: ReactNode;
  /** Required for letter bodies; memo constructs its own explicit contract. */
  typography: BodyTypographyMetrics;
  /**
   * 제목을 숨기고 하단 여백을 줄여 컴팩트한 "캡슐" 형태로
   * 렌더링한다. 읽기 메모(read.tsx)처럼 본문만 필요한 경우 사용한다.
   * 기본값 false — 기록 탭 등 기존 사용처는 영향 없음.
   */
  hideTitle?: boolean;
  /**
   * WebView 내부 자동 스크롤(예: 캐럿을 화면에 보이도록 하는 브라우저 기본
   * 동작)을 막기 위해 RN WebView 컴포넌트 자체의 스크롤을 비활성화한다.
   * 메모 모드처럼 페이지가 고정 크기이고 넘치는 내용은 오버플로 감지로
   * 다음 페이지로 넘겨야 하는 화면에서 사용한다. 기본값 true(기존 동작 유지).
   */
  scrollEnabled?: boolean;
  /**
   * Native WebView 문서 끝의 스크롤 여백. 화면이 키보드/툴바를 레이아웃에서
   * 이미 제외한 경우 작은 값으로 낮춰 같은 공간을 두 번 차감하지 않는다.
   * 기본값은 기존 네이티브 편집기 동작과 같은 120px이다.
   */
  contentBottomPadding?: number;
  /**
   * 오버플로 감지(runOverflowProbe)가 활성화된 상태에서 현재 페이지 내용이
   * 가용 높이를 넘으면 호출된다. `beforeMarkdown`은 잘라낸 앞부분(현재
   * 페이지에 남길 내용), `afterMarkdown`은 넘친 뒷부분(다음 페이지로 옮길
   * 내용)이다.
   */
  onOverflowSplit?: (payload: { beforeMarkdown: string; afterMarkdown: string }) => void;
  /**
   * WebView 내부의 "아래로 스와이프하면 키보드를 닫는다" 휴리스틱을 끈다.
   * 메모 모드는 키보드가 열려 있는 동안 아래로 드래그하면 카드를 스크롤하는
   * 별도 제스처를 쓰므로, 이 WebView 내부 휴리스틱과 충돌해 카드를 끝까지
   * 스크롤한 뒤 계속 아래로 드래그하면 키보드가 의도치 않게 닫혀 버린다.
   * 메모 모드에서는 false 로 넘겨 키보드가 서식 툴바의 닫기 버튼으로만
   * 닫히도록 한다. 기본값 true(기록 탭 등 기존 동작 유지).
   */
  swipeDownToDismissKeyboard?: boolean;
}
