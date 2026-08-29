/**
 * WebViewMeasureLayer — PretextMeasureLayer의 WebView 기반 교체 구현체.
 *
 * PretextMeasureLayer는 React Native(Yoga) 렌더러로 텍스트 높이를 측정해
 * 줄넘김이 WebView 읽기/편집 화면과 미세하게 달랐다.
 * 이 컴포넌트는 동일한 HTML/CSS/폰트를 쓰는 숨겨진 WebView에서 측정하므로
 * 읽기 화면(WebViewMarkdownReader)과 완전히 동일한 페이지 경계를 보장한다.
 *
 * 외부 API는 PretextMeasureLayer와 동일:
 *   props: {
 *     request: MeasureRequest | null;
 *     onMeasured: (heights: Record<string, number>, request: MeasureRequest) => void;
 *   }
 *
 * 측정 흐름:
 *   1. 네 폰트 데이터 준비 후 WebView 마운트 → 내부 디코딩 완료 신호 → bridge.markReady()
 *   2. request props 변경 → candidates를 HTML 아이템으로 변환 → bridge.request("measure", ...)
 *   3. WebView JS('measure' 핸들러): 블록별 getBoundingClientRect().height + blockGap →
 *      Promise<heights>를 반환하면 공통 브릿지가 __rpcResponse 로 회신
 *   4. RN 측 bridge.request 가 Promise<heights> 로 resolve → onMeasured(heights)
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
 *   0×0 overflow:hidden 래퍼 View 안에 고정 크기 WebView를 배치한다.
 *   left:-9999 같은 음수 오프셋 방식은 iOS에서 예기치 않은 터치 영역이
 *   생기거나 레이아웃에 영향을 줄 수 있어 래퍼 클리핑 방식을 사용한다.
 */
import React, { useRef, useCallback, useEffect, useMemo, useState } from "react";
import { View, StyleSheet, PixelRatio } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { getMeasureHtml } from "./measureHtml";
import { areEditorFontsReady, getEditorFonts, subscribeEditorFonts, type EditorFontState } from "@/lib/editorFontStore";
import { blockToHtml, markdownToHtml } from "@/lib/markdownRenderer";
import type { MeasureRequest } from "../PretextMeasureLayer/PretextMeasureLayer";
import {
  flushWebViewPerf,
  isWebViewPerfEnabled,
  recordWebViewBoot,
} from "@/lib/webviewPerf";
import { createWebViewBridge, type WebViewBridge } from "@/lib/webViewBridge";
import { logBodyTypographyDiagnostic } from "@/lib/bodyTypographyDiagnostics";
import {
  getNativeBodyFontMode,
  reportNativeBodyFontReady,
  subscribeNativeBodyFontMode,
} from "@/lib/nativeBodyFontMode";

interface Props {
  request: MeasureRequest | null;
  onMeasured: (heights: Record<string, number>, request: MeasureRequest) => void;
}

