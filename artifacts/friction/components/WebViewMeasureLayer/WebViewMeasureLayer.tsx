/**
 * WebViewMeasureLayer — PretextMeasureLayer의 WebView 기반 교체 구현체.
 *
 * PretextMeasureLayer는 React Native(Yoga) 렌더러로 텍스트 높이를 측정해
 * 줄넘김이 WebView 읽기/편집 화면과 미세하게 달랐다.
 * 이 컴포넌트는 동일한 HTML/CSS/폰트를 쓰는 숨겨진 WebView에서 측정하므로
 * 읽기 화면(WebViewMarkdownReader)과 완전히 동일한 페이지 경계를 보장한다.
 *
 * 외부 API는 PretextMeasureLayer와 동일:
 *   props: { request: MeasureRequest | null; onMeasured: (heights: Record<string, number>) => void }
 *
 * 측정 흐름:
 *   1. 폰트 로드 완료(canRender = true) 후 WebView 마운트 → onLoad → readyRef = true
 *   2. request props 변경 → candidates를 HTML 아이템으로 변환 → injectJavaScript
 *   3. WebView JS: 블록별 getBoundingClientRect().height + blockGap → postMessage
 *   4. handleMessage → onMeasured(heights)
 *
 * 폰트 대기 전략 (WebViewMarkdownReader와 동일):
 *   canRender = false 동안에는 컴포넌트가 null을 반환한다.
 *   측정 요청이 들어오면 pendingRef에 보관하고, 폰트가 준비돼 WebView가 마운트되면 전송한다.
 *   이 처리 없이 폰트 로드 전 측정하면 시스템 serif 폰트로 한국어 높이를 재게 되어
 *   실제보다 큰 값이 산출되고 잘못된 오버플로 경고가 발생한다.
 *
 * blockGap 계약:
 *   반환하는 height[key] = 블록 콘텐츠 높이 + blockGap.
 *   PretextMeasureLayer의 <View marginBottom={blockGap}> 높이와 동일하게
 *   pageDivision.ts의 cumulativeHeight 계산에 그대로 사용할 수 있다.
 *
 * 레이아웃 은폐 전략:
 *   0×0 overflow:hidden 래퍼 View 안에 500×500 WebView를 배치한다.
 *   left:-9999 같은 음수 오프셋 방식은 iOS에서 예기치 않은 터치 영역이
 *   생기거나 레이아웃에 영향을 줄 수 있어 래퍼 클리핑 방식을 사용한다.
 */
import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { getMeasureHtml } from "./measureHtml";
import { getEditorFonts, subscribeEditorFonts, type EditorFontState } from "@/lib/editorFontStore";
import { blockToHtml, markdownToHtml } from "@/lib/markdownRenderer";
import type { MeasureRequest } from "../PretextMeasureLayer/PretextMeasureLayer";
import {
  attachPerf,
  flushWebViewPerf,
  handlePerfMessage,
  isWebViewPerfEnabled,
  recordWebViewBoot,
} from "@/lib/webviewPerf";

interface Props {
  request: MeasureRequest | null;
  onMeasured: (heights: Record<string, number>) => void;
}

