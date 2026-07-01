import React, { useRef, useImperativeHandle, forwardRef, useState, useCallback } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Text,
  Platform,
} from "react-native";
import Animated, { useAnimatedStyle, SharedValue } from "react-native-reanimated";
import { Colors } from "@/constants/tokens";

export type FormatType = "bold" | "italic" | "underline" | "quote";

export interface MemoPageViewRef {
  focus: () => void;
  blur: () => void;
  applyFormat: (type: FormatType) => void;
}

interface MemoPageViewProps {
  content: string;
  pageIndex: number;
  totalPages: number;
  onChange: (text: string) => void;
  onOverflow?: () => void;
  containerWidth: number;
  containerHeight: number;
  paddingX: number;
  paddingY: number;
  bodyFontSize: number;
  bodyLineHeight: number;
  onFocus?: () => void;
  onBlur?: () => void;
  keyboardVisible?: boolean;
  bottomInset?: number;
  flipAngle?: SharedValue<number>;
  onActiveFormatsChange?: (formats: Set<FormatType>) => void;
}

const MEMO_BG = "#FFFAEB";
const MEMO_FONT_FAMILY = Platform.select({
  ios: "Eulyoo1945-Regular",
  default: "Eulyoo1945-Regular",
});

type InlineFormatType = Exclude<FormatType, "quote">;

function applyMarkdownFormat(text: string, sel: { start: number; end: number }, type: InlineFormatType): {
  newText: string;
  newSelection: { start: number; end: number };
} {
  const { start, end } = sel;
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  const hasSelection = start !== end;

  const markers: Record<InlineFormatType, string> = {
    bold: "**",
    italic: "*",
    underline: "__",
  };
  const marker = markers[type];

  if (hasSelection) {
    const wrapped = `${marker}${selected}${marker}`;
    const newText = before + wrapped + after;
    // 마커(**, __, *)는 선택 영역에서 제외하고, 서식이 적용된 실제 내용만
    // 다시 선택 상태로 유지한다. 이렇게 해야 적용 직후 커서/선택 범위가
    // getActiveFormats의 "내용 구간 안" 판정과 일치해 툴바 버튼이 즉시
    // 눌린 상태로 표시된다.
    const newStart = start + marker.length;
    const newEnd = newStart + selected.length;
    return { newText, newSelection: { start: newStart, end: newEnd } };
  } else {
    const inserted = `${marker}${marker}`;
    const newText = before + inserted + after;
    const cursor = start + marker.length;
    return { newText, newSelection: { start: cursor, end: cursor } };
  }
}

/* ─── 이미 서식이 적용된 구간을 찾아 마커만 제거(토글 OFF) ────────────────
 * 커서/선택이 이미 어떤 bold/italic/underline 구간 "안"에 있다면(즉
 * getActiveFormats가 active로 판정하는 것과 동일한 조건), 그 구간의
 * 여는/닫는 마커를 제거해 서식을 해제한다. 기록 탭 메모 작성 시 쓰는
 * 서식 툴바와 동일하게, 이미 켜진 서식 버튼을 다시 누르면 꺼지도록 한다.
 */
function findEnclosingSpan(
  text: string,
  start: number,
  end: number,
  type: InlineFormatType,
): { matchStart: number; matchEnd: number; inner: string } | null {
  const lines = text.split("\n");
  let lineStart = 0;
  for (const line of lines) {
    const re = new RegExp(INLINE_MARKDOWN_RE);
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const matchAbsStart = lineStart + m.index;
      let markerLen = 0;
      let matchedType: InlineFormatType | null = null;
      let inner = "";
      if (m[1] !== undefined) {
        markerLen = 2;
        matchedType = "bold";
        inner = m[2];
      } else if (m[3] !== undefined) {
        markerLen = 2;
        matchedType = "underline";
        inner = m[4];
      } else if (m[5] !== undefined) {
        markerLen = 1;
        matchedType = "italic";
        inner = m[6];
      }
      if (matchedType === type) {
        const innerStart = matchAbsStart + markerLen;
        const innerEnd = matchAbsStart + m[0].length - markerLen;
        if (start >= innerStart && end <= innerEnd) {
          return { matchStart: matchAbsStart, matchEnd: matchAbsStart + m[0].length, inner };
        }
      }
    }
    lineStart += line.length + 1;
  }
  return null;
}

function removeFormatSpan(
  text: string,
  span: { matchStart: number; matchEnd: number; inner: string },
): { newText: string; newSelection: { start: number; end: number } } {
  const newText = text.slice(0, span.matchStart) + span.inner + text.slice(span.matchEnd);
  const newStart = span.matchStart;
  const newEnd = span.matchStart + span.inner.length;
  return { newText, newSelection: { start: newStart, end: newEnd } };
}

