/**
 * WebViewMeasureLayer가 사용하는 HTML 템플릿.
 *
 * readerHtml.ts와 동일한 폰트/타이포그래피를 사용하되
 * 표시 렌더러와 같은 블록 margin을 그대로 적용한다. 측정 항목은
 * `flow-root` formatting context로 감싸 위/아래 margin collapse를 항목 안에
 * 가두므로 getBoundingClientRect().height가 실제 표시 높이와 일치한다.
 *
 * 폰트가 없는 초기 로딩 상태에서도 WebView 자체는 마운트되어 있어야 하므로
 * fontFaceCSS가 비어 있으면 시스템 serif로 fallback한다.
 *
 * 측정 명령은 공통 RPC 브릿지의 request() 채널을 사용한다 — 'measure' 핸들러가
 * heights 객체를 Promise 로 반환하면 브릿지가 자동으로 __rpcResponse 를 회신한다.
 */
import { buildBodyTypographyCss } from "@/components/shared/bodyTypographyCss";
import { buildWebViewPerfHeadScript } from "@/lib/webviewPerf";
import { buildWebViewBridgeHeadScript } from "@/lib/webViewBridgeShim";
import {
  buildBodyFontReadyScript,
  buildEmbeddedBodyFontFaceCss,
  hasEmbeddedBodyFonts,
  type EmbeddedBodyFontOptions,
} from "@/components/shared/bodyTypographyFonts";

export interface MeasureFontOptions extends EmbeddedBodyFontOptions {
  perfEnabled?: boolean;
}

// 본문 타이포그래피는 편집기/리더와 동일한 모듈에서 받는다.
// 측정도 리더와 같은 블록 간격/구분선 간격을 사용해야 혼합 본문의 페이지
// 경계가 화면 전환 중 달라지지 않는다.
const bodyTypographyCss = buildBodyTypographyCss({
  rootSelector: ".mb",
  blockSelector: ".mb",
  blockMargins: "spaced",
  hrStyle: "spaced",
});

export function getMeasureHtml(opts: MeasureFontOptions = {}): string {
  const fontFaceCSS = buildEmbeddedBodyFontFaceCss(opts);
  const perfHeadScript = buildWebViewPerfHeadScript(!!opts.perfEnabled);
  const bridgeHeadScript = buildWebViewBridgeHeadScript();
  const fontReadyScript = buildBodyFontReadyScript(hasEmbeddedBodyFonts(opts));

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
${perfHeadScript}
${bridgeHeadScript}
<style>${fontFaceCSS}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;overflow:hidden;visibility:hidden}
${bodyTypographyCss}
.mb{position:absolute;left:0;top:0;display:flow-root}
</style>
${fontReadyScript}
</head>
<body>
<script>
"use strict";
(function(){
var bridge=window.__rnBridge;
bridge.register("measure",function(cmd){
var root=document.documentElement;
 var m=cmd.metrics;if(!m)throw new Error("Typography metrics required");
 root.style.setProperty("--body-font-size",m.fontSizePx+"px");
 root.style.setProperty("--body-line-height",m.lineHeightPx+"px");
 root.style.setProperty("--body-paragraph-gap",m.paragraphGapPx+"px");
 root.style.setProperty("--body-letter-spacing",m.letterSpacingPx+"px");
 root.style.setProperty("--title-font-size",m.titleFontSizePx+"px");
 var w=m.textColumnWidth;
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
return new Promise(function(resolve){
requestAnimationFrame(function(){
requestAnimationFrame(function(){
var heights={};
els.forEach(function(b){
heights[b.key]=b.el.getBoundingClientRect().height;
});
 var probe=els[0]&&els[0].el,cs=probe&&getComputedStyle(probe),fonts=document.fonts;
 if(probe&&cs)bridge.post({type:"onBodyTypographyDiagnostic",payload:{
 domWidthPx:probe.getBoundingClientRect().width,
 fontSizePx:parseFloat(cs.fontSize),
 lineHeightPx:parseFloat(cs.lineHeight),
 letterSpacingPx:parseFloat(cs.letterSpacing),
 textSizeAdjust:cs.textSizeAdjust||cs.webkitTextSizeAdjust||"unknown",
 devicePixelRatio:window.devicePixelRatio||1,
 configuredTextZoomPercent:m.textScalePercent,
 effectiveFontScaleRatio:parseFloat(cs.fontSize)/m.fontSizePx,
 fontFamily:cs.fontFamily,
 fonts:{
 eulyooRegular:!!(fonts&&fonts.check("400 16px 'Eulyoo1945-Regular'","가잓")),
 eulyooSemiBold:!!(fonts&&fonts.check("600 16px 'Eulyoo1945-SemiBold'","가잓")),
 notoRegular:!!(fonts&&fonts.check("400 16px 'NotoSerifKR_400Regular'","가잓")),
 notoSemiBold:!!(fonts&&fonts.check("600 16px 'NotoSerifKR_600SemiBold'","가잓"))
 }}});
if(wrap.parentNode)wrap.parentNode.removeChild(wrap);
resolve(heights);
});
});
});
});
bridge.installDispatcher();
})();
</script>
</body>
</html>`;
}
