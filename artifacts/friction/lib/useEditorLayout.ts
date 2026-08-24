import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { computeBodyLayout, resolvePageWidth, type BodyLayout } from "./bodyLayout";

/**
 * 작성(on-01a) · 분할(on-01b) 화면이 공유하는 에디터 레이아웃 계산.
 *
 * 두 화면은 같은 공식으로 논리 페이지 폭/패딩/본문 폰트를 계산해야
 * WebView 편집창이 보여주는 줄넘김과 PretextMeasureLayer 측정 결과,
 * 그리고 read.tsx의 렌더링 결과가 동일한 기준 위에서 일치한다.
 *
 * 실제 계산은 `lib/bodyLayout.ts`의 `computeBodyLayout`이 담당한다 — 마감(on-01c)
 * 미리보기와 읽기(read.tsx)도 동일한 함수를 호출하므로 4개 화면의 컨테이너 폭과
 * 텍스트 컬럼이 픽셀 단위로 일치한다.
 */
export function useEditorLayout(): BodyLayout {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  return useMemo(() => {
    const pageWidth = resolvePageWidth(screenWidth, screenHeight);
    return computeBodyLayout(pageWidth);
  }, [screenWidth, screenHeight]);
}

export type EditorLayout = BodyLayout;
