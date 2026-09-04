export const BODY_REGULAR_FONT_FAMILY =
  "'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif";
export const BODY_SEMIBOLD_FONT_FAMILY =
  "'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif";
export const BODY_FALLBACK_REGULAR_FONT_FAMILY =
  "'NotoSerifKR_400Regular'";
export const BODY_FALLBACK_SEMIBOLD_FONT_FAMILY =
  "'NotoSerifKR_600SemiBold'";

export function resolveBodyFontFamilies(primaryReady: boolean): {
  regular: string;
  semibold: string;
} {
  return primaryReady
    ? {
        regular: BODY_REGULAR_FONT_FAMILY,
        semibold: BODY_SEMIBOLD_FONT_FAMILY,
      }
    : {
        regular: BODY_FALLBACK_REGULAR_FONT_FAMILY,
        semibold: BODY_FALLBACK_SEMIBOLD_FONT_FAMILY,
      };
}

/**
 * Bump this whenever the embedded body-font files, formats, or family order
 * changes. The editor config version includes it so a font-metric change never
 * reuses initialization state produced by an older typography contract.
 */
export const BODY_FONT_CONFIG_VERSION = "eulyoo1945-noto-serif-kr-global-fallback-v5";
export const BODY_FONT_PRIMARY_PROBE_TEXT = "가";
export const BODY_FONT_FALLBACK_ONLY_PROBE_TEXT = "핟";
export const BODY_FONT_FALLBACK_PROBE_TEXT = "가핟";
export const BODY_FONT_ASSET_NAMES = [
  "Eulyoo1945-Regular",
  "Eulyoo1945-SemiBold",
  "NotoSerifKR-400Regular-korean",
  "NotoSerifKR-600SemiBold-korean",
] as const;
export const BODY_FONT_ASSET_PATHS = [
  "assets/fonts/Eulyoo1945-Regular.woff2",
  "assets/fonts/Eulyoo1945-SemiBold.woff2",
  "assets/fonts/NotoSerifKR-400Regular-korean.woff2",
  "assets/fonts/NotoSerifKR-600SemiBold-korean.woff2",
] as const;
export const BODY_NATIVE_FONT_ASSET_PATHS = [
  "assets/fonts/Eulyoo1945-Regular-Body.otf",
  "assets/fonts/Eulyoo1945-SemiBold-Body.otf",
] as const;

export interface EmbeddedBodyFontOptions {
  regularBase64?: string | null;
  semiBoldBase64?: string | null;
  notoRegularBase64?: string | null;
  notoSemiBoldBase64?: string | null;
}

export interface BodyFontReadyStatus {
  ok: boolean;
  reason:
    | "verified"
    | "embedded-fonts-unavailable"
    | "font-api-unavailable"
    | "font-load-failed"
    | "glyph-verification-failed"
    | "timeout";
  loads: {
    eulyooRegular: boolean;
    eulyooSemiBold: boolean;
    notoRegular: boolean;
    notoSemiBold: boolean;
  };
  glyphs: {
    eulyooRegularPrimary: boolean;
    eulyooSemiBoldPrimary: boolean;
    notoRegularFallback: boolean;
    notoSemiBoldFallback: boolean;
  };
}