export default function WebViewMeasureLayer({ request, onMeasured }: Props) {
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const mountedAtRef = useRef<number>(Date.now());
  const bootRecordedRef = useRef(false);
  const pendingRef = useRef<MeasureRequest | null>(null);
  const prevRequestRef = useRef<MeasureRequest | null>(null);
  const requestRef = useRef<MeasureRequest | null>(request);
  requestRef.current = request;
  const onMeasuredRef = useRef(onMeasured);
  onMeasuredRef.current = onMeasured;

  const [fonts, setFonts] = useState<EditorFontState>(() => getEditorFonts());
  useEffect(() => {
    const unsub = subscribeEditorFonts((next) => setFonts(next));
    setFonts(getEditorFonts());
    return unsub;
  }, []);

  // WebViewMarkdownReader와 동일하게 두 폰트가 모두 준비될 때까지 렌더링을 지연한다.
  // 준비 전에 렌더링하면 시스템 serif 폰트로 한국어 높이를 측정해 오버플로 오탐이 발생한다.
  const canRender = !!(fonts.regularBase64 && fonts.semiBoldBase64) || !!fonts.error;

  const html = useMemo(
    () => getMeasureHtml({
      regularBase64: fonts.regularBase64,
      semiBoldBase64: fonts.semiBoldBase64,
      perfEnabled: isWebViewPerfEnabled(),
    }),
    [fonts.regularBase64, fonts.semiBoldBase64],
  );

  // 컴포넌트가 unmount 될 때 누적된 측정 지표를 콘솔에 요약 출력한다.
  useEffect(() => {
    return () => { flushWebViewPerf("measure"); };
  }, []);

  // html이 바뀌면 WebView가 리로드되므로 readyRef를 동기적으로 초기화한다.
  const prevHtmlRef = useRef(html);
  if (html !== prevHtmlRef.current) {
    prevHtmlRef.current = html;
    readyRef.current = false;
  }

  const sendMeasure = useCallback((req: MeasureRequest) => {
    if (!readyRef.current || !webViewRef.current) {
      pendingRef.current = req;
      return;
    }
    const containerWidth = req.textColumnWidth ?? (req.width - 2 * req.paddingX);
    const blockGap = req.blockGap ?? req.lineHeight * 0.6;
    const items = req.candidates.map((c) => ({
      key: c.key,
      html: c.blocks ? c.blocks.map(blockToHtml).join("") : markdownToHtml(c.content ?? ""),
    }));
    const cmd = attachPerf("measure", {
      type: "measure",
      containerWidth,
      fontSizePx: req.fontSize,
      letterSpacingPx: req.letterSpacing,
      blockGap,
      items,
    });
    const js = `(function(){try{handleCommand(${JSON.stringify(cmd)})}catch(e){}})();true;`;
    webViewRef.current.injectJavaScript(js);
  }, []);

  useEffect(() => {
    if (!request) return;

    if (!canRender) {
      // 폰트 준비 전: pendingRef에만 보관하고 prevRequestRef는 건드리지 않는다.
      // canRender가 true가 되면 이 effect가 다시 실행되어 정상 경로로 처리된다.
      pendingRef.current = request;
      return;
    }

    if (request === prevRequestRef.current) return;
    prevRequestRef.current = request;

    if (request.candidates.length === 0) {
      onMeasuredRef.current({});
      return;
    }
    sendMeasure(request);
  }, [request, sendMeasure, canRender]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const raw = event.nativeEvent.data;
      const data = JSON.parse(raw);
      if (handlePerfMessage("measure", data, raw.length)) {
        return;
      }
      if (data.type === "onMeasured") {
        onMeasuredRef.current(data.heights ?? {});
      }
    } catch {}
  }, []);

  if (!canRender) return null;

  return (
    <View style={styles.wrapper} pointerEvents="none">
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={styles.webView}
        onMessage={handleMessage}
        onLoad={() => {
          readyRef.current = true;
          if (!bootRecordedRef.current) {
            bootRecordedRef.current = true;
            recordWebViewBoot("measure", mountedAtRef.current);
          }
          // 리로드 후 미전송 요청이 있으면 재전송. 없으면 현재 request를 재전송한다
          // (html 변경으로 인한 리로드 직후 in-flight 측정을 복구하기 위해).
          const toSend = pendingRef.current ?? requestRef.current;
          pendingRef.current = null;
          if (toSend && toSend.candidates.length > 0) sendMeasure(toSend);
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
    </View>
  );
}

const styles = StyleSheet.create({
  // 0×0 클리핑 래퍼: 자식 WebView를 시각적으로 완전히 숨기면서
  // WebView 내부 JS 레이아웃 계산은 정상 동작하도록 한다.
  wrapper: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    overflow: "hidden",
  },
  webView: {
    width: 500,
    height: 500,
  },
});