/* ─── 인용(quote) 토글 ON/OFF ─────────────────────────────────────────────
 * 선택/커서가 걸쳐 있는 모든 줄이 이미 "> "로 시작하면 제거하고, 아니면
 * 추가한다. 여러 줄에 걸친 선택도 지원하기 위해 각 줄의 오프셋을 계산해
 * 선택 위치를 새 텍스트 기준으로 다시 매핑한다.
 */
function toggleQuote(
  text: string,
  sel: { start: number; end: number },
): { newText: string; newSelection: { start: number; end: number } } {
  const { start, end } = sel;
  const lines = text.split("\n");
  const bounds: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const line of lines) {
    bounds.push({ start: cursor, end: cursor + line.length });
    cursor += line.length + 1;
  }

  const touchedIdx: number[] = [];
  let allQuoted = true;
  bounds.forEach((b, idx) => {
    if (start <= b.end && end >= b.start) {
      touchedIdx.push(idx);
      if (!lines[idx].startsWith("> ")) allQuoted = false;
    }
  });
  if (touchedIdx.length === 0) {
    const idx = bounds.findIndex((b) => start >= b.start && start <= b.end);
    if (idx !== -1) touchedIdx.push(idx);
  }

  const removing = allQuoted;
  const newLines = lines.map((line, idx) => {
    if (!touchedIdx.includes(idx)) return line;
    if (removing) return line.startsWith("> ") ? line.slice(2) : line;
    return `> ${line}`;
  });
  const newText = newLines.join("\n");

  const mapPos = (pos: number): number => {
    let lineIdx = bounds.findIndex((b) => pos >= b.start && pos <= b.end);
    if (lineIdx === -1) lineIdx = bounds.length - 1;
    const within = pos - bounds[lineIdx].start;
    let delta = 0;
    for (let i = 0; i < lineIdx; i++) {
      if (touchedIdx.includes(i)) delta += removing ? -2 : 2;
    }
    let newWithin = within;
    if (touchedIdx.includes(lineIdx)) {
      newWithin = removing ? Math.max(0, within - 2) : within + 2;
    }
    return bounds[lineIdx].start + delta + newWithin;
  };

  return { newText, newSelection: { start: mapPos(start), end: mapPos(end) } };
}

/* ─── 인라인 마크다운(굵게/기울임/밑줄) 실시간 렌더링 ──────────────────────
 * 원본 문자열의 문자 수/개행을 그대로 유지한 채, 마커(**, *, __)는 옅게,
 * 마커 사이 내용은 실제 서식(굵게/기울임/밑줄)으로 렌더링한다.
 * 밑에 겹쳐진 투명 TextInput과 글자 폭이 어긋나지 않도록, 폭에 영향을
 * 주는 스타일(폰트 크기/자간 등)은 바꾸지 않고 굵기/기울임/밑줄만 적용한다.
 */
const INLINE_MARKDOWN_RE = /(\*\*(.+?)\*\*)|(__(.+?)__)|(\*(.+?)\*)/g;

function renderInlineMarkdown(line: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = new RegExp(INLINE_MARKDOWN_RE);
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = re.exec(line)) !== null) {
    if (m.index > lastIndex) {
      nodes.push(
        <Text key={`${keyBase}-plain-${i++}`}>{line.slice(lastIndex, m.index)}</Text>,
      );
    }
    if (m[1] !== undefined) {
      nodes.push(
        <Text key={`${keyBase}-b-${i++}`}>
          <Text style={mdStyles.marker}>**</Text>
          <Text style={mdStyles.bold}>{m[2]}</Text>
          <Text style={mdStyles.marker}>**</Text>
        </Text>,
      );
    } else if (m[3] !== undefined) {
      nodes.push(
        <Text key={`${keyBase}-u-${i++}`}>
          <Text style={mdStyles.marker}>__</Text>
          <Text style={mdStyles.underline}>{m[4]}</Text>
          <Text style={mdStyles.marker}>__</Text>
        </Text>,
      );
    } else if (m[5] !== undefined) {
      nodes.push(
        <Text key={`${keyBase}-i-${i++}`}>
          <Text style={mdStyles.marker}>*</Text>
          <Text style={mdStyles.italic}>{m[6]}</Text>
          <Text style={mdStyles.marker}>*</Text>
        </Text>,
      );
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < line.length) {
    nodes.push(<Text key={`${keyBase}-tail`}>{line.slice(lastIndex)}</Text>);
  }
  return nodes;
}