export default function WebViewMeasureLayer({ request, onMeasured }: Props) {
  const webViewRef = useRef<WebView>(null);
  const mountedAtRef = useRef<number>(Date.now());
  const bootRecordedRef = useRef(false);
  const pendingRef = useRef<MeasureRequest | null>(null);
  const prevRequestRef = useRef<MeasureRequest | null>(null);
  const requestRef = useRef<MeasureRequest | null>(request);
  const bodyFontsReadyRef = useRef(false);
  requestRef.current = request;
  const onMeasuredRef = useRef(onMeasured);
  onMeasuredRef.current = onMeasured;

  const bridgeRef = useRef<WebViewBridge | null>(null);
  if (bridgeRef.current == null) {
    bridgeRef.current = createWebViewBridge({ webViewRef, category: "measure" });
  }
  const bridge = bridgeRef.current;

  const [fonts, setFonts] = useState<EditorFontState>(() => getEditorFonts());
  useEffect(() => {
    const unsub = subscribeEditorFonts((next) => setFonts(next));
    setFonts(getEditorFonts());
    return unsub;
  }, []);

  // WebViewMarkdownReader와 동일하게 Eulyoo/Noto의 두 웨이트가 모두 준비될 때까지 렌더링을 지연한다.
  // 준비 전에 렌더링하면 시스템 serif 폰트로 한국어 높이를 측정해 오버플로 오탐이 발생한다.
  const canRender = areEditorFontsReady(fonts) || !!fonts.error;

  // Base64 strings are large, so rebuild only when the actual font configuration
  // changes. A real change intentionally reloads the WebView and clears the
  // previous request below so measurements from older metrics are not reused.
  const html = useMemo(
    () =>
      canRender
        ? getMeasureHtml({
            regularBase64: fonts.regularBase64,
            semiBoldBase64: fonts.semiBoldBase64,
            notoRegularBase64: fonts.notoRegularBase64,
            notoSemiBoldBase64: fonts.notoSemiBoldBase64,
            perfEnabled: isWebViewPerfEnabled(),
          })
        : "",
    [
      canRender,
      fonts.regularBase64,
      fonts.semiBoldBase64,
      fonts.notoRegularBase64,
      fonts.notoSemiBoldBase64,
    ],
  );

  // 컴포넌트가 unmount 될 때 누적된 측정 지표를 콘솔에 요약 출력한다.
  useEffect(() => {
    return () => {
      flushWebViewPerf("measure");
      bridge.reset("WebViewMeasureLayer unmount");
    };
  }, [bridge]);

  // html이 바뀌면 WebView가 리로드되므로 bridge ready 상태를 동기적으로 초기화한다.
  // 폰트 구성이 바뀐 경우 같은 request 객체도 새 메트릭으로 다시 측정한다.
  const prevHtmlRef = useRef(html);
  if (html !== prevHtmlRef.current) {
    prevHtmlRef.current = html;
    bodyFontsReadyRef.current = false;
    prevRequestRef.current = null;
    pendingRef.current = requestRef.current;
    bridge.reset("WebViewMeasureLayer html changed");
  }

  // 측정 요청은 last-write-wins로 처리한다. 짧은 간격으로 여러 요청이 들어오면
  // 가장 최근 요청에 대한 응답만 사용하고, 직전 in-flight 결과는 stale 로 간주해 버린다.
  // bridge.request 가 발급하는 requestId 와는 별도로, sequence 카운터로 stale 판단을 한다.
  const latestSeqRef = useRef(0);

  const sendMeasure = useCallback((req: MeasureRequest) => {
    const blockGap = req.blockGap ?? req.typography.lineHeightPx * 0.6;
    const items = req.candidates.map((c) => ({
      key: c.key,
      html: c.blocks
        ? c.blocks.map(blockToHtml).join("")
        : markdownToHtml(c.content ?? "", PixelRatio.get()),
    }));
    const seq = ++latestSeqRef.current;
    bridge
      .request<Record<string, number>>("measure", {
        metrics: req.typography,
        blockGap,
        items,
      })
      .then((heights) => {
        // stale: 새로운 측정이 그 사이 발급되었으면 결과를 버린다.
        if (seq !== latestSeqRef.current) return;
        onMeasuredRef.current(heights ?? {}, req);
      })
      .catch(() => {
        // bridge.reset() 으로 reject 되거나 WebView 가 사라진 경우 — 조용히 무시.
      });
  }, [bridge]);

  useEffect(() => {
    if (!request) {
      pendingRef.current = null;
      prevRequestRef.current = null;
      latestSeqRef.current += 1;
      return;
    }

    if (!canRender) {
      // 폰트 준비 전: pendingRef에만 보관하고 prevRequestRef는 건드리지 않는다.
      // canRender가 true가 되면 이 effect가 다시 실행되어 정상 경로로 처리된다.
      pendingRef.current = request;
      return;
    }

    if (request === prevRequestRef.current) return;
    prevRequestRef.current = request;

    if (request.candidates.length === 0) {
      onMeasuredRef.current({}, request);
      return;
    }
    if (!bridge.isReady()) {
      pendingRef.current = request;
      return;
    }
    sendMeasure(request);
  }, [request, sendMeasure, canRender, bridge]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    bridge.handleMessage(event, (data) => {
      if (data.type === "onBodyTypographyDiagnostic") {
        logBodyTypographyDiagnostic(
          "measure",
          (data as { payload: Parameters<typeof logBodyTypographyDiagnostic>[1] }).payload,
        );
        return;
      }
      if (data.type !== "onBodyFontsReady" || bodyFontsReadyRef.current) return;
      reportNativeBodyFontReady(
        (data as { type: "onBodyFontsReady"; ok?: boolean }).ok === true,
      );
      bodyFontsReadyRef.current = true;
      bridge.markReady();
      if (getNativeBodyFontMode() === "fallback") {
        bridge.injectRaw(
          `document.documentElement.style.setProperty("--body-regular-font-family","serif");` +
          `document.documentElement.style.setProperty("--body-semibold-font-family","serif");true;`,
        );
      }
      if (!bootRecordedRef.current) {
        bootRecordedRef.current = true;
        recordWebViewBoot("measure", mountedAtRef.current);
      }
      const toSend = pendingRef.current ?? requestRef.current;
      pendingRef.current = null;
      if (toSend && toSend.candidates.length > 0) sendMeasure(toSend);
    });
  }, [bridge, sendMeasure]);

  useEffect(() => subscribeNativeBodyFontMode((mode) => {
    if (mode !== "fallback" || !bridge.isReady()) return;
    bridge.injectRaw(
      `document.documentElement.style.setProperty("--body-regular-font-family","serif");` +
      `document.documentElement.style.setProperty("--body-semibold-font-family","serif");true;`,
    );
  }), [bridge]);

  if (!canRender) return null;

  return (
    <View style={styles.wrapper} pointerEvents="none">
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={styles.webView}
        onMessage={handleMessage}
        onLoad={() => {
          // Measurement requests remain queued until onBodyFontsReady.
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
        textZoom={100}
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
