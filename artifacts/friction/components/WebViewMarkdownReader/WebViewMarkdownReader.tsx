import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { View, StyleSheet, ActivityIndicator, Animated } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { getReaderHtml } from "./readerHtml";
import { getEditorFonts, subscribeEditorFonts, type EditorFontState } from "@/lib/editorFontStore";
import { markdownToHtml } from "@/lib/markdownRenderer";
import {
  flushWebViewPerf,
  isWebViewPerfEnabled,
  recordWebViewBoot,
} from "@/lib/webviewPerf";
import { createWebViewBridge, type WebViewBridge, type WebViewCommand } from "@/lib/webViewBridge";

export interface WebViewMarkdownReaderProps {
  markdown: string;
  bodyFontSize?: number;
  bodyLetterSpacing?: number;
  onTextSelect?: (text: string, isEmpty: boolean) => void;
  onReady?: () => void;
  clearSelectionSignal?: number;
  onDragStateChange?: (isDragging: boolean) => void;
}

const FADE_IN_DURATION_MS = 100;
const CONTENT_READY_FALLBACK_MS = 250;

export default function WebViewMarkdownReader({
  markdown,
  bodyFontSize,
  bodyLetterSpacing,
  onTextSelect,
  onReady,
  clearSelectionSignal,
  onDragStateChange,
}: WebViewMarkdownReaderProps) {
  const webViewRef = useRef<WebView>(null);
  const mountedAtRef = useRef<number>(Date.now());
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;
  const prevClearSignalRef = useRef(clearSelectionSignal);
  const onTextSelectRef = useRef(onTextSelect);
  onTextSelectRef.current = onTextSelect;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onDragStateChangeRef = useRef(onDragStateChange);
  onDragStateChangeRef.current = onDragStateChange;

  const bridgeRef = useRef<WebViewBridge | null>(null);
  if (bridgeRef.current == null) {
    bridgeRef.current = createWebViewBridge({ webViewRef, category: "reader" });
  }
  const bridge = bridgeRef.current;

  const opacityAnim = useRef(new Animated.Value(0)).current;
  const fadeAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  // Tracks the latest setContent we issued. onContentReady from older
  // injections is ignored so we never fade in stale content.
  const pendingVersionRef = useRef(0);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current != null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const fadeIn = useCallback(() => {
    if (fadeAnimRef.current) {
      fadeAnimRef.current.stop();
    }
    fadeAnimRef.current = Animated.timing(opacityAnim, {
      toValue: 1,
      duration: FADE_IN_DURATION_MS,
      useNativeDriver: true,
    });
    fadeAnimRef.current.start();
  }, [opacityAnim]);

  const beginContentSwap = useCallback(() => {
    // Hide instantly so the brief gap during async DOM update is invisible.
    if (fadeAnimRef.current) {
      fadeAnimRef.current.stop();
    }
    opacityAnim.setValue(0);
    pendingVersionRef.current += 1;
    const myVersion = pendingVersionRef.current;
    clearFallbackTimer();
    // Safety net: if onContentReady is somehow lost (e.g. dropped message),
    // still reveal the WebView shortly after so the screen never stays blank.
    fallbackTimerRef.current = setTimeout(() => {
      fallbackTimerRef.current = null;
      if (pendingVersionRef.current === myVersion) {
        fadeIn();
      }
    }, CONTENT_READY_FALLBACK_MS);
    return myVersion;
  }, [opacityAnim, fadeIn, clearFallbackTimer]);

  const injectContent = useCallback(
    (htmlToInject: string, version: number) => {
      bridge.send({ type: "setContent", html: htmlToInject, version });
    },
    [bridge],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      bridge.handleMessage(event, (data) => {
        if (data.type === "onReady") {
          recordWebViewBoot("reader", mountedAtRef.current);
          onReadyRef.current?.();
        } else if (data.type === "onContentReady") {
          // Only honor the ready event for the most recent injection.
          // If `version` is missing (older HTML), fall back to fading in.
          const v = (data as { version?: number }).version;
          if (v == null || v === pendingVersionRef.current) {
            clearFallbackTimer();
            fadeIn();
          }
        } else if (data.type === "onTextSelect") {
          const d = data as { text?: string; isEmpty?: boolean };
          onTextSelectRef.current?.(d.text ?? "", !!d.isEmpty);
        } else if (data.type === "onDragStart") {
          onDragStateChangeRef.current?.(true);
        } else if (data.type === "onDragEnd") {
          onDragStateChangeRef.current?.(false);
        }
      });
    },
    [bridge, fadeIn, clearFallbackTimer],
  );

  // Memoize markdown→HTML so we don't re-parse on unrelated re-renders.
  const html = useMemo(() => markdownToHtml(markdown), [markdown]);
  const htmlRef = useRef(html);
  htmlRef.current = html;

  const prevHtmlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bridge.isReady()) return;
    if (html === prevHtmlRef.current) return;
    prevHtmlRef.current = html;
    // Subsequent content updates (e.g. page-turn swipe rotates 3-slot row and
    // feeds the current slot a new markdown prop) must NOT hide the WebView
    // first. Dropping opacity to 0 before the async DOM update was producing
    // a visible blank-frame flicker — especially noticeable on Expo Go where
    // the JS-bridge round-trip for setContent + onContentReady is slower.
    // Keeping opacity at 1 lets the WebView swap its DOM atomically on the
    // next paint; the prior content stays visible until the new one paints,
    // which reads as a smooth page turn instead of a flash.
    pendingVersionRef.current += 1;
    injectContent(html, pendingVersionRef.current);
    bridge.send({ type: "clearSelection" } as WebViewCommand);
    onTextSelectRef.current?.("", true);
  }, [bridge, html, injectContent]);

  useEffect(() => {
    if (bridge.isReady() && bodyFontSize != null && bodyLetterSpacing != null) {
      bridge.send({ type: "setBodyMetrics", fontSizePx: bodyFontSize, letterSpacingPx: bodyLetterSpacing });
    }
  }, [bridge, bodyFontSize, bodyLetterSpacing]);

  useEffect(() => {
    if (clearSelectionSignal === prevClearSignalRef.current) return;
    prevClearSignalRef.current = clearSelectionSignal;
    if (bridge.isReady()) {
      bridge.send({ type: "clearSelection" } as WebViewCommand);
    }
  }, [bridge, clearSelectionSignal]);

  // Cleanup on unmount: stop any in-flight fade and pending fallback timers.
  useEffect(() => {
    return () => {
      if (fadeAnimRef.current) {
        fadeAnimRef.current.stop();
        fadeAnimRef.current = null;
      }
      clearFallbackTimer();
      bridge.reset("WebViewMarkdownReader unmount");
    };
  }, [bridge, clearFallbackTimer]);

  const [fonts, setFonts] = useState<EditorFontState>(() => getEditorFonts());

  useEffect(() => {
    const unsubscribe = subscribeEditorFonts((next) => setFonts(next));
    setFonts(getEditorFonts());
    return unsubscribe;
  }, []);

  const fontsReady = !!(fonts.regularBase64 && fonts.semiBoldBase64);
  const canRender = fontsReady || !!fonts.error;

  const documentHtml = useMemo(
    () => getReaderHtml({
      regularBase64: fonts.regularBase64,
      semiBoldBase64: fonts.semiBoldBase64,
      perfEnabled: isWebViewPerfEnabled(),
    }),
    [fonts.regularBase64, fonts.semiBoldBase64],
  );

  // 컴포넌트가 unmount 될 때 누적된 리더 지표를 콘솔에 요약 출력한다.
  useEffect(() => {
    return () => { flushWebViewPerf("reader"); };
  }, []);

  if (!canRender) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color="#a1a1aa" />
      </View>
    );
  }

  return (
    <Animated.View style={[styles.container, { opacity: opacityAnim }]}>
      <WebView
        ref={webViewRef}
        source={{ html: documentHtml }}
        style={styles.webView}
        onMessage={handleMessage}
        onLoad={() => {
          bridge.markReady();
          prevHtmlRef.current = htmlRef.current;
          // Hide before the very first content injection too, then fade in
          // when the WebView reports the new DOM is in place.
          const version = beginContentSwap();
          injectContent(htmlRef.current, version);
          if (bodyFontSize != null && bodyLetterSpacing != null) {
            bridge.send({ type: "setBodyMetrics", fontSizePx: bodyFontSize, letterSpacingPx: bodyLetterSpacing });
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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
