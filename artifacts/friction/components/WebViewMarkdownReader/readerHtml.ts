export interface ReaderFontOptions {
  regularBase64?: string | null;
  semiBoldBase64?: string | null;
}

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
#reader-content{
  width:100%;
  font-family:'Eulyoo1945-Regular',serif;
  font-size:var(--body-font-size,16px);
  line-height:1.8;
  letter-spacing:var(--body-letter-spacing,0.8px);
  color:#1A1A1A;
  background:transparent;
  -webkit-text-size-adjust:100%;
  text-align:justify;
  overflow-wrap:break-word;
  word-wrap:break-word;
  text-justify:inter-ideograph;
}
#reader-content p{margin-bottom:1em;text-align:justify;overflow-wrap:break-word;text-justify:inter-ideograph}
#reader-content h1{font-family:'Eulyoo1945-SemiBold',serif;font-size:1.6em;font-weight:600;letter-spacing:0.025em;margin:1em 0 0.4em;line-height:1.25;text-align:left}
#reader-content h2{font-family:'Eulyoo1945-SemiBold',serif;font-size:1.3em;font-weight:600;letter-spacing:0.025em;margin:0.8em 0 0.3em;line-height:1.3;text-align:left}
#reader-content h3{font-family:'Eulyoo1945-SemiBold',serif;font-size:1.1em;font-weight:600;letter-spacing:0.025em;margin:0.6em 0 0.3em;line-height:1.35;text-align:left}
#reader-content ul,#reader-content ol{padding-left:1.5em;margin-bottom:1em;text-align:left}
#reader-content li{margin-bottom:0.2em;text-align:left}
#reader-content li p{margin-bottom:0}
#reader-content blockquote{font-family:'Eulyoo1945-Regular',serif;font-style:italic;border-left:3px solid #d4d4d8;padding-left:1em;margin:0.5em 0;color:#52525b;text-align:left}
#reader-content hr{border:none;border-top:1px solid #e4e4e7;margin:1em 0}
#reader-content u{text-decoration:underline;text-underline-offset:0.2em}
#reader-content strong{font-family:'Eulyoo1945-SemiBold',serif;font-weight:700}
#reader-content em{font-style:italic}
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

var debounceTimer=null;
document.addEventListener("selectionchange",function(){
if(debounceTimer)clearTimeout(debounceTimer);
debounceTimer=setTimeout(function(){
var sel=window.getSelection();
var t=sel?sel.toString().trim():"";
postToRN({type:"onTextSelect",text:t,isEmpty:!t});
},80);
});

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
