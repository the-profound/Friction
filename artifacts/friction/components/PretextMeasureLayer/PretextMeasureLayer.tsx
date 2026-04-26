import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import MarkdownBlock from "../MarkdownBlock/MarkdownBlock";
import { parseMarkdownBlocks } from "../../utils/markdownParser";

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
  /** 마크다운 블록으로 렌더되는 본문. */
  content: string;
};

export type MeasureRequest = {
  /** 같은 request 객체를 또 넘겨도 다시 측정하지 않는다 (참조 동등성으로 식별). */
  candidates: MeasureCandidate[];
  /** 측정 컨테이너의 가용 폭 (페이지 safe area 폭). */
  width: number;
  /** 좌우 padding (페이지 readerLayout.paddingX와 동일하게). */
  paddingX: number;
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

  // request 객체가 새로 들어오면 측정 상태를 리셋한다.
  useEffect(() => {
    if (request === requestRef.current) return;
    requestRef.current = request;
    heightsRef.current = {};
    completedRef.current = false;
    if (!request || request.candidates.length === 0) {
      remainingRef.current = 0;
      if (request && request.candidates.length === 0) {
        // 빈 요청은 즉시 완료 통보
        completedRef.current = true;
        onMeasured({});
      }
      return;
    }
    remainingRef.current = request.candidates.length;
  }, [request, onMeasured]);

  if (!request) return null;

  const blockGap = request.blockGap ?? request.lineHeight * 0.6;

  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, opacity: 0 }}>
      {request.candidates.map((c) => {
        const blocks = parseMarkdownBlocks(c.content);
        return (
          <View
            key={c.key}
            style={{
              position: "absolute",
              width: request.width,
              paddingHorizontal: request.paddingX,
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
                onMeasured({ ...heightsRef.current });
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
