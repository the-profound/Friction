/**
 * WebView ↔ RN 통신 성능 계측 유틸리티 (개발 빌드 전용).
 *
 * 무엇을 재는가:
 *  - 명령 전송 → WebView 수신까지 (RN→WV one-way): t1 - t0
 *  - WebView 처리 + 다음 paint까지 (setMarkdown/setContent 등): t2 - t1
 *  - 이벤트 발생 → RN 수신 (WV→RN): RN의 recvAt - WV의 sentAt
 *  - requestExportMarkdown round-trip: 응답 onExportMarkdown 수신 시각 - 요청 시각
 *  - WebView 콜드 부트: mount → onReady
 *  - onChange 등 이벤트 페이로드 바이트 (event.nativeEvent.data.length)
 *
 * 어떻게 동작하나:
 *  - RN 측 sendCommand 가 attachPerf() 로 명령에 `__perf:{id,t0,name,category}` 를 끼워 넣는다.
 *  - WebView 측 shim(WEBVIEW_PERF_SHIM_JS)이:
 *      · window.handleCommand 를 setter 로 가로채 wrap → t1, t2(double rAF) 측정 후
 *        `__perfAck` 메시지로 RN 에 회신.
 *      · ReactNativeWebView.postMessage 를 가로채 모든 outgoing event 에 `__perf.sentAt` 부착.
 *  - RN 측 handleMessage 가 `__perfAck`/`__perf.sentAt` 를 읽어 record() 한다.
 *
 * 가드:
 *  - __DEV__ 빌드가 아니면 모든 함수가 즉시 no-op.
 *  - EXPO_PUBLIC_WEBVIEW_PERF=0 으로 명시적으로 끌 수 있음.
 *  - 프로덕션 HTML 에는 shim 자체가 포함되지 않는다 (perfEnabled 인자 false).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DEV__: boolean | undefined;

const ENABLED: boolean =
  typeof __DEV__ !== "undefined" && !!__DEV__ && process.env.EXPO_PUBLIC_WEBVIEW_PERF !== "0";

export function isWebViewPerfEnabled(): boolean {
  return ENABLED;
}

export type WebViewPerfCategory = "editor" | "reader" | "measure";

interface PerfMeta {
  id: string;
  t0: number;
  name: string;
  category: WebViewPerfCategory;
  sentBytes: number;
}

interface SampleBucket {
  values: number[];
  unit: "ms" | "bytes";
}

const buckets = new Map<string, SampleBucket>();
const pendingCommands = new Map<string, PerfMeta>();
const pendingExports = new Map<string, { t0: number; category: WebViewPerfCategory }>();
const MAX_SAMPLES = 1000;

let seq = 0;
function nextId(): string {
  seq = (seq + 1) >>> 0;
  return `p${Date.now().toString(36)}_${seq.toString(36)}`;
}

function record(key: string, value: number, unit: "ms" | "bytes"): void {
  if (!ENABLED) return;
  let b = buckets.get(key);
  if (!b) {
    b = { values: [], unit };
    buckets.set(key, b);
  }
  b.values.push(value);
  if (b.values.length > MAX_SAMPLES) b.values.shift();
}

function summarize(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    n,
    min: sorted[0],
    median: sorted[Math.floor(n / 2)],
    p95: sorted[Math.min(n - 1, Math.floor(n * 0.95))],
    max: sorted[n - 1],
  };
}

/**
 * 명령에 __perf 메타데이터를 끼워 넣어 반환한다.
 * 반환된 객체는 그대로 JSON.stringify 해서 WebView 로 전송하면 된다.
 */
export function attachPerf<T extends { type: string }>(
  category: WebViewPerfCategory,
  cmd: T,
): T {
  if (!ENABLED) return cmd;
  const id = nextId();
  const t0 = Date.now();
  const sentBytes = (() => {
    try {
      return JSON.stringify(cmd).length;
    } catch {
      return 0;
    }
  })();
  const meta: PerfMeta = { id, t0, name: cmd.type, category, sentBytes };
  pendingCommands.set(id, meta);
  // pendingCommands 가 무한정 누적되지 않도록 가장 오래된 항목을 정리한다.
  if (pendingCommands.size > MAX_SAMPLES) {
    const firstKey = pendingCommands.keys().next().value;
    if (firstKey) pendingCommands.delete(firstKey);
  }
  return { ...cmd, __perf: { id, t0, name: cmd.type, category } } as T;
}

/** requestExportMarkdown 송신 시 호출 — onExportMarkdown 도착 시각과 비교한다. */
export function recordExportSend(category: WebViewPerfCategory, requestId: string): void {
  if (!ENABLED) return;
  pendingExports.set(`${category}:${requestId}`, { t0: Date.now(), category });
}

/** onExportMarkdown 수신 시 호출 — round-trip 시간을 기록한다. */
export function recordExportReceive(category: WebViewPerfCategory, requestId: string): void {
  if (!ENABLED) return;
  const k = `${category}:${requestId}`;
  const e = pendingExports.get(k);
  if (!e) return;
  pendingExports.delete(k);
  record(`${category}.cmd.requestExportMarkdown.roundTrip`, Date.now() - e.t0, "ms");
}

/**
 * handleMessage 안에서 매 메시지마다 호출.
 * - type === "__perfAck" 이면 명령 ack 로 처리하고 true 반환 (이벤트 디스패치 스킵).
 * - 일반 이벤트면 페이로드의 __perf.sentAt 으로 WV→RN 지연을 기록하고 false 반환.
 */
