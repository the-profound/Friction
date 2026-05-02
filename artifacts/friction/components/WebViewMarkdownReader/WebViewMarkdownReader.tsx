import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { getReaderHtml } from "./readerHtml";
import { getEditorFonts, subscribeEditorFonts, type EditorFontState } from "@/lib/editorFontStore";
import { markdownToHtml } from "@/lib/markdownRenderer";

export interface WebViewMarkdownReaderProps {
  markdown: string;
  bodyFontSize?: number;
  bodyLetterSpacing?: number;
  onTextSelect?: (text: string, isEmpty: boolean) => void;
  onReady?: () => void;
  clearSelectionSignal?: number;
}

export default function WebViewMarkdownReader({
  markdown,
  bodyFontSize,
  bodyLetterSpacing,
  onTextSelect,
  onReady,
  clearSelectionSignal,
}: WebViewMarkdownReaderProps) {
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;
  const prevClearSignalRef = useRef(clearSelectionSignal);
  const onTextSelectRef = useRef(onTextSelect);
  onTextSelectRef.current = onTextSelect;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const sendCommand = useCallback((cmd: object) => {
    const js = `(function(){try{handleCommand(${JSON.stringify(cmd)})}catch(e){}})();true;`;
    webViewRef.current?.injectJavaScript(js);
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === "onReady") {
          onReadyRef.current?.();
        } else if (data.type === "onTextSelect") {
          onTextSelectRef.current?.(data.text ?? "", !!data.isEmpty);
        }
      } catch {}
    },
    [],
  );

  const prevMarkdownRef = useRef(markdown);
  useEffect(() => {
    if (!readyRef.current) return;
    if (markdown === prevMarkdownRef.current) return;
    prevMarkdownRef.current = markdown;
    sendCommand({ type: "setContent", html: markdownToHtml(markdown) });
    sendCommand({ type: "clearSelection" });
    onTextSelectRef.current?.("", true);
  }, [markdown, sendCommand]);

  useEffect(() => {
    if (readyRef.current && bodyFontSize != null && bodyLetterSpacing != null) {
      sendCommand({ type: "setBodyMetrics", fontSizePx: bodyFontSize, letterSpacingPx: bodyLetterSpacing });
    }
  }, [bodyFontSize, bodyLetterSpacing, sendCommand]);

  useEffect(() => {
    if (clearSelectionSignal === prevClearSignalRef.current) return;
    prevClearSignalRef.current = clearSelectionSignal;
    if (readyRef.current) {
      sendCommand({ type: "clearSelection" });
    }
  }, [clearSelectionSignal, sendCommand]);

  const [fonts, setFonts] = useState<EditorFontState>(() => getEditorFonts());

  useEffect(() => {
    const unsubscribe = subscribeEditorFonts((next) => setFonts(next));
    setFonts(getEditorFonts());
    return unsubscribe;
  }, []);

  const fontsReady = !!(fonts.regularBase64 && fonts.semiBoldBase64);
  const canRender = fontsReady || !!fonts.error;

  const html = useMemo(
    () => getReaderHtml({ regularBase64: fonts.regularBase64, semiBoldBase64: fonts.semiBoldBase64 }),
    [fonts.regularBase64, fonts.semiBoldBase64],
  );

  if (!canRender) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color="#a1a1aa" />
      </View>
    );
  }

  return (
    <WebView
      ref={webViewRef}
      source={{ html }}
      style={styles.webView}
      onMessage={handleMessage}
      onLoad={() => {
        readyRef.current = true;
        prevMarkdownRef.current = markdownRef.current;
        sendCommand({ type: "setContent", html: markdownToHtml(markdownRef.current) });
        if (bodyFontSize != null && bodyLetterSpacing != null) {
          sendCommand({ type: "setBodyMetrics", fontSizePx: bodyFontSize, letterSpacingPx: bodyLetterSpacing });
        }
      }}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      allowUniversalAccessFromFileURLs={false}
      mediaPlaybackRequiresUserAction
      scrollEnabled={false}
      bounces={false}
      showsVerticalScrollIndicator={false}
      contentMode="mobile"
    />
  );
}

const styles = StyleSheet.create({
  webView: {
    flex: 1,
    backgroundColor: "transparent",
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
