import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { View, StyleSheet, ActivityIndicator, Animated, PixelRatio } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { getReaderHtml } from "./readerHtml";
import { areEditorFontsReady, getEditorFonts, subscribeEditorFonts, type EditorFontState } from "@/lib/editorFontStore";
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
  titleFontSize?: number;
  onTextSelect?: (text: string, isEmpty: boolean) => void;
  onReady?: () => void;
  clearSelectionSignal?: number;
  onDragStateChange?: (isDragging: boolean) => void;
}

const FADE_OUT_DURATION_MS = 100;
const CONTENT_READY_FALLBACK_MS = 250;
// Background colour of the page — must match the slot content background so
// the overlay is invisible while the WebView loads behind it.
const OVERLAY_BG = "#FFFFFF";

export default function WebViewMarkdownReader({
  markdown,
  bodyFontSize,
  bodyLetterSpacing,
  titleFontSize,
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

  // Starts at 1 (overlay fully opaque, hiding the WebView until content is
  // ready). Fades to 0 once content is rendered (overlay becomes transparent).
  // The WebView itself always has opacity:1 so iOS never creates a compositing
  // buffer for it during ancestor scale animations (dansang sheet open/close).
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const fadeAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  // Tracks the latest setContent we issued. onContentReady from older
  // injections is ignored so we never fade in stale content.
  const pendingVersionRef = useRef(0);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyFontsReadyRef = useRef(false);

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
    // Fade the overlay OUT to reveal the WebView beneath.
    fadeAnimRef.current = Animated.timing(opacityAnim, {
      toValue: 0,
      duration: FADE_OUT_DURATION_MS,
      useNativeDriver: true,
    });
    fadeAnimRef.current.start();
  }, [opacityAnim]);

  const beginContentSwap = useCallback(() => {
    // Snap overlay back to opaque so the async DOM update is invisible.
    if (fadeAnimRef.current) {
      fadeAnimRef.current.stop();
    }
    opacityAnim.setValue(1);
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
        if (data.type === "onBodyFontsReady") {
          if (bodyFontsReadyRef.current) return;
          bodyFontsReadyRef.current = true;
          bridge.markReady();
          prevHtmlRef.current = htmlRef.current;
          const version = beginContentSwap();
          injectContent(htmlRef.current, version);
          if (bodyFontSize != null && bodyLetterSpacing != null) {
            bridge.send({
              type: "setBodyMetrics",
              fontSizePx: bodyFontSize,
              letterSpacingPx: bodyLetterSpacing,
              titleFontSizePx: titleFontSize,
            });
          }
        } else if (data.type === "onReady") {
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
    [bridge, fadeIn, clearFallbackTimer, beginContentSwap, injectContent, bodyFontSize, bodyLetterSpacing, titleFontSize],
  );

  // Memoize markdown→HTML so we don't re-parse on unrelated re-renders.
  const html = useMemo(
    () => markdownToHtml(markdown, PixelRatio.get()),
    [markdown],
  );
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
      bridge.send({
        type: "setBodyMetrics",
        fontSizePx: bodyFontSize,
        letterSpacingPx: bodyLetterSpacing,
        titleFontSizePx: titleFontSize,
      });
    }
  }, [bridge, bodyFontSize, bodyLetterSpacing, titleFontSize]);

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

  const fontsReady = areEditorFontsReady(fonts);
  const canRender = fontsReady || !!fonts.error;

  const documentHtml = useMemo(
    () => getReaderHtml({
      regularBase64: fonts.regularBase64,
      semiBoldBase64: fonts.semiBoldBase64,
      notoRegularBase64: fonts.notoRegularBase64,
      notoSemiBoldBase64: fonts.notoSemiBoldBase64,
      perfEnabled: isWebViewPerfEnabled(),
    }),
    [fonts.regularBase64, fonts.semiBoldBase64, fonts.notoRegularBase64, fonts.notoSemiBoldBase64],
  );
  const previousDocumentHtmlRef = useRef(documentHtml);
  if (documentHtml !== previousDocumentHtmlRef.current) {
    previousDocumentHtmlRef.current = documentHtml;
    bodyFontsReadyRef.current = false;
    opacityAnim.setValue(1);
    bridge.reset("WebViewMarkdownReader font configuration changed");
  }

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
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: documentHtml }}
        style={styles.webView}
        onMessage={handleMessage}
        onLoad={() => {
          // Initial content is injected only after onBodyFontsReady.
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
      {/* Opaque overlay that hides the WebView until content is ready, then
          fades out. Kept separate from the WebView so the WebView itself never
          has an animated opacity ancestor — this prevents iOS from creating an
          offscreen compositing buffer for the WKWebView during scale animations
          (e.g. dansang sheet open/close), which was the cause of the blur and
          the brief re-rasterization flash when returning to scale 1.0. */}
      <Animated.View
        style={[styles.overlay, { opacity: opacityAnim }]}
        pointerEvents="none"
      />
    </View>
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
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: OVERLAY_BG,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
