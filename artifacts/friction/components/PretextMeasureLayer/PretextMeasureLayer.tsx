import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import MarkdownBlock from "../MarkdownBlock/MarkdownBlock";
import { parseMarkdownBlocks, type MarkdownBlockType } from "../../utils/markdownParser";

/**
 * Pretext 측정 프리미티브 — 화면측 한 곳의 단일 레이어로 텍스트 블록의
 * 실제 렌더 높이를 일괄 측정한다.
 *
 * 한 번의 mount로 여러 candidate를 동시에 마운트해 모든 onLayout이 끝나면
 * onMeasured(map)을 한 번 호출한다. BS 스텝마다 풀 리렌더가 필요하던
 * 기존 구조를 (request 1회 → 측정 N개) 형태로 바꿔 자동분할 체감 속도를
 * 개선한다.
 *
 * 주의: 화면 어디서나 같은 width / fontSize / lineHeight / letterSpacing 값을
 * 넘겨줘야 측정 결과가 페이지/엔진/경고 사이에서 정합한다.
 */
export type MeasureCandidate = {
  /** 측정 결과 맵의 키. 호출자가 의미를 부여한다. */
  key: string;
  /** 마크다운 블록으로 렌더되는 본문. (blocks가 비어 있을 때만 사용) */
  content?: string;
  /** 사전 파싱된 블록을 직접 측정. content보다 우선. */
  blocks?: MarkdownBlockType[];
};

export type MeasureRequest = {
  /** 같은 request 객체를 또 넘겨도 다시 측정하지 않는다 (참조 동등성으로 식별). */
  candidates: MeasureCandidate[];
  /** 측정 컨테이너의 가용 폭 (페이지 safe area 폭). paddingX와 함께 사용할 경우 실제 텍스트 폭은 width - 2*paddingX. */
  width: number;
  /** 좌우 padding (페이지 readerLayout.paddingX와 동일하게). textColumnWidth가 있으면 무시된다. */
  paddingX: number;
  /** 명시적 텍스트 컬럼 너비(정수 픽셀). 설정하면 width/paddingX 대신 이 값을 컨테이너 폭으로 직접 사용한다.
   *  read.tsx의 PageView와 동일한 값을 넘겨야 줄넘김이 일치한다. */
  textColumnWidth?: number;
  /** 옵션: 위쪽 padding (전체 페이지 높이 측정 시에만 사용). */
  paddingTop?: number;
  /** 옵션: 아래쪽 padding (insets.bottom + paddingY 등). */
  paddingBottom?: number;
  /** Markdown 블록 사이 vertical gap (lineHeight * 0.6). */
  blockGap?: number;
  /** 본문 폰트 크기. */
  fontSize: number;
  /** 본문 line-height. */
  lineHeight: number;
  /** 본문 letter-spacing. */
  letterSpacing: number;
  /** 제목/제목1 폰트 크기. 본문 측정과 동일한 WebView CSS를 유지한다. */
  titleFontSize?: number;
};

interface Props {
  request: MeasureRequest | null;
  onMeasured: (heights: Record<string, number>) => void;
}

export default function PretextMeasureLayer({ request, onMeasured }: Props) {
  const heightsRef = useRef<Record<string, number>>({});
  const remainingRef = useRef(0);
  const completedRef = useRef(false);
  const requestRef = useRef<MeasureRequest | null>(null);
  const onMeasuredRef = useRef(onMeasured);
  onMeasuredRef.current = onMeasured;

  // request가 바뀔 때마다 증가하는 렌더 키.
  // candidate View의 React key에 포함시켜 request 교체 시 모든 View를
  // 강제로 remount시킨다. 이렇게 하지 않으면 key가 같은 View는 React가
  // 재사용하고 onLayout을 재발생시키지 않아 측정이 누락된다.
  const renderKeyRef = useRef(0);

  // request 객체가 새로 들어오면 측정 상태를 렌더 중에 동기적으로 리셋한다.
  // useEffect 안에서 리셋하면 React Native가 onLayout 콜백을 먼저 실행한 뒤
  // useEffect가 실행되어, onLayout 내부의 `if (completedRef.current) return;`
  // 가드가 이전 측정의 true 값을 보고 측정을 건너뛰는 타이밍 버그가 발생한다.
  if (request !== requestRef.current) {
    requestRef.current = request;
    renderKeyRef.current += 1;
    heightsRef.current = {};
    completedRef.current = false;
    remainingRef.current = request?.candidates.length ?? 0;
  }

  // 빈 candidates 요청은 onLayout이 발생하지 않으므로 effect에서 즉시 완료 통보한다.
  useEffect(() => {
    if (request && request.candidates.length === 0 && !completedRef.current) {
      completedRef.current = true;
      onMeasuredRef.current({});
    }
  }, [request]);

  if (!request) return null;

  const renderKey = renderKeyRef.current;
  const blockGap = request.blockGap ?? request.lineHeight * 0.6;
  // textColumnWidth가 주어지면 해당 값을 컨테이너 폭으로 직접 사용 (paddingHorizontal 불필요).
  // 주어지지 않으면 기존 방식(width + paddingHorizontal)을 유지해 후방 호환성을 보장한다.
  const containerWidth = request.textColumnWidth ?? request.width;
  const containerPaddingX = request.textColumnWidth != null ? 0 : request.paddingX;

  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, opacity: 0 }}>
      {request.candidates.map((c) => {
        const blocks = c.blocks ?? parseMarkdownBlocks(c.content ?? "");
        return (
          <View
            key={`${renderKey}-${c.key}`}
            style={{
              position: "absolute",
              width: containerWidth,
              paddingHorizontal: containerPaddingX,
              paddingTop: request.paddingTop,
              paddingBottom: request.paddingBottom,
            }}
            onLayout={(e) => {
              if (completedRef.current) return;
              if (heightsRef.current[c.key] !== undefined) return;
              heightsRef.current[c.key] = e.nativeEvent.layout.height;
              remainingRef.current -= 1;
              if (remainingRef.current <= 0) {
                completedRef.current = true;
                onMeasuredRef.current({ ...heightsRef.current });
              }
            }}
          >
            {blocks.map((block, bi) => (
              <View key={bi} style={{ marginBottom: blockGap }}>
                <MarkdownBlock
                  block={block}
                  onCollect={() => {}}
                  fontSize={request.fontSize}
                  lineHeight={request.lineHeight}
                  letterSpacing={request.letterSpacing}
                />
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
