import React, { useRef, useCallback, useImperativeHandle, forwardRef, useEffect, useState, useMemo } from "react";
import { View, StyleSheet, Platform, Keyboard, ActivityIndicator } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { getEditorHtml, EDITOR_CONFIG_VERSION } from "./editorHtml";
import { getEditorFonts, subscribeEditorFonts, consumeEditorFontsErrorToast, type EditorFontState } from "@/lib/editorFontStore";
import { useToast } from "@/contexts/ToastContext";
import {
  flushWebViewPerf,
  isWebViewPerfEnabled,
  recordExportReceive,
  recordExportSend,
  recordWebViewBoot,
} from "@/lib/webviewPerf";
import type {
  WebViewMarkdownEditorProps,
  WebViewMarkdownEditorRef,
  RNToWebViewCommand,
  WebViewToRNEvent,
} from "./types";
import { createWebViewBridge, type WebViewBridge } from "@/lib/webViewBridge";

const WebViewMarkdownEditor = forwardRef<WebViewMarkdownEditorRef, WebViewMarkdownEditorProps>(
  function WebViewMarkdownEditor(
    {
      initialMarkdown,
      titleValue,
      editorConfigVersion = EDITOR_CONFIG_VERSION,
      placeholder,
      editable = true,
      onReady,
      onChange,
      onExportMarkdown,
      onTitleChange,
      onError,
      onKeyboardVisibilityChange,
      onSelectionUpdate,
      onTextSelectionActiveChange,
      sourceArticleSlotText,
      onSourceArticleSlotTap,
      bodyFontSize,
      bodyLetterSpacing,
      titleFontSize,
      hideTitle,
      scrollEnabled = true,
      onOverflowSplit,
      swipeDownToDismissKeyboard = true,
    },
    ref,
  ) {
    const webViewRef = useRef<WebView>(null);
    const mountedAtRef = useRef<number>(Date.now());
    const [scrollLocked, setScrollLocked] = useState(false);
    const autoSplitResolversRef = useRef<Array<(r: { hadConsecutiveImages: boolean }) => void>>([]);

    const bridgeRef = useRef<WebViewBridge | null>(null);
    if (bridgeRef.current == null) {
      bridgeRef.current = createWebViewBridge({ webViewRef, category: "editor" });
    }
    const bridge = bridgeRef.current;

    const sendCommand = useCallback(
      (cmd: RNToWebViewCommand) => bridge.send(cmd),
      [bridge],
    );

    useImperativeHandle(ref, () => ({
      setMarkdown(markdown: string) {
        sendCommand({ type: "setMarkdown", markdown });
      },
      requestExportMarkdown(requestId: string) {
        // requestExportMarkdown 은 호환을 위해 기존 typed-event 패턴을 유지한다
        // (caller 들이 onExportMarkdown 콜백 + 자체 requestId 를 사용하기 때문).
        // round-trip perf 는 send/receive 시각으로 별도 기록한다.
        recordExportSend("editor", requestId);
        sendCommand({ type: "requestExportMarkdown", requestId });
      },
      setEditable(isEditable: boolean) {
        sendCommand({ type: "setEditable", isEditable });
      },
      setTitle(title: string) {
        sendCommand({ type: "setTitle", title });
      },
      blur() {
        bridge.injectRaw(`(function(){try{if(document.activeElement){document.activeElement.blur();}}catch(e){}})();true;`);
      },
      undo() {
        sendCommand({ type: "undo" });
      },
      redo() {
        sendCommand({ type: "redo" });
      },
      setOverflowRanges(ranges) {
        sendCommand({ type: "setOverflowRanges", ranges });
      },
      setOverflowProbeConfig(availableContentHeightPx, autoSplit) {
        sendCommand({ type: "setOverflowProbeConfig", availableContentHeightPx, autoSplit });
      },
      setBlockType(blockType: string) {
        sendCommand({ type: "setBlockType", blockType });
      },
      toggleMark(mark: string) {
        sendCommand({ type: "toggleMark", mark });
      },
      insertDivider() {
        sendCommand({ type: "insertDivider" });
      },
      insertHardBreak() {
        sendCommand({ type: "insertHardBreak" });
      },
      insertImage(url: string) {
        sendCommand({ type: "insertImage", url });
      },
      insertQuote(text: string) {
        sendCommand({ type: "insertQuote", text });
      },
      autoSplitImages() {
        return new Promise<{ hadConsecutiveImages: boolean }>((resolve) => {
          autoSplitResolversRef.current.push(resolve);
          sendCommand({ type: "autoSplitImages" });
        });
      },
      scrollToBlock(pageIndex: number, blockIndex: number) {
        sendCommand({ type: "scrollToBlock", pageIndex, blockIndex });
      },
      setSpellHighlight(original: string, contextHint: string, occurrenceIndex: number) {
        sendCommand({ type: "setSpellHighlight", original, contextHint, occurrenceIndex });
      },
      clearSpellHighlight() {
        sendCommand({ type: "clearSpellHighlight" });
      },
      applySpellFix(original: string, replacement: string, contextHint: string, occurrenceIndex: number) {
        sendCommand({ type: "applySpellFix", original, replacement, contextHint, occurrenceIndex });
      },
    }), [bridge, sendCommand]);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        bridge.handleMessage(event, (raw) => {
          const data = raw as WebViewToRNEvent;
          switch (data.type) {
            case "onReady":
              // markReady 는 onLoad 시점에 이미 호출되어 있다 (init 자체가
              // 큐에 막히면 onReady 가 영원히 오지 않는 데드락이 생기기
              // 때문). 여기서는 boot 지표 기록과 외부 콜백만 처리한다.
              recordWebViewBoot("editor", mountedAtRef.current);
              if (hideTitle) {
                bridge.injectRaw(
                  `(function(){try{` +
                    `var t=document.getElementById('title-input');if(t)t.style.display='none';` +
                    `var s=document.getElementById('source-article-slot');if(s)s.style.display='none';` +
                    `if(document.body)document.body.style.paddingTop='0px';` +
                    `var ec=document.getElementById('editor-content');if(ec)ec.style.paddingBottom='24px';` +
                    `}catch(e){}})();true;`,
                );
              }
              onReady?.();
              break;
            case "onChange":
              onChange?.(data.payload);
              break;
            case "onExportMarkdown":
              recordExportReceive("editor", data.payload.requestId);
              onExportMarkdown?.(data.payload);
              break;
            case "onTitleChange":
              onTitleChange?.(data.payload.title);
              break;
            case "onError":
              onError?.(data.payload);
              break;
            case "onKeyboardShow":
              onKeyboardVisibilityChange?.(true);
              break;
            case "onKeyboardHide":
              onKeyboardVisibilityChange?.(false);
              break;
            case "onSwipeDownToDismiss": {
              if (!swipeDownToDismissKeyboard) break;
              bridge.injectRaw(`(function(){try{if(document.activeElement){document.activeElement.blur();}}catch(e){}})();true;`);
              Keyboard.dismiss();
              break;
            }
            case "onSourceArticleSlotTap":
              onSourceArticleSlotTap?.();
              break;
            case "onSelectionUpdate":
              onSelectionUpdate?.(data.payload);
              break;
            case "onSelHandleDragStart":
              setScrollLocked(true);
              onTextSelectionActiveChange?.(true);
              break;
            case "onSelHandleDragEnd":
              setScrollLocked(false);
              onTextSelectionActiveChange?.(false);
              break;
            case "onAutoSplitComplete": {
              const resolvers = autoSplitResolversRef.current.splice(0);
              resolvers.forEach((r) => r(data.payload));
              break;
            }
            case "onOverflowSplit":
              onOverflowSplit?.(data.payload);
              break;
          }
        });
      },
      [bridge, hideTitle, onReady, onChange, onExportMarkdown, onTitleChange, onError, onKeyboardVisibilityChange, onSelectionUpdate, onTextSelectionActiveChange, onSourceArticleSlotTap, onOverflowSplit, swipeDownToDismissKeyboard],
    );

    useEffect(() => {
      if (bridge.isReady()) {
        sendCommand({ type: "setEditable", isEditable: editable });
      }
    }, [bridge, editable, sendCommand]);

    useEffect(() => {
      if (bridge.isReady() && bodyFontSize != null && bodyLetterSpacing != null) {
        sendCommand({
          type: "setBodyMetrics",
          fontSizePx: bodyFontSize,
          letterSpacingPx: bodyLetterSpacing,
          titleFontSizePx: titleFontSize,
        });
      }
    }, [bridge, bodyFontSize, bodyLetterSpacing, titleFontSize, sendCommand]);

    useEffect(() => {
      sendCommand({ type: "setSourceArticleSlot", text: sourceArticleSlotText ?? "" });
    }, [sourceArticleSlotText, sendCommand]);

    const [fonts, setFonts] = useState<EditorFontState>(() => getEditorFonts());
    const { showToast } = useToast();

    useEffect(() => {
      const unsubscribe = subscribeEditorFonts((next) => setFonts(next));
      setFonts(getEditorFonts());
      return unsubscribe;
    }, []);

    useEffect(() => {
      if (fonts.error && !fonts.regularBase64 && consumeEditorFontsErrorToast()) {
        showToast({
          message: "에디터 폰트를 불러오지 못했어요. 시스템 폰트로 표시됩니다.",
          type: "error",
          duration: 4000,
        });
      }
    }, [fonts.error, fonts.regularBase64, showToast]);

    const fontsReady = !!(fonts.regularBase64 && fonts.semiBoldBase64);
    // If font loading hard-failed, fall back to system serif (no @font-face)
    // so the editor remains usable instead of getting stuck on a spinner.
    const canRenderEditor = fontsReady || !!fonts.error;

    const html = useMemo(
      () => getEditorHtml({
        regularBase64: fonts.regularBase64,
        semiBoldBase64: fonts.semiBoldBase64,
        perfEnabled: isWebViewPerfEnabled(),
      }),
      [fonts.regularBase64, fonts.semiBoldBase64],
    );

    // 컴포넌트가 unmount 될 때 누적된 편집기 지표를 콘솔에 요약 출력한다.
    useEffect(() => {
      return () => {
        flushWebViewPerf("editor");
        bridge.reset("WebViewMarkdownEditor unmount");
      };
    }, [bridge]);

    if (!canRenderEditor) {
      return (
        <View style={[styles.container, styles.loading]}>
          <ActivityIndicator size="small" color="#a1a1aa" />
        </View>
      );
    }

    return (
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          source={{ html }}
          style={styles.webView}
          onMessage={handleMessage}
          onLoad={() => {
            // 편집기 HTML 의 IIFE 가 동기 실행 단계에서 window.handleCommand 를
            // 등록하므로 onLoad 시점이면 init 명령을 즉시 디스패치해도 안전하다.
            // 만약 onReady 까지 markReady 를 미루면 init 자체가 큐에 갇혀
            // onReady 가 절대 발생하지 않는 데드락이 생긴다.
            bridge.markReady();
            sendCommand({
              type: "init",
              payload: { initialMarkdown, editorConfigVersion, placeholder, titleValue },
            });
            if (bodyFontSize != null && bodyLetterSpacing != null) {
              sendCommand({
                type: "setBodyMetrics",
                fontSizePx: bodyFontSize,
                letterSpacingPx: bodyLetterSpacing,
                titleFontSizePx: titleFontSize,
              });
            }
          }}
          onError={(e) => {
            onError?.({ code: "WEBVIEW_LOAD_FAIL", message: e.nativeEvent.description || "WebView load failed" });
          }}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled={false}
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          mediaPlaybackRequiresUserAction
          scrollEnabled={scrollEnabled && !scrollLocked}
          bounces={false}
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView={Platform.OS === "ios"}
          showsVerticalScrollIndicator={false}
          contentMode="mobile"
        />
      </View>
    );
  },
);

export default WebViewMarkdownEditor;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webView: {
    flex: 1,
    backgroundColor: "transparent",
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
  },
});