/* ─── 커서/선택 영역 기준 현재 적용된 서식 판별 ───────────────────────────
 * 툴바의 B/I/U/인용 버튼이 "눌린 상태"로 보이려면, 커서가 이미 서식이
 * 적용된 구간 안에 있는지(또는 선택 영역 전체가 그 구간 안에 완전히
 * 포함되는지) 알아야 한다. 렌더링에 쓰는 것과 동일한 정규식으로 각 줄을
 * 스캔하고, 줄 오프셋을 누적해 절대 인덱스로 환산해 비교한다.
 */
function getActiveFormats(text: string, start: number, end: number): Set<FormatType> {
  const active = new Set<FormatType>();
  const lines = text.split("\n");

  // 인용(quote): 선택 범위가 걸쳐 있는 모든 줄이 "> "로 시작해야 활성.
  let cursor = 0;
  let touchedAnyLine = false;
  let allQuoted = true;
  for (const line of lines) {
    const lineStart = cursor;
    const lineEnd = cursor + line.length;
    const touchesLine = start <= lineEnd && end >= lineStart;
    if (touchesLine) {
      touchedAnyLine = true;
      if (!line.startsWith("> ")) allQuoted = false;
    }
    cursor = lineEnd + 1;
  }
  if (touchedAnyLine && allQuoted) active.add("quote");

  // 굵게/기울임/밑줄: 각 줄에서 매칭을 찾아 절대 오프셋으로 변환 후,
  // 선택 영역이 마커를 제외한 "내용" 구간 안에 완전히 포함되는지 검사.
  let lineStart = 0;
  for (const line of lines) {
    const re = new RegExp(INLINE_MARKDOWN_RE);
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const matchAbsStart = lineStart + m.index;
      if (m[1] !== undefined) {
        const innerStart = matchAbsStart + 2;
        const innerEnd = matchAbsStart + m[0].length - 2;
        if (start >= innerStart && end <= innerEnd) active.add("bold");
      } else if (m[3] !== undefined) {
        const innerStart = matchAbsStart + 2;
        const innerEnd = matchAbsStart + m[0].length - 2;
        if (start >= innerStart && end <= innerEnd) active.add("underline");
      } else if (m[5] !== undefined) {
        const innerStart = matchAbsStart + 1;
        const innerEnd = matchAbsStart + m[0].length - 1;
        if (start >= innerStart && end <= innerEnd) active.add("italic");
      }
    }
    lineStart += line.length + 1;
  }

  return active;
}

function renderMemoMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  lines.forEach((line, idx) => {
    const isQuote = line.startsWith("> ");
    if (isQuote) {
      const rest = line.slice(2);
      out.push(
        <Text key={`line-${idx}`} style={mdStyles.quoteLine}>
          <Text style={mdStyles.marker}>{"> "}</Text>
          {renderInlineMarkdown(rest, `q${idx}`)}
        </Text>,
      );
    } else {
      out.push(<Text key={`line-${idx}`}>{renderInlineMarkdown(line, `l${idx}`)}</Text>);
    }
    if (idx < lines.length - 1) out.push("\n");
  });
  return out;
}

