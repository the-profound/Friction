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
export interface MeasureFontOptions {
  regularBase64?: string | null;
  semiBoldBase64?: string | null;
}

export function getMeasureHtml(opts: MeasureFontOptions = {}): string {
  const { regularBase64, semiBoldBase64 } = opts;
  const fontFaceCSS =
    regularBase64 && semiBoldBase64
      ? `@font-face{font-family:'Eulyoo1945-Regular';src:url('data:font/woff2;base64,${regularBase64}') format('woff2');font-weight:400;font-style:normal}@font-face{font-family:'Eulyoo1945-SemiBold';src:url('data:font/woff2;base64,${semiBoldBase64}') format('woff2');font-weight:600;font-style:normal}`
      : "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>${fontFaceCSS}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;overflow:hidden;visibility:hidden}
.mb{
  position:absolute;left:0;top:0;
  font-family:'Eulyoo1945-Regular',serif;
  font-size:var(--body-font-size,16px);
  line-height:1.8;
  letter-spacing:var(--body-letter-spacing,0.8px);
  color:#1A1A1A;
  overflow-wrap:break-word;
  word-wrap:break-word;
  text-align:justify;
  text-justify:inter-ideograph;
  -webkit-text-size-adjust:100%;
}
.mb p{margin:0;text-align:justify;overflow-wrap:break-word;text-justify:inter-ideograph}
.mb h1{font-family:'Eulyoo1945-SemiBold',serif;font-size:1.6em;font-weight:600;letter-spacing:0.025em;margin:0;line-height:1.25;text-align:left}
.mb h2{font-family:'Eulyoo1945-SemiBold',serif;font-size:1.3em;font-weight:600;letter-spacing:0.025em;margin:0;line-height:1.3;text-align:left}
.mb h3{font-family:'Eulyoo1945-SemiBold',serif;font-size:1.1em;font-weight:600;letter-spacing:0.025em;margin:0;line-height:1.35;text-align:left}
.mb ul,.mb ol{padding-left:1.5em;margin:0;text-align:left}
.mb li{margin:0;text-align:left}
.mb li p{margin:0}
.mb blockquote{font-family:'Eulyoo1945-Regular',serif;font-style:italic;border-left:3px solid #d4d4d8;padding-left:1em;margin:0;color:#52525b;text-align:left}
.mb hr{border:none;border-top:1px solid #e4e4e7;height:1px;margin:0}
.mb strong{font-family:'Eulyoo1945-SemiBold',serif;font-weight:700}
.mb em{font-style:italic}
.mb u{text-decoration:underline}
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
