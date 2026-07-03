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
import { Colors, ReaderTokens } from "@/constants/tokens";
import MarkdownBlock from "@/components/MarkdownBlock/MarkdownBlock";
import type { MarkdownBlockType } from "@/utils/markdownParser";

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
  /**
   * 플립 중 카드 뒤에 정적으로 깔아 둘 다음/이전 페이지의 마크다운 블록.
   * null/undefined면 미리보기 레이어를 렌더링하지 않는다. 카드(WebView)가
   * 회전으로 얇아지는 순간부터 자연스럽게 드러나며, 애니메이션 도중 실제
   * 콘텐츠가 교체돼도 이미 같은 내용이 뒤에 있으므로 이질감이 없다.
   */
  previewBlocks?: MarkdownBlockType[] | null;
  /**
   * 현재(회전 중인) 페이지의 마크다운 블록. 실제 편집용 WebView는 각도가 0일
   * 때(정지 상태)만 보이고, 플립/드래그 중에는 이 정적 블록이 대신 표시된다.
   * WebView는 3D 회전(rotateX) 중 흰 화면으로 깜빡이거나 콘텐츠 갱신이
   * 지연되는 문제가 있어, 애니메이션 구간에는 항상 즉시 렌더되는 플레인
   * 뷰를 사용해 앞/뒤 페이지가 끊김 없이 계속 보이도록 한다.
   */
  frontBlocks?: MarkdownBlockType[] | null;
  /** true면 플립/드래그 애니메이션 진행 중 — 실제 WebView를 숨기고 frontBlocks 정적 렌더를 보여준다. */
  isFlipping?: boolean;
  /** onChange 디바운스 후 export 로 전달되는 저장용 markdown. */
  onExportMarkdown?: (markdown: string, requestId: string) => void;
  onActiveFormatsChange?: (formats: Set<FormatType>) => void;
  onReady?: () => void;
  onKeyboardVisibilityChange?: (visible: boolean) => void;
  /** 텍스트 선택 핸들 드래그 중 true — 스와이프 플립 제스처를 일시 비활성화하는 데 사용. */
  onTextSelectionActiveChange?: (active: boolean) => void;
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
      previewBlocks,
      frontBlocks,
      isFlipping = false,
      onExportMarkdown,
      onActiveFormatsChange,
      onReady,
      onKeyboardVisibilityChange,
      onTextSelectionActiveChange,
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
    const previewFontSize = bodyFontSize;
    const previewLineHeight = bodyFontSize * ReaderTokens.lineHeight.relaxed;
    const previewLetterSpacing = bodyFontSize * ReaderTokens.letterSpacing.relaxedEm;
    const noop = useCallback(() => {}, []);

    return (
      <View style={{ width: containerWidth, height: containerHeight }}>
        {/* 정적 드롭섀도우 — 편지 페이지 pager(read.tsx의 shadowLayer)와 동일한
            메커니즘: 그림자 전용 불투명 박스를 카드 뒤(형제, 렌더 순서상 가장
            아래)에 깔아 두고, 카드 자신은 overflow:hidden 이라 내부는 가려지고
            테두리 밖으로 번지는 그림자만 보이게 한다. 편지의 `next` 슬롯처럼
            이 카드는 항상 "떠 있는" 단일 정지 카드이므로 opacity 애니메이션
            없이 항상 1로 고정한다(편지 슬라이드 중에도 카드 자체는 안 움직이고
            바깥 래퍼가 함께 이동할 뿐이라 그림자도 늘 카드에 붙어 있으면 된다). */}
        <View
          pointerEvents="none"
          style={[
            styles.shadowLayer,
            { width: containerWidth, height: containerHeight },
          ]}
        />
        {/* 정적 미리보기 레이어 — 회전하지 않고 항상 같은 위치에 놓여, 플립 중인
            카드가 원근 축소로 얇아지는 순간부터 그 뒤에서 드러난다. 다음/이전
            페이지가 실제로 넘어가기 전부터 이미 "거기 있는" 것처럼 보이게 한다. */}
        {previewBlocks && (
          <View
            pointerEvents="none"
            style={[
              styles.card,
              StyleSheet.absoluteFillObject,
              { width: containerWidth, height: containerHeight, backgroundColor: MEMO_BG },
            ]}
          >
            <View
              style={[
                styles.hintRow,
                {
                  paddingHorizontal: paddingX,
                  paddingTop: paddingY * 0.6,
                  height: hintRowH,
                },
              ]}
            />
            <View
              style={[
                styles.editorWrap,
                { paddingHorizontal: paddingX + 24, paddingTop: 16, paddingBottom: bottomInset },
              ]}
            >
              {previewBlocks.map((block, i) => (
                <MarkdownBlock
                  key={i}
                  block={block}
                  onCollect={noop}
                  fontSize={previewFontSize}
                  lineHeight={previewLineHeight}
                  letterSpacing={previewLetterSpacing}
                />
              ))}
            </View>
          </View>
        )}

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
                스와이프 또는 버튼으로 이동
              </Text>
            )}
          </View>

          {/* 회전 중(front) 정적 미리보기 — 현재 페이지 내용을 즉시(지연 없이)
              렌더해, 아래 실제 WebView가 숨겨진 애니메이션 구간 동안에도
              콘텐츠가 끊김 없이 계속 보이게 한다. */}
          {frontBlocks && (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFillObject,
                styles.editorWrap,
                { paddingHorizontal: paddingX + 24, paddingTop: 16, paddingBottom: bottomInset },
              ]}
            >
              {frontBlocks.map((block, i) => (
                <MarkdownBlock
                  key={i}
                  block={block}
                  onCollect={noop}
                  fontSize={previewFontSize}
                  lineHeight={previewLineHeight}
                  letterSpacing={previewLetterSpacing}
                />
              ))}
            </View>
          )}
        </Animated.View>

        {/* Web(TipTap) 에디터 — 기록 탭과 동일 엔진. 회전(rotateX)하는 카드의
            자식으로 두면 transform이 걸리는 동안 포커스된 WebView가 OS에 의해
            블러 처리되어 키보드가 닫혀버린다. 그래서 실제 편집용 WebView는
            카드 밖에 고정된(회전하지 않는) 레이어로 분리해 두고, 플립 중에는
            opacity만 낮춰 숨긴다(위 frontBlocks/previewBlocks 정적 레이어가
            대신 보인다) — 포커스와 키보드는 그대로 유지된다. */}
        <View
          pointerEvents={isFlipping ? "none" : "auto"}
          style={[
            styles.editorWrap,
            styles.editorOverlay,
            {
              top: hintRowH,
              paddingHorizontal: paddingX,
              paddingBottom: bottomInset,
              opacity: isFlipping ? 0 : 1,
            },
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
            onTextSelectionActiveChange={onTextSelectionActiveChange}
          />
        </View>
      </View>
    );
  },
);

export default MemoWebEditor;

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: 2,
  },
  // 편지 페이지 pager(read.tsx)의 shadowLayer와 동일한 boxShadow 값을 그대로
  // 재사용해 편지/메모 두 "종이"가 같은 광원·같은 두께로 떠 있는 것처럼
  // 보이게 한다. borderRadius도 styles.card와 맞춰 그림자 윤곽이 카드 모서리와
  // 일치하도록 한다.
  shadowLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: MEMO_BG,
    borderRadius: 2,
    boxShadow: "0px 2px 10px rgba(0,0,0,0.13), 0px 8px 24px rgba(0,0,0,0.09)",
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
  editorOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
});
