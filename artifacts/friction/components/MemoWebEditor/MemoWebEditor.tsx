import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import Animated, { useAnimatedStyle, SharedValue } from "react-native-reanimated";
import WebViewMarkdownEditor from "@/components/WebViewMarkdownEditor/WebViewMarkdownEditorCompat";
import type {
  WebViewMarkdownEditorRef,
  OnExportMarkdownPayload,
  OnSelectionUpdatePayload,
} from "@/components/WebViewMarkdownEditor/types";
import { Colors } from "@/constants/tokens";

export type FormatType = "bold" | "italic" | "underline" | "quote";
export type InlineMark = "bold" | "italic" | "underline";

export interface MemoWebEditorRef {
  setMarkdown: (markdown: string) => void;
  requestExport: (requestId: string) => void;
  toggleMark: (mark: InlineMark) => void;
  setBlockType: (blockType: string) => void;
  blur: () => void;
}

interface MemoWebEditorProps {
  /** 마운트 시 표시할 페이지의 markdown. 이후 페이지 전환은 ref.setMarkdown 사용. */
  initialContent: string;
  pageIndex: number;
  totalPages: number;
  containerWidth: number;
  containerHeight: number;
  paddingX: number;
  paddingY: number;
  bodyFontSize: number;
  bottomInset?: number;
  keyboardVisible?: boolean;
  editable?: boolean;
  flipAngle?: SharedValue<number>;
  /** onChange 디바운스 후 export 로 전달되는 저장용 markdown. */
  onExportMarkdown?: (markdown: string, requestId: string) => void;
  onActiveFormatsChange?: (formats: Set<FormatType>) => void;
  onReady?: () => void;
  onKeyboardVisibilityChange?: (visible: boolean) => void;
}

const MEMO_BG = "#FFFAEB";
const AUTOSAVE_DEBOUNCE_MS = 700;

const MemoWebEditor = forwardRef<MemoWebEditorRef, MemoWebEditorProps>(
  function MemoWebEditor(
    {
      initialContent,
      pageIndex,
      totalPages,
      containerWidth,
      containerHeight,
      paddingX,
      paddingY,
      bodyFontSize,
      bottomInset = 0,
      keyboardVisible,
      editable = true,
      flipAngle,
      onExportMarkdown,
      onActiveFormatsChange,
      onReady,
      onKeyboardVisibilityChange,
    },
    ref,
  ) {
    const editorRef = useRef<WebViewMarkdownEditorRef>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoReqRef = useRef(0);

    useImperativeHandle(
      ref,
      () => ({
        setMarkdown: (markdown: string) => editorRef.current?.setMarkdown(markdown),
        requestExport: (requestId: string) =>
          editorRef.current?.requestExportMarkdown(requestId),
        toggleMark: (mark: InlineMark) => editorRef.current?.toggleMark(mark),
        setBlockType: (blockType: string) => editorRef.current?.setBlockType(blockType),
        blur: () => editorRef.current?.blur(),
      }),
      [],
    );

    const handleChange = useCallback(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        autoReqRef.current += 1;
        editorRef.current?.requestExportMarkdown(`auto:${autoReqRef.current}`);
      }, AUTOSAVE_DEBOUNCE_MS);
    }, []);

    const handleExport = useCallback(
      (payload: OnExportMarkdownPayload) => {
        onExportMarkdown?.(payload.markdown, payload.requestId);
      },
      [onExportMarkdown],
    );

    const handleSelection = useCallback(
      (payload: OnSelectionUpdatePayload) => {
        const formats = new Set<FormatType>();
        if (payload.isBold) formats.add("bold");
        if (payload.isItalic) formats.add("italic");
        if (payload.isUnderline) formats.add("underline");
        if (payload.activeBlock === "blockquote") formats.add("quote");
        onActiveFormatsChange?.(formats);
      },
      [onActiveFormatsChange],
    );

    const animStyle = useAnimatedStyle(() => {
      const angle = flipAngle ? flipAngle.value : 0;
      if (angle === 0) return {};
      const H = containerHeight;
      return {
        transform: [
          { perspective: 1000 },
          { translateY: -H / 2 },
          { rotateX: `${angle}deg` },
          { translateY: H / 2 },
        ],
      };
    });

    const hintRowH = bodyFontSize * 0.78 + paddingY * 0.6;

    return (
      <Animated.View
        style={[
          styles.card,
          { width: containerWidth, height: containerHeight, backgroundColor: MEMO_BG },
          animStyle,
        ]}
      >
        {/* Page hint */}
        <View
          style={[
            styles.hintRow,
            {
              paddingHorizontal: paddingX,
              paddingTop: paddingY * 0.6,
              height: hintRowH,
            },
          ]}
        >
          <Text style={[styles.hintText, { fontSize: bodyFontSize * 0.78 }]}>
            {pageIndex + 1} / {totalPages}
          </Text>
          {!keyboardVisible && (
            <Text style={[styles.turnHint, { fontSize: bodyFontSize * 0.72 }]}>
              버튼으로 페이지 이동
            </Text>
          )}
        </View>

        {/* Web(TipTap) 에디터 — 기록 탭과 동일 엔진. body 가 투명이라 카드(크림) 배경이 비친다. */}
        <View
          style={[
            styles.editorWrap,
            { paddingHorizontal: paddingX, paddingBottom: bottomInset },
          ]}
        >
          <WebViewMarkdownEditor
            ref={editorRef}
            initialMarkdown={initialContent}
            placeholder="이 페이지에 메모를 적어보세요..."
            editable={editable}
            hideTitle
            bodyFontSize={bodyFontSize}
            bodyLetterSpacing={0.3}
            onReady={onReady}
            onChange={handleChange}
            onExportMarkdown={handleExport}
            onSelectionUpdate={handleSelection}
            onKeyboardVisibilityChange={onKeyboardVisibilityChange}
          />
        </View>
      </Animated.View>
    );
  },
);

export default MemoWebEditor;

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: 2,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hintText: {
    color: Colors.zinc400,
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard",
    }),
  },
  turnHint: {
    color: Colors.zinc300,
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard",
    }),
  },
  editorWrap: {
    flex: 1,
  },
});
