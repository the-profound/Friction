import { buildBodyTypographyCss } from "@/components/shared/bodyTypographyCss";
import { buildWebViewPerfHeadScript } from "@/lib/webviewPerf";
import { buildWebViewBridgeHeadScript } from "@/lib/webViewBridgeShim";
import {
  buildBodyFontReadyScript,
  buildEmbeddedBodyFontFaceCss,
  hasEmbeddedBodyFonts,
  type EmbeddedBodyFontOptions,
} from "@/components/shared/bodyTypographyFonts";

export interface ReaderFontOptions extends EmbeddedBodyFontOptions {
  perfEnabled?: boolean;
}

// 본문 타이포그래피는 편집기/측정 레이어와 동일한 모듈에서 받는다.
// 리더는 페이지 사이를 hr이 시각적으로 갈라주므로 hrStyle은 "spaced",
// 밑줄은 0.2em 떨어뜨려 가독성을 높인다.
const bodyTypographyCss = buildBodyTypographyCss({
  rootSelector: "#reader-content",
  blockSelector: "#reader-content",
  blockMargins: "spaced",
  hrStyle: "spaced",
  readerUnderline: true,
});

export function getReaderHtml(fontOptions: ReaderFontOptions = {}): string {
  const fontFaceCSS = buildEmbeddedBodyFontFaceCss(fontOptions);
  const perfHeadScript = buildWebViewPerfHeadScript(!!fontOptions.perfEnabled);
  const bridgeHeadScript = buildWebViewBridgeHeadScript();
  const fontReadyScript = buildBodyFontReadyScript(hasEmbeddedBodyFonts(fontOptions));

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
${perfHeadScript}
${bridgeHeadScript}
<style>${fontFaceCSS}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:transparent;overflow:hidden;-webkit-user-select:text;user-select:text}
body{display:flex;align-items:flex-start;justify-content:center}
${bodyTypographyCss}
#reader-content{width:100%}
::selection{background:rgba(59,130,246,0.3)}
</style>
${fontReadyScript}
</head>
<body>
<div id="reader-content" lang="ko"></div>
<script>
"use strict";
(function(){
var bridge=window.__rnBridge;
var post=bridge.post;
var el=document.getElementById("reader-content");

var hasActiveSelection=false;
var debounceTimer=null;
document.addEventListener("selectionchange",function(){
var sel=window.getSelection();
hasActiveSelection=!!(sel&&sel.rangeCount>0&&!sel.isCollapsed);
if(debounceTimer)clearTimeout(debounceTimer);
debounceTimer=setTimeout(function(){
var sel=window.getSelection();
var t=sel?sel.toString().trim():"";
post({type:"onTextSelect",text:t,isEmpty:!t});
},80);
});

var dragStartX=0,dragStartY=0,isDragging=false,touchStartTime=0;
var DRAG_THRESHOLD=6;
var LONG_PRESS_MS=300;
document.addEventListener("touchstart",function(e){
var t=e.touches[0];
if(t){dragStartX=t.clientX;dragStartY=t.clientY;}
touchStartTime=Date.now();
isDragging=false;
},{passive:true});
document.addEventListener("touchmove",function(e){
if(isDragging)return;
var t=e.touches[0];
if(!t)return;
var dx=t.clientX-dragStartX;
var dy=t.clientY-dragStartY;
if(Math.sqrt(dx*dx+dy*dy)<=DRAG_THRESHOLD)return;
var isLongPressLike=(Date.now()-touchStartTime)>=LONG_PRESS_MS||hasActiveSelection;
if(!isLongPressLike)return;
isDragging=true;
post({type:"onDragStart"});
},{passive:true});
document.addEventListener("touchend",function(){
if(isDragging){isDragging=false;post({type:"onDragEnd"});}
},{passive:true});
document.addEventListener("touchcancel",function(){
if(isDragging){isDragging=false;post({type:"onDragEnd"});}
},{passive:true});

var didReady=false;
bridge.register("setContent",function(cmd){
if(el)el.innerHTML=cmd.html||"";
if(!didReady){didReady=true;post({type:"onReady"});}
post({type:"onContentReady",version:cmd.version});
});
bridge.register("setBodyMetrics",function(cmd){
 var m=cmd.metrics;if(!m)return;
 document.documentElement.style.setProperty("--body-font-size",m.fontSizePx+"px");
 document.documentElement.style.setProperty("--body-line-height",m.lineHeightPx+"px");
 document.documentElement.style.setProperty("--body-paragraph-gap",m.paragraphGapPx+"px");
 document.documentElement.style.setProperty("--body-letter-spacing",m.letterSpacingPx+"px");
 document.documentElement.style.setProperty("--title-font-size",m.titleFontSizePx+"px");
 requestAnimationFrame(function(){
 var cs=getComputedStyle(el),fonts=document.fonts;
 post({type:"onBodyTypographyDiagnostic",payload:{
 domWidthPx:el.getBoundingClientRect().width,
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
 }}});});
});
bridge.register("clearSelection",function(){
var sel=window.getSelection();if(sel)sel.removeAllRanges();
post({type:"onTextSelect",text:"",isEmpty:true});
});
bridge.installDispatcher();
})();
</script>
</body>
</html>`;
}