export function handlePerfMessage(
  category: WebViewPerfCategory,
  data: { type?: string; __perf?: { sentAt?: number; id?: string; name?: string; t0?: number; t1?: number; t2?: number } },
  rawByteLength: number,
): boolean {
  if (!ENABLED || !data || typeof data !== "object") return false;
  if (data.type === "__perfAck") {
    const p = data.__perf;
    if (p && typeof p.id === "string" && typeof p.t0 === "number" && typeof p.t1 === "number" && typeof p.t2 === "number" && typeof p.name === "string") {
      const meta = pendingCommands.get(p.id);
      if (meta) pendingCommands.delete(p.id);
      record(`${category}.cmd.${p.name}.rn→wv`, Math.max(0, p.t1 - p.t0), "ms");
      record(`${category}.cmd.${p.name}.process+paint`, Math.max(0, p.t2 - p.t1), "ms");
      record(`${category}.cmd.${p.name}.totalSendToPaint`, Math.max(0, p.t2 - p.t0), "ms");
      if (meta) record(`${category}.cmd.${p.name}.sentBytes`, meta.sentBytes, "bytes");
    }
    return true;
  }
  if (data.type) {
    const sentAt = data.__perf?.sentAt;
    if (typeof sentAt === "number") {
      record(`${category}.event.${data.type}.wv→rn`, Math.max(0, Date.now() - sentAt), "ms");
    }
    record(`${category}.event.${data.type}.bytes`, rawByteLength, "bytes");
  }
  return false;
}

/** WebView 마운트 → onReady 시간을 기록. mountedAt 은 컴포넌트 마운트 시점 Date.now(). */
export function recordWebViewBoot(category: WebViewPerfCategory, mountedAt: number): void {
  if (!ENABLED) return;
  record(`${category}.boot.mount→ready`, Math.max(0, Date.now() - mountedAt), "ms");
}

/** 카테고리별 누적 지표를 콘솔에 요약 출력하고 버킷을 비운다. */
export function flushWebViewPerf(category?: WebViewPerfCategory): void {
  if (!ENABLED) return;
  const keys = [...buckets.keys()]
    .filter((k) => !category || k.startsWith(`${category}.`))
    .sort();
  if (keys.length === 0) return;
  const lines: string[] = [];
  for (const k of keys) {
    const b = buckets.get(k)!;
    const s = summarize(b.values);
    if (!s) continue;
    if (b.unit === "bytes") {
      lines.push(
        `  ${k.padEnd(58)} n=${String(s.n).padStart(4)}  min=${s.min}B  median=${s.median}B  p95=${s.p95}B  max=${s.max}B`,
      );
    } else {
      lines.push(
        `  ${k.padEnd(58)} n=${String(s.n).padStart(4)}  min=${s.min.toFixed(1)}ms  median=${s.median.toFixed(1)}ms  p95=${s.p95.toFixed(1)}ms  max=${s.max.toFixed(1)}ms`,
      );
    }
    buckets.delete(k);
  }
  if (lines.length === 0) return;
  // eslint-disable-next-line no-console
  console.log(`[webviewPerf] ${category ?? "all"} summary\n${lines.join("\n")}`);
}

/**
 * WebView HTML 의 <head> 안쪽에 삽입할 스크립트.
 * - window.__WV_PERF_ENABLED 가 true 일 때만 동작.
 * - window.handleCommand 를 setter 로 가로채 wrapping (메인 스크립트가 정의하기 전에 실행).
 * - ReactNativeWebView.postMessage 를 가로채 outgoing event 에 __perf.sentAt 부착.
 */
export const WEBVIEW_PERF_SHIM_JS = `(function(){
if(!window.__WV_PERF_ENABLED)return;
var rn=window.ReactNativeWebView;
if(!rn||typeof rn.postMessage!=="function")return;
var origPost=rn.postMessage.bind(rn);
function safePost(ev){try{origPost(JSON.stringify(ev))}catch(e){}}
rn.postMessage=function(s){
try{
var obj=typeof s==="string"?JSON.parse(s):null;
if(obj&&typeof obj==="object"&&obj.type&&obj.type!=="__perfAck"){
var p=obj.__perf||{};
p.sentAt=Date.now();
obj.__perf=p;
s=JSON.stringify(obj);
}
}catch(e){}
origPost(s);
};
var _h=null;
function wrapped(cmd){
if(!_h)return;
var perf=cmd&&cmd.__perf;
if(!perf||typeof perf.id!=="string"){return _h(cmd);}
var t1=Date.now();
try{delete cmd.__perf;}catch(e){}
var ret;
try{ret=_h(cmd);}finally{
requestAnimationFrame(function(){
requestAnimationFrame(function(){
safePost({type:"__perfAck",__perf:{id:perf.id,name:perf.name,t0:perf.t0,t1:t1,t2:Date.now()}});
});
});
}
return ret;
}
Object.defineProperty(window,"handleCommand",{
configurable:true,
get:function(){return _h?wrapped:undefined;},
set:function(fn){_h=fn;}
});
})();`;

/** HTML <head> 안에 넣을 perf shim 스크립트 블록. perfEnabled=false 면 빈 문자열. */
export function buildWebViewPerfHeadScript(perfEnabled: boolean): string {
  if (!perfEnabled) return "";
  return `<script>window.__WV_PERF_ENABLED=true;${WEBVIEW_PERF_SHIM_JS}</script>`;
}
