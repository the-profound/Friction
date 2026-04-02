import React, { forwardRef } from "react";
import { Platform } from "react-native";
import type { WebViewMarkdownEditorProps, WebViewMarkdownEditorRef } from "./types";

let WebComponent: React.ForwardRefExoticComponent<
  WebViewMarkdownEditorProps & React.RefAttributes<WebViewMarkdownEditorRef>
>;
let NativeComponent: React.ForwardRefExoticComponent<
  WebViewMarkdownEditorProps & React.RefAttributes<WebViewMarkdownEditorRef>
>;

if (Platform.OS === "web") {
  WebComponent = require("./WebViewMarkdownEditorWeb").default;
} else {
  NativeComponent = require("./WebViewMarkdownEditor").default;
}

const WebViewMarkdownEditorCompat = forwardRef<WebViewMarkdownEditorRef, WebViewMarkdownEditorProps>(
  function WebViewMarkdownEditorCompat(props, ref) {
    if (Platform.OS === "web") {
      return <WebComponent ref={ref} {...props} />;
    }
    return <NativeComponent ref={ref} {...props} />;
  },
);

export default WebViewMarkdownEditorCompat;
