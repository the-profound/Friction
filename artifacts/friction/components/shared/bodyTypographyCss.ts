import {
  BODY_REGULAR_FONT_FAMILY,
  BODY_SEMIBOLD_FONT_FAMILY,
} from "./bodyTypographyFonts";

/**
 * 작성(on-01a) · 분할(on-01b) · 마감(on-01c) · 읽기(read) 4개 화면이 모두
 * 동일한 본문 타이포그래피로 줄넘김을 결정해야 한다.
 *
 * 본 모듈은 4개 WebView(편집기 / 측정 레이어 / 리더)에서 사용하는
 * 본문(body) + 블록(p, h1~h3, ul, ol, li, blockquote, hr, u, strong, em) CSS를
 * 한 곳에서 생성한다. 폰트, 사이즈, 줄간격, 자간, 정렬, word-wrap이 픽셀 단위로 동일하다.
 *
 * 호출처별 차이는 옵션으로만 표현한다:
 * - blockMargins: "spaced" (편집기 / 리더) | "zero" (측정 레이어 — blockGap을 외부에서 더함)
 * - hrStyle: "spaced" (리더 1em 0) | "flush" (편집기 .hr-wrapper 사용) | "measure" (측정 1px 높이)
 * - readerUnderline: 리더 페이지에서 `<u>` 밑줄을 0.2em 띄움
 *
 * 컨테이너의 width/min-height/padding/position 등 *구조적* 스타일은 호출처가
 * 직접 추가한다 (이 함수는 *타이포그래피*만 책임진다).
 */

export interface BodyTypographyCssOptions {
  /** 본문 폰트/색상이 적용되는 루트 셀렉터.  편집기: "#editor-content", 리더: "#reader-content", 측정: ".mb". */
  rootSelector: string;
  /** 블록 요소(p, h1~h3, ul, ol, li, blockquote, hr, u, strong, em)가 위치하는 부모 셀렉터.
   *  편집기: ".ProseMirror" (TipTap이 .ProseMirror 안에 블록을 그린다)
   *  리더 / 측정: 루트 셀렉터와 동일. */
  blockSelector: string;
  /** "spaced": 일반 읽기용 마진(p:공통 본문 문단 간격, h1:1em 0 0.4em, …).
   *  "zero": 모든 블록 마진을 0으로 초기화 (측정 레이어가 blockGap을 외부에서 더할 때 사용). */
  blockMargins: "spaced" | "zero";
  /** "spaced": border-top + 1em 위아래 여백 (리더 페이지).
   *  "flush": border-top + 마진 0 (편집기는 .hr-wrapper가 여백을 줌).
   *  "measure": border-top + height:1px + 마진 0 (측정 레이어). */
  hrStyle: "spaced" | "flush" | "measure";
  /** 리더에서만 `<u>` 밑줄을 0.2em 떨어뜨려 가독성을 높인다. */
  readerUnderline?: boolean;
}

export function buildBodyTypographyCss(opts: BodyTypographyCssOptions): string {
  const { rootSelector: r, blockSelector: b, blockMargins, hrStyle, readerUnderline } = opts;
  const spaced = blockMargins === "spaced";
  const pMargin = spaced ? "margin-bottom:var(--body-paragraph-gap)" : "margin:0";
  const h1Margin = spaced ? "margin:1em 0 0.4em" : "margin:0";
  const h2Margin = spaced ? "margin:0.8em 0 0.3em" : "margin:0";
  const h3Margin = spaced ? "margin:0.6em 0 0.3em" : "margin:0";
  const listMargin = spaced ? "margin-bottom:1em" : "margin:0";
  const liMargin = spaced ? "margin-bottom:0.2em" : "margin:0";
  const blockquoteMargin = spaced ? "margin:0.5em 0" : "margin:0";
  const hrCss =
    hrStyle === "spaced"
      ? "margin:1em 0"
      : hrStyle === "measure"
        ? "height:1px;margin:0"
        : "margin:0";
  const uExtras = readerUnderline ? ";text-underline-offset:0.2em" : "";

  return [
    `${r}{font-family:var(--body-regular-font-family,${BODY_REGULAR_FONT_FAMILY});font-size:var(--body-font-size);line-height:var(--body-line-height);letter-spacing:var(--body-letter-spacing);color:#1A1A1A;background:transparent;text-size-adjust:100%;-webkit-text-size-adjust:100%;text-align:justify;overflow-wrap:anywhere;word-wrap:break-word;word-break:normal;-webkit-hyphens:auto;hyphens:auto;text-justify:inter-ideograph}`,
    `${b} p{${pMargin};text-align:justify;overflow-wrap:anywhere;word-wrap:break-word;word-break:normal;-webkit-hyphens:auto;hyphens:auto;text-justify:inter-ideograph}`,
    `${b} h1{font-family:var(--body-semibold-font-family,${BODY_SEMIBOLD_FONT_FAMILY});font-size:var(--title-font-size);font-weight:600;letter-spacing:0.025em;${h1Margin};line-height:1.25;text-align:left}`,
    `${b} h2{font-family:var(--body-semibold-font-family,${BODY_SEMIBOLD_FONT_FAMILY});font-size:1.3em;font-weight:600;letter-spacing:0.025em;${h2Margin};line-height:1.3;text-align:left}`,
    `${b} h3{font-family:var(--body-semibold-font-family,${BODY_SEMIBOLD_FONT_FAMILY});font-size:1.1em;font-weight:600;letter-spacing:0.025em;${h3Margin};line-height:1.35;text-align:left}`,
    `${b} ul,${b} ol{padding-left:1.5em;${listMargin};text-align:left}`,
    `${b} li{${liMargin};text-align:left}`,
    `${b} li p{margin-bottom:0}`,
    `${b} blockquote{font-family:var(--body-regular-font-family,${BODY_REGULAR_FONT_FAMILY});font-style:italic;border-left:3px solid #d4d4d8;padding-left:1em;${blockquoteMargin};color:#52525b;text-align:justify;overflow-wrap:anywhere;word-wrap:break-word;word-break:normal;-webkit-hyphens:auto;hyphens:auto;text-justify:inter-ideograph}`,
    `${b} hr{border:none;border-top:1px solid #e4e4e7;${hrCss}}`,
    `${b} u{text-decoration:underline${uExtras}}`,
    `${b} strong{font-family:var(--body-semibold-font-family,${BODY_SEMIBOLD_FONT_FAMILY});font-weight:600}`,
    `${b} em{font-style:italic}`,
    `${b} img[data-inline="true"],.tiptap-inline-image{display:block;max-width:240px;width:auto;height:auto;border-radius:8px;margin:0.5em 0}`,
  ].join("\n");
}
