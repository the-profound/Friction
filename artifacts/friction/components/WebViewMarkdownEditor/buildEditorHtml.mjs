#!/usr/bin/env node
/**
 * ⚠️ 주의: 이 스크립트는 editorHtml.ts 의 <script> 번들만 생성한다.
 * editorHtml.ts 상단에는 task #492 이후 수동으로 추가된 import / perfEnabled
 * 옵션 / bodyTypographyCss / perfHeadScript / bridgeHeadScript (task #495)
 * 가 들어있다. 이 스크립트를 그대로 실행해 editorHtml.ts 를 덮어쓰면 그 수정
 * 사항이 사라진다. 번들 JS 만 갱신하려면 출력에서 <script>...</script>
 * 구간만 잘라 editorHtml.ts 의 동일 구간에 splice 해야 한다 (task #494 참고).
 */
import * as esbuild from "esbuild";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPoint = path.join(__dirname, "editorWebviewSrc", "index.ts");
const outputFile = path.join(__dirname, "editorHtml.ts");

const result = await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  write: false,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

const bundleJs = result.outputFiles[0].text;

const escapedJs = bundleJs
  .replace(/\\/g, "\\\\")
  .replace(/`/g, "\\`")
  .replace(/\$\{/g, "\\${")
  // Keep raw newlines inside nested template literals from leaving trailing
  // whitespace in the generated TypeScript source.
  .replace(/\r?\n/g, "\\n");

const css = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:transparent;container-type:inline-size}
#title-input{
  display:block;
  width:100%;
  font-family:var(--body-semibold-font-family,'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif);
   font-size:var(--title-font-size);
  font-weight:600;
  line-height:1.25;
  letter-spacing:-0.01em;
  color:#1A1A1A;
  background:transparent;
  border:none;
  border-bottom:1px solid #f4f4f5;
  outline:none;
  resize:none;
  overflow:hidden;
  padding:8px 0;
  margin-bottom:12px;
  -webkit-text-size-adjust:100%;
  -webkit-appearance:none;
}
#title-input::placeholder{color:#a1a1aa;font-family:var(--body-semibold-font-family,'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif)}
#editor-content{
  width:var(--text-column-width);
  max-width:100%;
  min-height:200px;
  padding:0 0 120px;
  outline:none;
}
.ProseMirror{
  box-sizing:border-box;
  width:100%;
  max-width:100%;
  outline:none;
  min-height:200px;
  white-space:pre-wrap !important;
}
.hr-wrapper{position:relative;margin:1em 0;cursor:pointer}
.hr-controls{display:none;position:absolute;left:0;right:0;top:100%;z-index:2;justify-content:space-between;align-items:center;padding:4px 0 2px;background:#fff}
.hr-move-group{display:inline-flex;gap:8px}
.hr-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #d4d4d8;border-radius:50%;background:#fff;color:#3f3f46;font-size:16px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;user-select:none;transition:opacity 0.15s}
.hr-btn-delete{color:#a1a1aa;font-size:14px}
.ProseMirror p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:#a1a1aa;pointer-events:none;float:left;height:0}
.ProseMirror .overflow-highlight{background:#fecaca}
.ProseMirror .spell-highlight{background:rgba(59,130,246,0.15);border-bottom:2px solid #3b82f6;border-radius:1px}
.tiptap-question-block{background-color:#eff6ff;border-radius:6px;padding:0;margin:0 0 1em}
.tiptap-question-block p{margin:0;font-family:var(--body-regular-font-family,'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif);font-weight:400;color:#1e3a8a}
.tiptap-question-block p::before{content:'Q. '}
@keyframes page-anchor-pulse{0%{opacity:0}25%{opacity:1}75%{opacity:1}100%{opacity:0}}
.page-anchor-overlay{position:absolute;left:0;width:100%;background:rgba(59,130,246,0.14);border-radius:6px;pointer-events:none;z-index:0;animation:page-anchor-pulse 1.6s ease-in-out forwards}
#source-article-slot{display:none;width:100%;font-size:13px;color:#a1a1aa;font-family:system-ui,-apple-system,sans-serif;padding:0 0 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-tap-highlight-color:transparent}
body{padding:16px 0 0;overflow:auto;position:relative}
`.trim();

const VERSION = "3.21.0";

const tsContent = `import { buildWebViewPerfHeadScript } from "@/lib/webviewPerf";
import { buildWebViewBridgeHeadScript } from "@/lib/webViewBridgeShim";
import { buildBodyTypographyCss } from "@/components/shared/bodyTypographyCss";
import {
  BODY_FONT_CONFIG_VERSION,
  buildBodyFontReadyScript,
  buildEmbeddedBodyFontFaceCss,
  hasEmbeddedBodyFonts,
  type EmbeddedBodyFontOptions,
} from "@/components/shared/bodyTypographyFonts";

export const EDITOR_CONFIG_VERSION = \`${VERSION}-\${BODY_FONT_CONFIG_VERSION}\`;

export interface EditorFontOptions extends EmbeddedBodyFontOptions {
  perfEnabled?: boolean;
}

function buildFontFaceCSS(opts: EditorFontOptions): string {
  return buildEmbeddedBodyFontFaceCss(opts);
}

const bodyTypographyCss = buildBodyTypographyCss({
  rootSelector: "#editor-content",
  blockSelector: ".ProseMirror",
  blockMargins: "spaced",
  hrStyle: "flush",
});

export function getEditorHtml(fontOptions: EditorFontOptions = {}): string {
  const fontFaceCSS = buildFontFaceCSS(fontOptions);
  const perfHeadScript = buildWebViewPerfHeadScript(!!fontOptions.perfEnabled);
  const bridgeHeadScript = buildWebViewBridgeHeadScript();
  const fontReadyScript = buildBodyFontReadyScript(hasEmbeddedBodyFonts(fontOptions));
  return \`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
\${perfHeadScript}
\${bridgeHeadScript}
<style>\${fontFaceCSS}\${bodyTypographyCss}${css}</style>
\${fontReadyScript}
</head>
<body>
<textarea id="title-input" rows="1" placeholder="제목"></textarea>
<div id="source-article-slot"></div>
<div id="editor-content"></div>
<script>
${escapedJs}
<\/script>
</body>
</html>\`;
}
`;

fs.writeFileSync(outputFile, tsContent, "utf-8");
console.log(`Generated editorHtml.ts (bundle: ${Math.round(bundleJs.length / 1024)}KB, version: ${VERSION})`);