export function isVerifiedBodyFontReadyStatus(
  value: unknown,
): value is BodyFontReadyStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<BodyFontReadyStatus>;
  if (status.ok !== true || status.reason !== "verified") return false;
  const loads = status.loads as Record<string, unknown> | undefined;
  const glyphs = status.glyphs as Record<string, unknown> | undefined;
  return !!(
    loads?.eulyooRegular === true &&
    loads.eulyooSemiBold === true &&
    loads.notoRegular === true &&
    loads.notoSemiBold === true &&
    glyphs?.eulyooRegularPrimary === true &&
    glyphs.eulyooSemiBoldPrimary === true &&
    glyphs.notoRegularFallback === true &&
    glyphs.notoSemiBoldFallback === true
  );
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
  const primaryProbe = JSON.stringify(BODY_FONT_PRIMARY_PROBE_TEXT);
  const fallbackProbe = JSON.stringify(BODY_FONT_FALLBACK_ONLY_PROBE_TEXT);

  const fallbackRegular = JSON.stringify(BODY_FALLBACK_REGULAR_FONT_FAMILY);
  const fallbackSemibold = JSON.stringify(BODY_FALLBACK_SEMIBOLD_FONT_FAMILY);

  return `<script>(function(){
var settled=false;
var emptyLoads={eulyooRegular:false,eulyooSemiBold:false,notoRegular:false,notoSemiBold:false};
var emptyGlyphs={eulyooRegularPrimary:false,eulyooSemiBoldPrimary:false,notoRegularFallback:false,notoSemiBoldFallback:false};
function freezeFallback(){var s=document.documentElement&&document.documentElement.style;if(!s)return;s.setProperty("--body-regular-font-family",${fallbackRegular});s.setProperty("--body-semibold-font-family",${fallbackSemibold});}
function failure(reason,loads,glyphs){return{ok:false,reason:reason,loads:loads||emptyLoads,glyphs:glyphs||emptyGlyphs};}
function done(status){if(settled)return;settled=true;if(!status.ok)freezeFallback();window.__bodyFontsReady=Promise.resolve(status);window.__rnBridge.post({type:"onBodyFontsReady",ok:status.ok,reason:status.reason,loads:status.loads,glyphs:status.glyphs});}
function loadFace(fonts,loads,key,shorthand,text){return fonts.load(shorthand,text).then(function(faces){loads[key]=!!(faces&&faces.length);return loads[key];});}
function fingerprint(text,family,weight){
 var canvas=document.createElement("canvas");canvas.width=128;canvas.height=112;
 var context=canvas.getContext&&canvas.getContext("2d");if(!context)return null;
 context.clearRect(0,0,canvas.width,canvas.height);context.fillStyle="#000";context.textBaseline="alphabetic";
 context.font=String(weight)+" 64px "+family;context.fillText(text,12,82);
 var pixels=context.getImageData(0,0,canvas.width,canvas.height).data,hash=2166136261,ink=0;
 for(var i=3;i<pixels.length;i+=4){var alpha=pixels[i];if(alpha)ink++;hash^=alpha;hash=Math.imul(hash,16777619);}
 return{hash:hash>>>0,ink:ink,width:Math.round(context.measureText(text).width*1000)};
}
function sameFingerprint(a,b){return!!a&&!!b&&a.ink>0&&b.ink>0&&a.hash===b.hash&&a.ink===b.ink&&a.width===b.width;}
function verifyGlyphs(){
 var primary=${primaryProbe},fallback=${fallbackProbe};
 var er=fingerprint(primary,"'Eulyoo1945-Regular'",400),erc=fingerprint(primary,"'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif",400);
 var es=fingerprint(primary,"'Eulyoo1945-SemiBold'",600),esc=fingerprint(primary,"'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif",600);
 var nr=fingerprint(fallback,"'NotoSerifKR_400Regular'",400),nrc=fingerprint(fallback,"'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif",400);
 var ns=fingerprint(fallback,"'NotoSerifKR_600SemiBold'",600),nsc=fingerprint(fallback,"'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif",600);
 return{eulyooRegularPrimary:sameFingerprint(er,erc),eulyooSemiBoldPrimary:sameFingerprint(es,esc),notoRegularFallback:sameFingerprint(nr,nrc),notoSemiBoldFallback:sameFingerprint(ns,nsc)};
}
window.__bodyFontsReady=new Promise(function(resolve){
window.addEventListener("load",function(){
 if(!${embedded}){resolve(failure("embedded-fonts-unavailable"));return;}
 if(!document.fonts||typeof document.fonts.load!=="function"){resolve(failure("font-api-unavailable"));return;}
 var loads={eulyooRegular:false,eulyooSemiBold:false,notoRegular:false,notoSemiBold:false};
 var timer=setTimeout(function(){resolve(failure("timeout",loads));},4000);
 Promise.all([
 loadFace(document.fonts,loads,"eulyooRegular","400 16px 'Eulyoo1945-Regular'",${primaryProbe}),
 loadFace(document.fonts,loads,"eulyooSemiBold","600 16px 'Eulyoo1945-SemiBold'",${primaryProbe}),
 loadFace(document.fonts,loads,"notoRegular","400 16px 'NotoSerifKR_400Regular'",${fallbackProbe}),
 loadFace(document.fonts,loads,"notoSemiBold","600 16px 'NotoSerifKR_600SemiBold'",${fallbackProbe})
 ]).then(function(faceResults){return document.fonts.ready.then(function(){
   if(!faceResults.every(Boolean))return failure("font-load-failed",loads);
   var glyphs=verifyGlyphs();
   var ok=Object.keys(glyphs).every(function(key){return glyphs[key];});
   return ok?{ok:true,reason:"verified",loads:loads,glyphs:glyphs}:failure("glyph-verification-failed",loads,glyphs);
 });}).then(function(status){clearTimeout(timer);resolve(status);},function(){clearTimeout(timer);resolve(failure("font-load-failed",loads));});
},{once:true});
});
window.__bodyFontsReady.then(done,function(){done(failure("font-load-failed"));});
})();</script>`;
}