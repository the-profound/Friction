import React, { useRef, useCallback, useImperativeHandle, forwardRef, useEffect, useState, useMemo } from "react";
import { View, StyleSheet, Platform, Keyboard, ActivityIndicator } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { getEditorHtml, EDITOR_CONFIG_VERSION } from "./editorHtml";
import { getEditorFonts, subscribeEditorFonts, consumeEditorFontsErrorToast, type EditorFontState } from "@/lib/editorFontStore";
import { useToast } from "@/contexts/ToastContext";
import type {
  WebViewMarkdownEditorProps,
  WebViewMarkdownEditorRef,
  RNToWebViewCommand,
  WebViewToRNEvent,
  OnSelectionUpdatePayload,
} from "./types";

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
      sourceArticleSlotText,
      onSourceArticleSlotTap,
      bodyFontSize,
      bodyLetterSpacing,
      bodyPaddingX,
    },
    ref,
  ) {
    const webViewRef = useRef<WebView>(null);
    const readyRef = useRef(false);
    const queueRef = useRef<RNToWebViewCommand[]>([]);

    const sendCommand = useCallback((cmd: RNToWebViewCommand) => {
      if (!readyRef.current) {
        queueRef.current.push(cmd);
        return;
      }
      const js = `(function(){try{handleCommand(${JSON.stringify(cmd)})}catch(e){}})();true;`;
      webViewRef.current?.injectJavaScript(js);
    }, []);

    const flushQueue = useCallback(() => {
      const pending = queueRef.current.splice(0);
      for (const cmd of pending) {
        sendCommand(cmd);
      }
    }, [sendCommand]);

    useImperativeHandle(ref, () => ({
      setMarkdown(markdown: string) {
        sendCommand({ type: "setMarkdown", markdown });
      },
      requestExportMarkdown(requestId: string) {
        sendCommand({ type: "requestExportMarkdown", requestId });
      },
      setEditable(isEditable: boolean) {
        sendCommand({ type: "setEditable", isEditable });
      },
      setTitle(title: string) {
        sendCommand({ type: "setTitle", title });
      },
      blur() {
        const js = `(function(){try{if(document.activeElement){document.activeElement.blur();}}catch(e){}})();true;`;
        webViewRef.current?.injectJavaScript(js);
      },
      setOverflowRanges(ranges) {
        sendCommand({ type: "setOverflowRanges", ranges });
      },
      setOverflowProbeConfig(availableContentHeightPx) {
        sendCommand({ type: "setOverflowProbeConfig", availableContentHeightPx });
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
    }), [sendCommand]);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        try {
          const data: WebViewToRNEvent = JSON.parse(event.nativeEvent.data);
          switch (data.type) {
            case "onReady":
              flushQueue();
              onReady?.();
              break;
            case "onChange":
              onChange?.(data.payload);
              break;
            case "onExportMarkdown":
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
              const blurJs = `(function(){try{if(document.activeElement){document.activeElement.blur();}}catch(e){}})();true;`;
              webViewRef.current?.injectJavaScript(blurJs);
              Keyboard.dismiss();
              break;
            }
            case "onSourceArticleSlotTap":
              onSourceArticleSlotTap?.();
              break;
            case "onSelectionUpdate":
              onSelectionUpdate?.(data.payload);
              break;
          }
        } catch {
          onError?.({ code: "MESSAGE_PARSE_FAIL", message: "Failed to parse WebView message" });
        }
      },
      [flushQueue, onReady, onChange, onExportMarkdown, onTitleChange, onError, onKeyboardVisibilityChange, onSelectionUpdate, onSourceArticleSlotTap],
    );

    useEffect(() => {
      if (readyRef.current) {
        sendCommand({ type: "setEditable", isEditable: editable });
      }
    }, [editable, sendCommand]);

    useEffect(() => {
      if (readyRef.current && bodyFontSize != null && bodyLetterSpacing != null) {
        sendCommand({ type: "setBodyMetrics", fontSizePx: bodyFontSize, letterSpacingPx: bodyLetterSpacing });
      }
    }, [bodyFontSize, bodyLetterSpacing, sendCommand]);

    useEffect(() => {
      if (readyRef.current && bodyPaddingX != null) {
        const px = `${bodyPaddingX}px`;
        webViewRef.current?.injectJavaScript(
          `(function(){try{document.body.style.paddingLeft='${px}';document.body.style.paddingRight='${px}';}catch(e){}})();true;`,
        );
      }
    }, [bodyPaddingX]);

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
      () => getEditorHtml({ regularBase64: fonts.regularBase64, semiBoldBase64: fonts.semiBoldBase64 }),
      [fonts.regularBase64, fonts.semiBoldBase64],
    );

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
            readyRef.current = true;
            sendCommand({
              type: "init",
              payload: { initialMarkdown, editorConfigVersion, placeholder, titleValue },
            });
            if (bodyFontSize != null && bodyLetterSpacing != null) {
              sendCommand({ type: "setBodyMetrics", fontSizePx: bodyFontSize, letterSpacingPx: bodyLetterSpacing });
            }
            if (bodyPaddingX != null) {
              const px = `${bodyPaddingX}px`;
              webViewRef.current?.injectJavaScript(
                `(function(){try{document.body.style.paddingLeft='${px}';document.body.style.paddingRight='${px}';}catch(e){}})();true;`,
              );
            }
            flushQueue();
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
          scrollEnabled
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
