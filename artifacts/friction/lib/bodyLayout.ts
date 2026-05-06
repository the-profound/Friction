import {
  ReaderTokens,
  cqiToPx,
  readerFontSize,
  readerLetterSpacing,
} from "@/constants/tokens";

/**
 * 작성(on-01a) · 분할(on-01b) · 마감(on-01c) · 읽기(read) 4개 화면이 동일한 컨테이너
 * 폭에서 동일한 텍스트 컬럼/패딩/폰트 메트릭을 사용하도록 통합한 계산기.
 *
 * 모든 호출처가 같은 함수를 거치도록 함으로써 다음을 보장한다:
 * - safeArea / paddingX / textColumnWidth가 한 곳에서 결정된다
 * - textColumnWidth는 항상 정수 픽셀(Math.round)로 외부에 노출되어
 *   Yoga 픽셀 스냅이 부모 위치에 따라 ±1px 흔들리는 일을 차단한다
 * - bodyFontSize/lineHeight/letterSpacing은 부동소수 그대로 WebView CSS에 주입한다
 */
export interface BodyLayout {
  containerWidth: number;
  safeAreaWidth: number;
  safeAreaHeight: number;
  paddingX: number;
  paddingY: number;
  /**
   * 본문 텍스트 컬럼의 실제 픽셀 폭.
   * `Math.round(safeAreaWidth − 2×paddingX)` 결과를 그대로 노출한다.
   * 4개 화면이 이 값을 자식 View의 `width`로 직접 사용하면 Yoga가 부모 위치별로
   * 다르게 스냅하는 부동소수 폭 차이가 사라진다.
   */
  textColumnWidth: number;
  bodyFontSize: number;
  bodyLineHeight: number;
  bodyLetterSpacing: number;
  titleFontSize: number;
}

export function computeBodyLayout(containerWidth: number): BodyLayout {
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
}

/**
 * 화면 비율(`aspectRatio`)에 맞춘 가상 컨테이너 폭을 결정한다.
 * 세로 화면에서는 대부분 `screenHeight × 5/8`, 가로가 좁은 경우 `screenWidth`로 캡된다.
 */
export function resolveContainerWidth(
  screenWidth: number,
  screenHeight: number,
): number {
  const widthFromHeight = screenHeight * ReaderTokens.aspectRatio;
  return widthFromHeight <= screenWidth ? widthFromHeight : screenWidth;
}
