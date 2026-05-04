import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import {
  ReaderTokens,
  cqiToPx,
  readerFontSize,
  readerLetterSpacing,
} from "@/constants/tokens";

/**
 * 작성(on-01a) · 분할(on-01b) 화면이 공유하는 에디터 레이아웃 계산.
 *
 * 두 화면은 같은 공식으로 컨테이너 폭/안전 영역/패딩/본문 폰트를 계산해야
 * WebView 편집창이 보여주는 줄넘김과 PretextMeasureLayer 측정 결과,
 * 그리고 read.tsx의 렌더링 결과가 동일한 기준 위에서 일치한다.
 *
 * - containerWidth: 화면 비율(`aspectRatio`)에 맞춘 가상 컨테이너 폭. 세로 화면에서는
 *   대부분 `screenHeight × 5/8`로 계산되며 가로가 좁은 경우 `screenWidth`로 캡된다.
 * - safeAreaWidth/Height: 컨테이너 안에서 본문 영역으로 쓰는 박스.
 * - paddingX/Y: safeArea 내부의 좌우/상하 패딩.
 * - textColumnWidth: `safeAreaWidth − 2×paddingX` 정수 픽셀. PretextMeasureLayer(네이티브)와
 *   read.tsx WebViewMarkdownReader 컨테이너가 동일한 정수 폭을 쓰도록 명시적으로 노출한다.
 *   소수점 폭이면 Yoga 픽셀 스냅으로 PretextMeasureLayer 측정 폭이 달라질 수 있으므로 반드시 정수로 유지한다.
 * - body 메트릭: WebView에 주입할 본문 폰트 크기·줄간격·자간.
 */
export function useEditorLayout() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  return useMemo(() => {
    const widthFromHeight = screenHeight * ReaderTokens.aspectRatio;
    const containerWidth = widthFromHeight <= screenWidth ? widthFromHeight : screenWidth;
    const safeAreaWidth = cqiToPx(ReaderTokens.safeArea.widthCqi, containerWidth);
    const safeAreaHeight = cqiToPx(ReaderTokens.safeArea.heightCqi, containerWidth);
    const paddingX = cqiToPx(ReaderTokens.padding.xCqi, containerWidth);
    const paddingY = cqiToPx(ReaderTokens.padding.yCqi, containerWidth);
    const textColumnWidth = Math.round(safeAreaWidth - 2 * paddingX);
    const bodyFontSize = readerFontSize(ReaderTokens.typeScale.bodyCqi, containerWidth);
    const bodyLineHeight = bodyFontSize * ReaderTokens.lineHeight.relaxed;
    const bodyLetterSpacing = readerLetterSpacing(
      ReaderTokens.letterSpacing.relaxedEm,
      bodyFontSize,
    );
    const titleFontSize = readerFontSize(ReaderTokens.typeScale.titleCqi, containerWidth);
    return {
      containerWidth,
      safeAreaWidth,
      safeAreaHeight,
      paddingX,
      paddingY,
      textColumnWidth,
      bodyFontSize,
      bodyLineHeight,
      bodyLetterSpacing,
      titleFontSize,
    };
  }, [screenWidth, screenHeight]);
}

export type EditorLayout = ReturnType<typeof useEditorLayout>;
