/**
 * 플랫폼 렌더러와 무관한 편지 페이지 기하 계산.
 * BodyLayout은 이 결과에 글꼴 메트릭과 화면별 예약을 더한다.
 */
export interface PageGeometry {
  pageWidth: number;
  pageHeight: number;
  paddingX: number;
  paddingY: number;
  textColumnWidth: number;
}

export function computePageGeometry(
  pageWidth: number,
  {
    aspectRatio,
    paddingXCqi,
    paddingYCqi,
  }: {
    aspectRatio: number;
    paddingXCqi: number;
    paddingYCqi: number;
  },
): PageGeometry {
  const paddingX = (paddingXCqi / 100) * pageWidth;
  const paddingY = (paddingYCqi / 100) * pageWidth;

  return {
    pageWidth,
    pageHeight: pageWidth / aspectRatio,
    paddingX,
    paddingY,
    textColumnWidth: Math.round(pageWidth - 2 * paddingX),
  };
}

/**
 * 페이지 프레임 안에서 텍스트가 사용할 수 있는 세로 길이.
 * `bottomReservation`은 물리 inset·리더 제목 바처럼 화면 고유의 하단
 * 예약만 받으며, 논리 페이지 C를 계산하는 식에는 섞지 않는다.
 */
export function getPageTextContentHeight(
  geometry: Pick<PageGeometry, "pageHeight" | "paddingY">,
  bottomReservation = 0,
): number {
  return Math.max(0, geometry.pageHeight - 2 * geometry.paddingY - bottomReservation);
}

/** 화면 비율에 맞춘 논리 페이지 폭 C. */
export function resolvePageWidth(
  screenWidth: number,
  screenHeight: number,
  aspectRatio: number,
): number {
  return Math.min(screenWidth, screenHeight * aspectRatio);
}