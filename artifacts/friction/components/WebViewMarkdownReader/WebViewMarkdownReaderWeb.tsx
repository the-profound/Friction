import React, { useRef, useEffect, useMemo } from "react";
import { PixelRatio } from "react-native";
import type { WebViewMarkdownReaderProps } from "./WebViewMarkdownReader";
import { ReaderTokens } from "@/constants/tokens";
import { markdownToHtml } from "@/lib/markdownRenderer";

export default function WebViewMarkdownReaderWeb({
  markdown,
  bodyFontSize,
  bodyLetterSpacing,
  titleFontSize,
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

  useEffect(() => {
    onReady?.();
  }, []);

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

  const contentStyle: React.CSSProperties = useMemo(() => ({
    width: "100%",
    fontFamily: "'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif",
    fontSize: bodyFontSize ?? 16,
    lineHeight: 1.8,
    letterSpacing: bodyLetterSpacing ?? 0.8,
    ...(titleFontSize != null ? { "--title-font-size": `${titleFontSize}px` } : {}),
    color: "#1A1A1A",
    textAlign: "justify" as const,
    overflowWrap: "break-word" as const,
    wordWrap: "break-word" as const,
    wordBreak: "normal" as const,
    hyphens: "auto",
    WebkitHyphens: "auto",
    userSelect: "text" as const,
    WebkitUserSelect: "text" as const,
  }), [bodyFontSize, bodyLetterSpacing, titleFontSize]);

  return (
    <div style={wrapperStyle}>
      <style>{webReaderCSS}</style>
      <div
        ref={containerRef}
        style={contentStyle}
        className="reader-content"
        lang="en"
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

const webReaderCSS = `
.reader-content p{margin-bottom:1em;text-align:justify;overflow-wrap:break-word;word-break:normal;-webkit-hyphens:auto;hyphens:auto;text-justify:inter-ideograph}
 .reader-content h1{font-family:'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif;font-size:var(--title-font-size,${ReaderTokens.typeScale.titleCqi}cqi);font-weight:600;letter-spacing:0.025em;margin:1em 0 0.4em;line-height:1.25;text-align:left}
.reader-content h2{font-family:'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif;font-size:1.3em;font-weight:600;letter-spacing:0.025em;margin:0.8em 0 0.3em;line-height:1.3;text-align:left}
.reader-content h3{font-family:'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif;font-size:1.1em;font-weight:600;letter-spacing:0.025em;margin:0.6em 0 0.3em;line-height:1.35;text-align:left}
.reader-content ul,.reader-content ol{padding-left:1.5em;margin-bottom:1em;text-align:left}
.reader-content li{margin-bottom:0.2em;text-align:left}
.reader-content li p{margin-bottom:0}
.reader-content blockquote{font-family:'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif;font-style:italic;border-left:3px solid #d4d4d8;padding-left:1em;margin:0.5em 0;color:#52525b;text-align:justify;overflow-wrap:break-word;word-break:normal;-webkit-hyphens:auto;hyphens:auto;text-justify:inter-ideograph}
.reader-content hr{border:none;border-top:1px solid #e4e4e7;margin:1em 0}
.reader-content u{text-decoration:underline}
.reader-content strong{font-family:'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif;font-weight:700}
.reader-content em{font-style:italic}
::selection{background:rgba(59,130,246,0.3)}
`;
