import React, { useRef, useEffect, useMemo, useState } from "react";
import { PixelRatio } from "react-native";
import type { WebViewMarkdownReaderProps } from "./WebViewMarkdownReader";
import { markdownToHtml } from "@/lib/markdownRenderer";
import { buildBodyTypographyCss } from "@/components/shared/bodyTypographyCss";
import {
  BODY_REGULAR_FONT_FAMILY,
  resolveBodyFontFamilies,
} from "@/components/shared/bodyTypographyFonts";
import {
  hasCompleteBodyFontSet,
  logWebBodyTypographyDiagnostic,
  waitForWebBodyFonts,
  type BodyFontLoadStatus,
} from "@/lib/bodyTypographyDiagnostics";

export default function WebViewMarkdownReaderWeb({
  markdown,
  typography,
  onTextSelect,
  onReady,
  clearSelectionSignal,
}: WebViewMarkdownReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevClearSignalRef = useRef(clearSelectionSignal);
  const onTextSelectRef = useRef(onTextSelect);
  onTextSelectRef.current = onTextSelect;

  const html = useMemo(
    () => markdownToHtml(markdown, PixelRatio.get()),
    [markdown],
  );

  const [fontStatus, setFontStatus] = useState<BodyFontLoadStatus | null>(null);
  const fontsReady = fontStatus !== null;
  useEffect(() => {
    let active = true;
    waitForWebBodyFonts().then((status) => {
      if (active) {
        setFontStatus(status);
        onReady?.();
      }
    });
    return () => { active = false; };
  }, [onReady]);

  useEffect(() => {
    if (!fontsReady || !containerRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (containerRef.current) {
        logWebBodyTypographyDiagnostic(
          "reader",
          containerRef.current,
          typography,
          fontStatus ?? undefined,
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [fontStatus, fontsReady, typography]);

  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      const el = containerRef.current;
      if (el && sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (el.contains(range.commonAncestorContainer)) {
          onTextSelectRef.current?.(text, !text);
          return;
        }
      }
      if (!text) {
        onTextSelectRef.current?.("", true);
      }
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, []);

  useEffect(() => {
    if (clearSelectionSignal === prevClearSignalRef.current) return;
    prevClearSignalRef.current = clearSelectionSignal;
    window.getSelection()?.removeAllRanges();
    onTextSelectRef.current?.("", true);
  }, [clearSelectionSignal]);

  const contentStyle: React.CSSProperties = useMemo(() => {
    const families = resolveBodyFontFamilies(hasCompleteBodyFontSet(fontStatus));
    return {
    width: typography.textColumnWidth,
    fontFamily: `var(--body-regular-font-family, ${BODY_REGULAR_FONT_FAMILY})`,
    fontSize: typography.fontSizePx,
    lineHeight: `${typography.lineHeightPx}px`,
    letterSpacing: typography.letterSpacingPx,
    "--body-font-size": `${typography.fontSizePx}px`,
    "--body-line-height": `${typography.lineHeightPx}px`,
    "--body-paragraph-gap": `${typography.paragraphGapPx}px`,
    "--body-letter-spacing": `${typography.letterSpacingPx}px`,
    "--title-font-size": `${typography.titleFontSizePx}px`,
    "--body-regular-font-family": families.regular,
    "--body-semibold-font-family": families.semibold,
    color: "#1A1A1A",
    textAlign: "justify" as const,
    overflowWrap: "anywhere" as const,
    wordWrap: "break-word" as const,
    wordBreak: "normal" as const,
    hyphens: "auto",
    WebkitHyphens: "auto",
    userSelect: "text" as const,
    WebkitUserSelect: "text" as const,
    };
  }, [fontStatus, typography]);

  return (
    <div style={{ ...wrapperStyle, visibility: fontsReady ? "visible" : "hidden" }}>
      <style>{webReaderCSS}</style>
      <div
        ref={containerRef}
        style={contentStyle}
        className="reader-content"
        lang="ko"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

const wrapperStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  overflow: "hidden",
};

const webReaderCSS = `${buildBodyTypographyCss({
  rootSelector: ".reader-content",
  blockSelector: ".reader-content",
  blockMargins: "spaced",
  hrStyle: "spaced",
  readerUnderline: true,
})}\n::selection{background:rgba(59,130,246,0.3)}`;
