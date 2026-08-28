export const BODY_REGULAR_FONT_FAMILY =
  "'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif";
export const BODY_SEMIBOLD_FONT_FAMILY =
  "'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif";

/**
 * Bump this whenever the embedded body-font files, formats, or family order
 * changes. The editor config version includes it so a font-metric change never
 * reuses initialization state produced by an older typography contract.
 */
export const BODY_FONT_CONFIG_VERSION = "eulyoo1945-noto-serif-kr-woff2-v2";
export const BODY_FONT_FALLBACK_PROBE_TEXT = "가잓";

export interface EmbeddedBodyFontOptions {
  regularBase64?: string | null;
  semiBoldBase64?: string | null;
  notoRegularBase64?: string | null;
  notoSemiBoldBase64?: string | null;
}

export function hasEmbeddedBodyFonts(opts: EmbeddedBodyFontOptions): boolean {
  return !!(
    opts.regularBase64 &&
    opts.semiBoldBase64 &&
    opts.notoRegularBase64 &&
    opts.notoSemiBoldBase64
  );
}

export function buildEmbeddedBodyFontFaceCss(opts: EmbeddedBodyFontOptions): string {
  if (!hasEmbeddedBodyFonts(opts)) return "";

  return [
    `@font-face{font-family:'Eulyoo1945-Regular';src:url('data:font/woff2;base64,${opts.regularBase64}') format('woff2');font-weight:400;font-style:normal;font-display:block}`,
    `@font-face{font-family:'Eulyoo1945-SemiBold';src:url('data:font/woff2;base64,${opts.semiBoldBase64}') format('woff2');font-weight:600;font-style:normal;font-display:block}`,
    `@font-face{font-family:'NotoSerifKR_400Regular';src:url('data:font/woff2;base64,${opts.notoRegularBase64}') format('woff2');font-weight:400;font-style:normal;font-display:block}`,
    `@font-face{font-family:'NotoSerifKR_600SemiBold';src:url('data:font/woff2;base64,${opts.notoSemiBoldBase64}') format('woff2');font-weight:600;font-style:normal;font-display:block}`,
  ].join("");
}

/**
 * WebView load does not wait for data-URI fonts to decode. This script emits a
 * single ready signal only after all four body fonts have loaded. A bounded
 * timeout deliberately resolves to the stable system-serif fallback so a bad
 * font can never leave writing or reading stuck indefinitely.
 */
export function buildBodyFontReadyScript(hasEmbeddedFonts: boolean): string {
  const embedded = hasEmbeddedFonts ? "true" : "false";
  const probe = JSON.stringify(BODY_FONT_FALLBACK_PROBE_TEXT);

  return `<script>(function(){
var settled=false;
function done(ok){if(settled)return;settled=true;window.__bodyFontsReady=Promise.resolve(!!ok);window.__rnBridge.post({type:"onBodyFontsReady",ok:!!ok});}
window.__bodyFontsReady=new Promise(function(resolve){
window.addEventListener("load",function(){
if(!${embedded}||!document.fonts||typeof document.fonts.load!=="function"){resolve(false);return;}
var timer=setTimeout(function(){resolve(false);},4000);
Promise.all([
document.fonts.load("400 16px 'Eulyoo1945-Regular'",${probe}),
document.fonts.load("600 16px 'Eulyoo1945-SemiBold'",${probe}),
document.fonts.load("400 16px 'NotoSerifKR_400Regular'",${probe}),
document.fonts.load("600 16px 'NotoSerifKR_600SemiBold'",${probe})
]).then(function(){return document.fonts.ready;}).then(function(){clearTimeout(timer);resolve(true);},function(){clearTimeout(timer);resolve(false);});
},{once:true});
});
window.__bodyFontsReady.then(done,function(){done(false);});
})();</script>`;
}