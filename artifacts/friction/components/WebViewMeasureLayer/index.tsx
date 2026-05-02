import React from "react";
import { Platform } from "react-native";
import type { MeasureRequest } from "../PretextMeasureLayer/PretextMeasureLayer";

interface Props {
  request: MeasureRequest | null;
  onMeasured: (heights: Record<string, number>) => void;
}

let WebComponent: React.ComponentType<Props>;
let NativeComponent: React.ComponentType<Props>;

if (Platform.OS === "web") {
  WebComponent = require("./WebViewMeasureLayerWeb").default;
} else {
  NativeComponent = require("./WebViewMeasureLayer").default;
}

export default function WebViewMeasureLayerCompat(props: Props) {
  if (Platform.OS === "web") {
    return <WebComponent {...props} />;
  }
  return <NativeComponent {...props} />;
}
