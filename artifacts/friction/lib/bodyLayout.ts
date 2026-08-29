import {
  ReaderTokens,
  readerFontSize,
  readerLetterSpacing,
} from "@/constants/tokens";
import {
  computePageGeometry,
  getPageTextContentHeight,
  resolvePageWidth as resolvePurePageWidth,
} from "./pageGeometry";

/**
 * 작성(on-01a) · 분할(on-01b) · 마감(on-01c) · 읽기(read) 4개 화면이 동일한 논리 페이지
 * 폭에서 동일한 텍스트 컬럼/패딩/폰트 메트릭을 사용하도록 통합한 계산기.
 *
 * 모든 호출처가 같은 함수를 거치도록 함으로써 다음을 보장한다:
 * - 페이지 프레임 / paddingX / textColumnWidth가 한 곳에서 결정된다
 * - textColumnWidth는 항상 정수 픽셀(Math.round)로 외부에 노출되어
 *   Yoga 픽셀 스냅이 부모 위치에 따라 ±1px 흔들리는 일을 차단한다
 * - bodyFontSize/lineHeight/letterSpacing은 부동소수 그대로 WebView CSS에 주입한다
 */
export interface BodyLayout {
  /** 논리 페이지 폭 C. 화면의 카드 그림자 여백은 포함하지 않는다. */
  pageWidth: number;
  /** 논리 페이지 높이. 종이 비율(5:8)에서 계산한다. */
  pageHeight: number;
  paddingX: number;
  paddingY: number;
  /**
   * 본문 텍스트 컬럼의 실제 픽셀 폭.
   * `Math.round(pageWidth − 2×paddingX)` 결과를 그대로 노출한다.
   * 4개 화면이 이 값을 자식 View의 `width`로 직접 사용하면 Yoga가 부모 위치별로
   * 다르게 스냅하는 부동소수 폭 차이가 사라진다.
   */
  textColumnWidth: number;
  bodyFontSize: number;
  bodyLineHeight: number;
  /** 일반 본문 문단의 아래 여백(px). */
  bodyParagraphGap: number;
  bodyLetterSpacing: number;
  titleFontSize: number;
  /** 카드 하단 제목 바의 높이. 화면별 하단 예약으로만 사용한다. */
  titleBarHeight: number;
}

/** Exact DOM typography contract shared by every letter body renderer. */
export interface BodyTypographyMetrics {
  textColumnWidth: number;
  fontSizePx: number;
  lineHeightPx: number;
  paragraphGapPx: number;
  letterSpacingPx: number;
  titleFontSizePx: number;
  textScalePercent: 100;
}

export function bodyTypographyMetrics(layout: BodyLayout): BodyTypographyMetrics {
  return {
    textColumnWidth: layout.textColumnWidth,
    fontSizePx: layout.bodyFontSize,
    lineHeightPx: layout.bodyLineHeight,
    paragraphGapPx: layout.bodyParagraphGap,
    letterSpacingPx: layout.bodyLetterSpacing,
    titleFontSizePx: layout.titleFontSize,
    textScalePercent: 100,
  };
}

export function computeBodyLayout(pageWidth: number): BodyLayout {
  const geometry = computePageGeometry(pageWidth, {
    aspectRatio: ReaderTokens.aspectRatio,
    paddingXCqi: ReaderTokens.padding.xCqi,
    paddingYCqi: ReaderTokens.padding.yCqi,
  });
  const bodyFontSize = readerFontSize(ReaderTokens.typeScale.bodyCqi, pageWidth);
  const bodyLineHeight = bodyFontSize * ReaderTokens.lineHeight.relaxed;
  const bodyParagraphGap = bodyFontSize * ReaderTokens.paragraphSpacing.bodyEm;
  const bodyLetterSpacing = readerLetterSpacing(
    ReaderTokens.letterSpacing.relaxedEm,
    bodyFontSize,
  );
  const titleFontSize = readerFontSize(ReaderTokens.typeScale.titleCqi, pageWidth);
  const captionFontSize = readerFontSize(ReaderTokens.typeScale.captionCqi, pageWidth);
  const titleBarHeight = Math.round(20 + captionFontSize * 1.3);
  return {
    ...geometry,
    bodyFontSize,
    bodyLineHeight,
    bodyParagraphGap,
    bodyLetterSpacing,
    titleFontSize,
    titleBarHeight,
  };
}

/**
 * 페이지 프레임 안에서 텍스트가 사용할 수 있는 세로 길이.
 * `bottomReservation`은 물리 inset·리더 제목 바처럼 화면 고유의 하단
 * 예약만 받으며, 논리 페이지 C를 계산하는 식에는 섞지 않는다.
 */
export function getBodyContentHeight(
  layout: BodyLayout,
  bottomReservation = 0,
): number {
  return getPageTextContentHeight(layout, bottomReservation);
}

/**
 * 화면 비율(`aspectRatio`)에 맞춘 논리 페이지 폭 C를 결정한다.
 * 세로 화면에서는 대부분 `screenHeight × 5/8`, 가로가 좁은 경우 `screenWidth`로 캡된다.
 */
export function resolvePageWidth(
  screenWidth: number,
  screenHeight: number,
): number {
  return resolvePurePageWidth(screenWidth, screenHeight, ReaderTokens.aspectRatio);
}