const MemoPageView = forwardRef<MemoPageViewRef, MemoPageViewProps>(
  function MemoPageView(
    {
      content,
      pageIndex,
      totalPages,
      onChange,
      onOverflow,
      containerWidth,
      containerHeight,
      paddingX,
      paddingY,
      bodyFontSize,
      bodyLineHeight,
      onFocus,
      onBlur,
      keyboardVisible,
      bottomInset = 0,
      flipAngle,
      onActiveFormatsChange,
    },
    ref,
  ) {
    const inputRef = useRef<TextInput>(null);
    const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
    const [controlledSelection, setControlledSelection] = useState<{ start: number; end: number } | undefined>(undefined);

    const emitActiveFormats = useCallback(
      (text: string, sel: { start: number; end: number }) => {
        onActiveFormatsChange?.(getActiveFormats(text, sel.start, sel.end));
      },
      [onActiveFormatsChange],
    );

    const handleSelectionChange = useCallback(
      (e: { nativeEvent: { selection: { start: number; end: number } } }) => {
        selectionRef.current = e.nativeEvent.selection;
        setControlledSelection(undefined);
        emitActiveFormats(content, e.nativeEvent.selection);
      },
      [content, emitActiveFormats],
    );

    const handleChangeText = useCallback(
      (text: string) => {
        onChange(text);
        emitActiveFormats(text, selectionRef.current);
      },
      [onChange, emitActiveFormats],
    );

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      applyFormat: (type: FormatType) => {
        const sel = selectionRef.current;
        let result: { newText: string; newSelection: { start: number; end: number } };
        if (type === "quote") {
          result = toggleQuote(content, sel);
        } else {
          const span = findEnclosingSpan(content, sel.start, sel.end, type);
          result = span
            ? removeFormatSpan(content, span)
            : applyMarkdownFormat(content, sel, type);
        }
        onChange(result.newText);
        setControlledSelection(result.newSelection);
        selectionRef.current = result.newSelection;
        emitActiveFormats(result.newText, result.newSelection);
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      },
    }));

    const hintRowH = bodyFontSize * 0.78 + paddingY * 0.6;
    const textAreaHeight =
      containerHeight - hintRowH - paddingY * 2 - bottomInset - 20;

    const handleContentSizeChange = (e: {
      nativeEvent: { contentSize: { height: number } };
    }) => {
      if (e.nativeEvent.contentSize.height > textAreaHeight && onOverflow) {
        onOverflow();
      }
    };

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

    const sharedTextStyle = {
      paddingHorizontal: paddingX,
      paddingTop: paddingY * 0.5,
      paddingBottom: paddingY,
      fontSize: bodyFontSize,
      lineHeight: bodyLineHeight,
      fontFamily: MEMO_FONT_FAMILY,
    };

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
            <Text style={[styles.swipeHint, { fontSize: bodyFontSize * 0.72 }]}>
              ↑↓ 스와이프로 이동
            </Text>
          )}
        </View>

        {/* Text area: 렌더링된 서식(아래) + 투명 입력창(위, 캐럿/선택/터치 담당) */}
        <View style={[styles.textAreaWrap, { height: textAreaHeight }]}>
          <Text
            pointerEvents="none"
            style={[styles.renderedText, sharedTextStyle]}
          >
            {content ? renderMemoMarkdown(content) : null}
          </Text>
          <TextInput
            ref={inputRef}
            style={[styles.input, sharedTextStyle]}
            value={content}
            onChangeText={handleChangeText}
            selection={controlledSelection}
            onSelectionChange={handleSelectionChange}
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
            placeholder="이 페이지에 메모를 적어보세요..."
            placeholderTextColor={Colors.zinc300}
            onContentSizeChange={handleContentSizeChange}
            onFocus={onFocus}
            onBlur={onBlur}
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            cursorColor={Colors.zinc800}
            // 선택 영역 하이라이트(배경색이 있는 박스)가 그려지면, 그 위에서는
            // "배경색과 같은 색"으로 숨긴 글자(마커 포함)가 더 이상 배경과
            // 섞이지 않아 다시 보이게 된다(선택 중 마커/원문이 겹쳐 보이는
            // 버그의 원인). 하이라이트 배경 자체를 투명하게 만들어, 선택
            // 중에도 숨긴 글자가 계속 카드 배경과 섞여 보이지 않게 한다.
            // (드래그 핸들 두 점은 별도 네이티브 UI라 계속 보인다.)
            selectionColor="transparent"
            keyboardType="default"
            returnKeyType="default"
          />
        </View>
      </Animated.View>
    );
  },
);

export default MemoPageView;

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
  swipeHint: {
    color: Colors.zinc300,
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard",
    }),
  },
  textAreaWrap: {
    position: "relative",
  },
  renderedText: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    color: Colors.zinc800,
    includeFontPadding: false,
  },
  input: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // 주의: color: "transparent" 는 일부 RN 빌드/폰트 조합에서 실제로는
    // 투명 처리가 안 되고 기본(검정) 색으로 그려지는 문제가 있었다(마커
    // 문자와 이탤릭 미적용 버그의 원인). 배경색과 완전히 동일한 불투명
    // 색으로 칠해 "섞여서 안 보이게" 만드는 방식이 훨씬 안정적이다.
    color: MEMO_BG,
    padding: 0,
    margin: 0,
    backgroundColor: "transparent",
    includeFontPadding: false,
  },
});

const mdStyles = StyleSheet.create({
  // 마커 문자(**, __, *, "> ")는 실제로 화면에 보이면 안 되지만, 아래
  // 겹쳐진 (배경색과 같은 색으로 칠해진) TextInput과 줄바꿈 위치가
  // 어긋나지 않도록 폭은 그대로 유지한 채 배경과 같은 색으로 칠한다.
  // ("transparent" 키워드는 일부 환경에서 신뢰할 수 없어 사용하지 않는다.)
  marker: {
    color: MEMO_BG,
  },
  bold: {
    fontWeight: "700",
    color: Colors.zinc800,
  },
  italic: {
    fontStyle: "italic",
    color: Colors.zinc800,
  },
  underline: {
    textDecorationLine: "underline",
    color: Colors.zinc800,
  },
  quoteLine: {
    color: Colors.zinc500,
    fontStyle: "italic",
  },
});
