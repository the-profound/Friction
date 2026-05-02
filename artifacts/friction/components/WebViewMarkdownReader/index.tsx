import React from "react";
import { Platform } from "react-native";
import type { WebViewMarkdownReaderProps } from "./WebViewMarkdownReader";

let WebComponent: React.ComponentType<WebViewMarkdownReaderProps>;
let NativeComponent: React.ComponentType<WebViewMarkdownReaderProps>;

if (Platform.OS === "web") {
  WebComponent = require("./WebViewMarkdownReaderWeb").default;
} else {
  NativeComponent = require("./WebViewMarkdownReader").default;
}

export default function WebViewMarkdownReaderCompat(props: WebViewMarkdownReaderProps) {
  if (Platform.OS === "web") {
    return <WebComponent {...props} />;
  }
  return <NativeComponent {...props} />;
}

export type { WebViewMarkdownReaderProps };
