import React, { useRef, useCallback, useImperativeHandle, forwardRef, useEffect } from "react";
import { StyleSheet, Platform } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { getEditorHtml, EDITOR_CONFIG_VERSION } from "./editorHtml";
import type {
  WebViewMarkdownEditorProps,
  WebViewMarkdownEditorRef,
  RNToWebViewCommand,
  WebViewToRNEvent,
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
          }
        } catch {
          onError?.({ code: "MESSAGE_PARSE_FAIL", message: "Failed to parse WebView message" });
        }
      },
      [flushQueue, onReady, onChange, onExportMarkdown, onTitleChange, onError],
    );

    useEffect(() => {
      if (readyRef.current) {
        sendCommand({ type: "setEditable", isEditable: editable });
      }
    }, [editable, sendCommand]);

    const html = getEditorHtml();

    return (
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
    );
  },
);

export default WebViewMarkdownEditor;

const styles = StyleSheet.create({
  webView: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
