/**
 * WebView HTML 의 <head> 안에 삽입할 공통 RPC 브릿지 shim.
 *
 * 모든 WebView 페이지가 공유하는 작은 dispatcher.  RN 측 webViewBridge 와 짝을 이룬다.
 *
 * 제공하는 전역 (window.__rnBridge):
 *   - post(ev)                          : ReactNativeWebView.postMessage(JSON) 안전 래퍼.
 *   - respond(requestId, result, error?): __rpcResponse 메시지 송신.
 *   - register(method, fn)              : installDispatcher() 사용 시 핸들러 등록.
 *   - dispatch(cmd)                     : 등록된 핸들러로 명령을 라우팅. requestId 가 있고
 *                                         핸들러가 값/Promise 를 반환하면 자동으로 respond.
 *   - installDispatcher()               : window.handleCommand = dispatch 로 설정하고
 *                                         Android 의 document message 도 함께 청취한다.
 *
 * 편집기처럼 자체 handleCommand 를 유지하는 페이지는 installDispatcher() 를 호출하지 않고
 * post / respond 만 사용해도 된다.
 *
 * perf shim 과의 호환:
 *   webviewPerf.WEBVIEW_PERF_SHIM_JS 가 window.handleCommand 의 setter 를 가로채
 *   wrapping 하므로, 이 shim 의 installDispatcher() 가 그 setter 를 통과해도 정상 동작한다.
 *   __rnBridge.post() 도 ReactNativeWebView.postMessage 의 wrapped 버전을 그대로 거치므로
 *   __perf.sentAt 부착이 자동으로 적용된다.
 */

export const WEBVIEW_BRIDGE_SHIM_JS = `(function(){
if(window.__rnBridge)return;
function safePost(s){try{var rn=window.ReactNativeWebView;if(rn)rn.postMessage(s)}catch(e){}}
function post(ev){try{safePost(JSON.stringify(ev))}catch(e){}}
function errMsg(e){return e&&typeof e==="object"&&"message" in e?String(e.message):String(e);}
function respond(requestId,result,error){
if(!requestId)return;
if(error!==undefined&&error!==null){post({type:"__rpcResponse",requestId:requestId,error:errMsg(error)});}
else{post({type:"__rpcResponse",requestId:requestId,result:result});}
}
var handlers={};
function register(method,fn){handlers[method]=fn;}
function dispatch(cmd){
if(!cmd||typeof cmd!=="object")return;
var fn=handlers[cmd.type];
var rid=cmd.requestId;
if(!fn){if(rid)respond(rid,undefined,"unknown method: "+cmd.type);return;}
var result;var threw=false;var err;
try{result=fn(cmd);}catch(e){threw=true;err=e;}
if(threw){
if(rid)respond(rid,undefined,err);
else post({type:"onError",payload:{code:"COMMAND_FAIL",message:errMsg(err)}});
return;
}
if(result&&typeof result.then==="function"){
result.then(function(v){if(rid)respond(rid,v);},function(e){if(rid)respond(rid,undefined,e);else post({type:"onError",payload:{code:"COMMAND_FAIL",message:errMsg(e)}});});
}else if(rid){respond(rid,result);}
}
function installDispatcher(){
window.handleCommand=dispatch;
document.addEventListener("message",function(e){try{dispatch(JSON.parse(e.data));}catch(_){}});
}
window.__rnBridge={post:post,respond:respond,register:register,dispatch:dispatch,installDispatcher:installDispatcher};
})();`;

/** HTML <head> 안에 넣을 브릿지 shim 스크립트 블록. */
export function buildWebViewBridgeHeadScript(): string {
  return `<script>${WEBVIEW_BRIDGE_SHIM_JS}</script>`;
}
