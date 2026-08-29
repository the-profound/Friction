/**
 * WebViewMeasureLayer 웹 플랫폼 폴백.
 *
 * 네이티브 WebView를 사용할 수 없는 웹 환경에서 DOM 숨김 컨테이너로
 * 동일한 측정 계약을 구현한다. getBoundingClientRect().height + blockGap
 * 방식으로 네이티브 구현과 동일한 결과를 반환한다.
 */
import React, { useRef, useLayoutEffect, useCallback, useEffect, useState } from "react";
import { PixelRatio } from "react-native";
import { buildBodyTypographyCss } from "@/components/shared/bodyTypographyCss";
import { blockToHtml, markdownToHtml } from "@/lib/markdownRenderer";
import type { MeasureRequest } from "../PretextMeasureLayer/PretextMeasureLayer";
import { BODY_REGULAR_FONT_FAMILY } from "@/components/shared/bodyTypographyFonts";
import {
  logWebBodyTypographyDiagnostic,
  waitForWebBodyFonts,
  type BodyFontLoadStatus,
} from "@/lib/bodyTypographyDiagnostics";

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
  const [fontsReady, setFontsReady] = useState(false);
  const fontStatusRef = useRef<BodyFontLoadStatus | null>(null);
  useEffect(() => {
    let active = true;
    waitForWebBodyFonts().then((status) => {
      if (active) {
        fontStatusRef.current = status;
        setFontsReady(true);
      }
    });
    return () => { active = false; };
  }, []);

  const measureNow = useCallback(() => {
    if (!fontsReady || !request || request === prevRequestRef.current) return;
    if (!containerRef.current) return;
    if (request.candidates.length === 0) {
      prevRequestRef.current = request;
      onMeasuredRef.current({});
      return;
    }

    prevRequestRef.current = request;
    const containerWidth = request.typography.textColumnWidth;
    const blockGap = request.blockGap ?? request.typography.lineHeightPx * 0.6;
    const wrapper = containerRef.current;

    wrapper.style.width = containerWidth + "px";
    wrapper.style.fontSize = request.typography.fontSizePx + "px";
    wrapper.style.lineHeight = request.typography.lineHeightPx + "px";
    wrapper.style.letterSpacing = request.typography.letterSpacingPx + "px";
    wrapper.style.setProperty("--body-font-size", request.typography.fontSizePx + "px");
    wrapper.style.setProperty("--body-line-height", request.typography.lineHeightPx + "px");
    wrapper.style.setProperty("--body-letter-spacing", request.typography.letterSpacingPx + "px");
    wrapper.style.setProperty("--title-font-size", request.typography.titleFontSizePx + "px");
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
      logWebBodyTypographyDiagnostic(
        "measure",
        wrapper,
        request.typography,
        fontStatusRef.current ?? undefined,
      );
      onMeasuredRef.current(heights);
    });
  }, [request, fontsReady]);

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
          fontFamily: BODY_REGULAR_FONT_FAMILY,
          textSizeAdjust: "100%",
          WebkitTextSizeAdjust: "100%",
          color: "#1A1A1A",
          overflowWrap: "break-word" as const,
          wordWrap: "break-word" as const,
          textAlign: "justify" as const,
        }}
      />
    </>
  );
}
