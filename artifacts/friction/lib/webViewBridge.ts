/**
 * 공통 WebView ↔ RN RPC 메시지 레이어.
 *
 * 3개 WebView (편집기 / 읽기 / 측정) 가 동일한 API 로 메시지를 주고받기 위해
 * 분산된 sendCommand / queueRef / handleMessage 로직을 한 곳에 모은 헬퍼.
 *
 * 제공하는 것:
 *   - send(cmd)                    : fire-and-forget. ready 전이면 큐잉.
 *   - request(method, params)      : requestId 기반 round-trip. Promise<result>.
 *   - injectRaw(js)                : 임의 JS 주입 (e.g., 강제 blur).
 *   - markReady() / reset()        : ready 게이트와 큐 초기화.
 *   - handleMessage(event, onEvent): perf ack + __rpcResponse 처리 후 일반 이벤트 디스패치.
 *
 * WebView 측은 webViewBridgeShim.ts 가 주입하는 window.__rnBridge.respond(requestId, result)
 * (또는 등록된 핸들러의 반환값) 으로 응답한다.
 */
import type { RefObject } from "react";
import type { WebView, WebViewMessageEvent } from "react-native-webview";
import {
  attachPerf,
  handlePerfMessage,
  type WebViewPerfCategory,
} from "./webviewPerf";

export type WebViewCommand = { type: string } & Record<string, unknown>;

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface CreateWebViewBridgeOptions {
  webViewRef: RefObject<WebView | null>;
  category: WebViewPerfCategory;
  /** request() 의 기본 타임아웃 (ms). 0 또는 미지정이면 타임아웃 없음. */
  defaultRequestTimeoutMs?: number;
}

export interface WebViewBridge {
  send: (cmd: WebViewCommand) => void;
  request: <R = unknown>(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ) => Promise<R>;
  injectRaw: (js: string) => void;
  markReady: () => void;
  /** WebView 가 리로드되거나 unmount 될 때 큐/대기중 promise 를 정리한다. */
  reset: (reason?: string) => void;
  isReady: () => boolean;
  handleMessage: (
    event: WebViewMessageEvent,
    onEvent: (data: { type?: string } & Record<string, unknown>) => void,
  ) => void;
}

let reqCounter = 0;

export function createWebViewBridge(
  opts: CreateWebViewBridgeOptions,
): WebViewBridge {
  const { webViewRef, category, defaultRequestTimeoutMs = 0 } = opts;
  const queue: WebViewCommand[] = [];
  const pending = new Map<string, PendingRequest>();
  let ready = false;

  function inject(cmd: WebViewCommand): void {
    const wrapped = attachPerf(category, cmd);
    const js = `(function(){try{handleCommand(${JSON.stringify(wrapped)})}catch(e){}})();true;`;
    webViewRef.current?.injectJavaScript(js);
  }

  function send(cmd: WebViewCommand): void {
    if (!ready) {
      queue.push(cmd);
      return;
    }
    inject(cmd);
  }

  function request<R = unknown>(
    method: string,
    params?: Record<string, unknown>,
    o?: { timeoutMs?: number },
  ): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      reqCounter = (reqCounter + 1) >>> 0;
      const requestId = `q${Date.now().toString(36)}_${reqCounter.toString(36)}`;
      const cmd: WebViewCommand = { ...(params || {}), type: method, requestId };
      const timeoutMs = o?.timeoutMs ?? defaultRequestTimeoutMs;
      const entry: PendingRequest = {
        resolve: (v) => resolve(v as R),
        reject,
      };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          if (pending.has(requestId)) {
            pending.delete(requestId);
            reject(
              new Error(
                `webViewBridge.request("${method}") timed out after ${timeoutMs}ms`,
              ),
            );
          }
        }, timeoutMs);
      }
      pending.set(requestId, entry);
      send(cmd);
    });
  }

  function injectRaw(js: string): void {
    webViewRef.current?.injectJavaScript(js);
  }

  function markReady(): void {
    if (ready) return;
    ready = true;
    const drained = queue.splice(0);
    for (const cmd of drained) inject(cmd);
  }

  function reset(reason?: string): void {
    ready = false;
    queue.length = 0;
    if (pending.size > 0) {
      const err = new Error(reason || "webViewBridge.reset()");
      for (const [, entry] of pending) {
        if (entry.timer) clearTimeout(entry.timer);
        try {
          entry.reject(err);
        } catch {
          // swallow — listener errors must not break cleanup.
        }
      }
      pending.clear();
    }
  }

  function handleMessage(
    event: WebViewMessageEvent,
    onEvent: (data: { type?: string } & Record<string, unknown>) => void,
  ): void {
    let raw: string;
    let data: { type?: string } & Record<string, unknown>;
    try {
      raw = event.nativeEvent.data;
      data = JSON.parse(raw) as typeof data;
    } catch {
      return;
    }
    if (handlePerfMessage(category, data as Parameters<typeof handlePerfMessage>[1], raw.length)) {
      return;
    }
    if (
      data &&
      data.type === "__rpcResponse" &&
      typeof (data as { requestId?: unknown }).requestId === "string"
    ) {
      const requestId = (data as { requestId: string }).requestId;
      const entry = pending.get(requestId);
      if (entry) {
        pending.delete(requestId);
        if (entry.timer) clearTimeout(entry.timer);
        const err = (data as { error?: unknown }).error;
        if (err !== undefined && err !== null) {
          entry.reject(new Error(typeof err === "string" ? err : String(err)));
        } else {
          entry.resolve((data as { result?: unknown }).result);
        }
      }
      return;
    }
    onEvent(data);
  }

  return {
    send,
    request,
    injectRaw,
    markReady,
    reset,
    isReady: () => ready,
    handleMessage,
  };
}
