#!/usr/bin/env node
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
  .replace(/\$\{/g, "\\${");

const css = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:transparent}
#title-input{
  display:block;
  width:100%;
  font-family:'Eulyoo1945-SemiBold',serif;
  font-size:22px;
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
#title-input::placeholder{color:#a1a1aa;font-family:'Eulyoo1945-SemiBold',serif}
#editor-content{
  width:100%;
  min-height:200px;
  padding:0 0 120px;
  font-family:'Eulyoo1945-Regular',serif;
  font-size:var(--body-font-size,16px);
  line-height:1.8;
  letter-spacing:var(--body-letter-spacing,0.8px);
  color:#1A1A1A;
  background:transparent;
  -webkit-text-size-adjust:100%;
  outline:none;
  text-align:justify;
  overflow-wrap:break-word;
  text-justify:inter-ideograph;
}
.ProseMirror{
  outline:none;
  min-height:200px;
  word-wrap:break-word;
  white-space:pre-wrap;
}
.ProseMirror p{margin-bottom:1em;text-align:justify;overflow-wrap:break-word;text-justify:inter-ideograph}
.ProseMirror h1{font-family:'Eulyoo1945-SemiBold',serif;font-size:1.6em;font-weight:600;letter-spacing:0.025em;margin:1em 0 0.4em;line-height:1.25;text-align:left}
.ProseMirror h2{font-family:'Eulyoo1945-SemiBold',serif;font-size:1.3em;font-weight:600;letter-spacing:0.025em;margin:0.8em 0 0.3em;line-height:1.3;text-align:left}
.ProseMirror h3{font-family:'Eulyoo1945-SemiBold',serif;font-size:1.1em;font-weight:600;letter-spacing:0.025em;margin:0.6em 0 0.3em;line-height:1.35;text-align:left}
.ProseMirror ul,.ProseMirror ol{padding-left:1.5em;margin-bottom:1em;text-align:left}
.ProseMirror li{margin-bottom:0.2em;text-align:left}
.ProseMirror blockquote{font-family:'Eulyoo1945-Regular',serif;font-style:italic;border-left:3px solid #d4d4d8;padding-left:1em;margin:0.5em 0;color:#52525b;text-align:left}
.ProseMirror hr{border:none;border-top:1px solid #e4e4e7;margin:0}
.hr-wrapper{position:relative;margin:1em 0;cursor:pointer;padding:10px 0}
.hr-controls{display:none;justify-content:center;gap:8px;padding:4px 0 2px}
.hr-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #d4d4d8;border-radius:50%;background:#fff;color:#3f3f46;font-size:16px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;user-select:none;transition:opacity 0.15s}
.ProseMirror p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:#a1a1aa;pointer-events:none;float:left;height:0}
.ProseMirror u{text-decoration:underline}
.ProseMirror strong{font-family:'Eulyoo1945-SemiBold',serif;font-weight:700}
.ProseMirror em{font-style:italic}
.ProseMirror > .overflow-highlight{background:#fecaca}
#source-article-slot{display:none;width:100%;font-size:13px;color:#a1a1aa;font-family:system-ui,-apple-system,sans-serif;padding:0 0 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-tap-highlight-color:transparent}
body{padding:16px 0 0;overflow:auto}
`.trim();

const VERSION = "3.10.0";

const tsContent = `export const EDITOR_CONFIG_VERSION = "${VERSION}";

export interface EditorFontOptions {
  regularBase64?: string | null;
  semiBoldBase64?: string | null;
}

function buildFontFaceCSS(opts: EditorFontOptions): string {
  const { regularBase64, semiBoldBase64 } = opts;
  if (!regularBase64 || !semiBoldBase64) return "";
  return \`@font-face{font-family:'Eulyoo1945-Regular';src:url('data:font/woff2;base64,\${regularBase64}') format('woff2');font-weight:400;font-style:normal}@font-face{font-family:'Eulyoo1945-SemiBold';src:url('data:font/woff2;base64,\${semiBoldBase64}') format('woff2');font-weight:600;font-style:normal}\`;
}

export function getEditorHtml(fontOptions: EditorFontOptions = {}): string {
  const fontFaceCSS = buildFontFaceCSS(fontOptions);
  return \`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>\${fontFaceCSS}${css}</style>
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
