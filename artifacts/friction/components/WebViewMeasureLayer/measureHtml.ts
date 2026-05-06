/**
 * WebViewMeasureLayer가 사용하는 HTML 템플릿.
 *
 * readerHtml.ts와 동일한 폰트/타이포그래피를 사용하되
 * 모든 블록 요소의 margin을 0으로 초기화한다.
 * blockGap은 JS 측에서 getBoundingClientRect().height에 더해
 * PretextMeasureLayer의 (측정 높이 + marginBottom) 계약을 재현한다.
 *
 * 폰트가 없는 초기 로딩 상태에서도 WebView 자체는 마운트되어 있어야 하므로
 * fontFaceCSS가 비어 있으면 시스템 serif로 fallback한다.
 */
import { buildBodyTypographyCss } from "@/components/shared/bodyTypographyCss";
import { buildWebViewPerfHeadScript } from "@/lib/webviewPerf";

export interface MeasureFontOptions {
  regularBase64?: string | null;
  semiBoldBase64?: string | null;
  perfEnabled?: boolean;
}

// 본문 타이포그래피는 편집기/리더와 동일한 모듈에서 받는다.
// 측정 레이어는 블록 마진을 0으로 두고 blockGap을 외부에서 더하므로 blockMargins "zero",
// hr은 1px 높이 + 마진 0(measure 모드)으로 받는다.
const bodyTypographyCss = buildBodyTypographyCss({
  rootSelector: ".mb",
  blockSelector: ".mb",
  blockMargins: "zero",
  hrStyle: "measure",
});

export function getMeasureHtml(opts: MeasureFontOptions = {}): string {
  const { regularBase64, semiBoldBase64 } = opts;
  const fontFaceCSS =
    regularBase64 && semiBoldBase64
      ? `@font-face{font-family:'Eulyoo1945-Regular';src:url('data:font/woff2;base64,${regularBase64}') format('woff2');font-weight:400;font-style:normal}@font-face{font-family:'Eulyoo1945-SemiBold';src:url('data:font/woff2;base64,${semiBoldBase64}') format('woff2');font-weight:600;font-style:normal}`
      : "";
  const perfHeadScript = buildWebViewPerfHeadScript(!!opts.perfEnabled);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
${perfHeadScript}
<style>${fontFaceCSS}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;overflow:hidden;visibility:hidden}
${bodyTypographyCss}
.mb{position:absolute;left:0;top:0}
</style>
</head>
<body>
<script>
"use strict";
(function(){
function postToRN(ev){
  try{var rn=window.ReactNativeWebView;if(rn)rn.postMessage(JSON.stringify(ev))}catch(e){}
}

window.handleCommand=function(cmd){
try{
if(cmd.type==="measure"){
  var root=document.documentElement;
  if(cmd.fontSizePx!=null)root.style.setProperty("--body-font-size",cmd.fontSizePx+"px");
  if(cmd.letterSpacingPx!=null)root.style.setProperty("--body-letter-spacing",cmd.letterSpacingPx+"px");
  var w=cmd.containerWidth||300;
  var gap=cmd.blockGap||0;
  var items=cmd.items||[];
  var wrap=document.createElement("div");
  wrap.style.cssText="position:absolute;left:0;top:0;pointer-events:none;";
  document.body.appendChild(wrap);
  var els=items.map(function(item){
    var el=document.createElement("div");
    el.className="mb";
    el.style.width=w+"px";
    el.innerHTML=item.html;
    wrap.appendChild(el);
    return{key:item.key,el:el};
  });
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      var heights={};
      els.forEach(function(b){
        heights[b.key]=b.el.getBoundingClientRect().height+gap;
      });
      if(wrap.parentNode)wrap.parentNode.removeChild(wrap);
      postToRN({type:"onMeasured",heights:heights});
    });
  });
}
}catch(e){postToRN({type:"onMeasureError",error:String(e)})}
};
})();
</script>
</body>
</html>`;
}
