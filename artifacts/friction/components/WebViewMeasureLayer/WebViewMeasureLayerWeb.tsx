/**
 * WebViewMeasureLayer 웹 플랫폼 폴백.
 *
 * 네이티브 WebView를 사용할 수 없는 웹 환경에서 DOM 숨김 컨테이너로
 * 동일한 측정 계약을 구현한다. getBoundingClientRect().height + blockGap
 * 방식으로 네이티브 구현과 동일한 결과를 반환한다.
 */
import React, { useRef, useLayoutEffect, useCallback } from "react";
import { PixelRatio } from "react-native";
import { buildBodyTypographyCss } from "@/components/shared/bodyTypographyCss";
import { blockToHtml, markdownToHtml } from "@/lib/markdownRenderer";
import type { MeasureRequest } from "../PretextMeasureLayer/PretextMeasureLayer";

interface Props {
  request: MeasureRequest | null;
  onMeasured: (heights: Record<string, number>) => void;
}

const CONTAINER_STYLE: React.CSSProperties = {
  position: "fixed",
  left: -9999,
  top: 0,
  pointerEvents: "none",
  visibility: "hidden",
  zIndex: -1,
};

const measureTypographyCss = buildBodyTypographyCss({
  rootSelector: ".webview-measure-layer",
  blockSelector: ".webview-measure-layer",
  blockMargins: "zero",
  hrStyle: "measure",
});

export default function WebViewMeasureLayerWeb({ request, onMeasured }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onMeasuredRef = useRef(onMeasured);
  onMeasuredRef.current = onMeasured;
  const prevRequestRef = useRef<MeasureRequest | null>(null);

  const measureNow = useCallback(() => {
    if (!request || request === prevRequestRef.current) return;
    if (!containerRef.current) return;
    if (request.candidates.length === 0) {
      prevRequestRef.current = request;
      onMeasuredRef.current({});
      return;
    }

    prevRequestRef.current = request;
    const containerWidth = request.textColumnWidth ?? (request.width - 2 * request.paddingX);
    const blockGap = request.blockGap ?? request.lineHeight * 0.6;
    const wrapper = containerRef.current;

    wrapper.style.width = containerWidth + "px";
    wrapper.style.fontSize = request.fontSize + "px";
    wrapper.style.letterSpacing = request.letterSpacing + "px";
    if (request.titleFontSize != null) {
      wrapper.style.setProperty("--title-font-size", request.titleFontSize + "px");
    } else {
      wrapper.style.removeProperty("--title-font-size");
    }
    wrapper.innerHTML = "";

    const els: { key: string; el: HTMLDivElement }[] = [];
    for (const c of request.candidates) {
      const el = document.createElement("div");
      el.style.cssText = "width:100%;margin:0;padding:0";
      el.innerHTML = c.blocks
        ? c.blocks.map(blockToHtml).join("")
        : markdownToHtml(c.content ?? "", PixelRatio.get());
      wrapper.appendChild(el);
      els.push({ key: c.key, el });
    }

    requestAnimationFrame(() => {
      const heights: Record<string, number> = {};
      for (const { key, el } of els) {
        heights[key] = el.getBoundingClientRect().height + blockGap;
      }
      onMeasuredRef.current(heights);
    });
  }, [request]);

  useLayoutEffect(() => {
    measureNow();
  });

  return (
    <>
      <style>{measureTypographyCss}</style>
      <div
        ref={containerRef}
        className="webview-measure-layer"
        style={{
          ...CONTAINER_STYLE,
          fontFamily: "'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif",
          lineHeight: 1.8,
          color: "#1A1A1A",
          overflowWrap: "break-word" as const,
          wordWrap: "break-word" as const,
          textAlign: "justify" as const,
        }}
      />
    </>
  );
}
