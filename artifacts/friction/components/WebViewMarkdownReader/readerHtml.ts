import { buildBodyTypographyCss } from "@/components/shared/bodyTypographyCss";

export interface ReaderFontOptions {
  regularBase64?: string | null;
  semiBoldBase64?: string | null;
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
  const { regularBase64, semiBoldBase64 } = fontOptions;
  let fontFaceCSS = "";
  if (regularBase64 && semiBoldBase64) {
    fontFaceCSS = `@font-face{font-family:'Eulyoo1945-Regular';src:url('data:font/woff2;base64,${regularBase64}') format('woff2');font-weight:400;font-style:normal}@font-face{font-family:'Eulyoo1945-SemiBold';src:url('data:font/woff2;base64,${semiBoldBase64}') format('woff2');font-weight:600;font-style:normal}`;
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>${fontFaceCSS}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:transparent;overflow:hidden;-webkit-user-select:text;user-select:text}
body{display:flex;align-items:center;justify-content:center}
${bodyTypographyCss}
#reader-content{width:100%}
::selection{background:rgba(59,130,246,0.3)}
</style>
</head>
<body>
<div id="reader-content"></div>
<script>
"use strict";
(function(){
var el=document.getElementById("reader-content");

function postToRN(ev){
try{var rn=window.ReactNativeWebView;if(rn)rn.postMessage(JSON.stringify(ev))}catch(e){}
}

var hasActiveSelection=false;
var debounceTimer=null;
document.addEventListener("selectionchange",function(){
var sel=window.getSelection();
hasActiveSelection=!!(sel&&sel.rangeCount>0&&!sel.isCollapsed);
if(debounceTimer)clearTimeout(debounceTimer);
debounceTimer=setTimeout(function(){
var sel=window.getSelection();
var t=sel?sel.toString().trim():"";
postToRN({type:"onTextSelect",text:t,isEmpty:!t});
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
postToRN({type:"onDragStart"});
},{passive:true});
document.addEventListener("touchend",function(){
if(isDragging){isDragging=false;postToRN({type:"onDragEnd"});}
},{passive:true});
document.addEventListener("touchcancel",function(){
if(isDragging){isDragging=false;postToRN({type:"onDragEnd"});}
},{passive:true});

var didReady=false;
window.handleCommand=function(cmd){
try{
if(cmd.type==="setContent"){
if(el)el.innerHTML=cmd.html||"";
if(!didReady){didReady=true;postToRN({type:"onReady"});}
postToRN({type:"onContentReady",version:cmd.version});
}else if(cmd.type==="setBodyMetrics"){
document.documentElement.style.setProperty("--body-font-size",cmd.fontSizePx+"px");
document.documentElement.style.setProperty("--body-letter-spacing",cmd.letterSpacingPx+"px");
}else if(cmd.type==="clearSelection"){
var sel=window.getSelection();if(sel)sel.removeAllRanges();
postToRN({type:"onTextSelect",text:"",isEmpty:true});
}
}catch(e){}
};
})();
</script>
</body>
</html>`;
}
