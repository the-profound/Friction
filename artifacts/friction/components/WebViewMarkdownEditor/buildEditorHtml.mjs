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
  target: ["es2017"],
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
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:22px;
  font-weight:600;
  line-height:1.4;
  color:#18181b;
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
#title-input::placeholder{color:#a1a1aa}
#editor-content{
  width:100%;
  min-height:200px;
  padding:0 0 120px;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:16px;
  line-height:1.7;
  color:#18181b;
  background:transparent;
  -webkit-text-size-adjust:100%;
  outline:none;
}
.ProseMirror{
  outline:none;
  min-height:200px;
  word-wrap:break-word;
  white-space:pre-wrap;
}
.ProseMirror p{margin-bottom:0.5em}
.ProseMirror h1{font-size:1.75em;font-weight:700;margin:1em 0 0.4em;line-height:1.3}
.ProseMirror h2{font-size:1.4em;font-weight:700;margin:0.8em 0 0.3em;line-height:1.3}
.ProseMirror h3{font-size:1.15em;font-weight:600;margin:0.6em 0 0.3em;line-height:1.4}
.ProseMirror ul,.ProseMirror ol{padding-left:1.5em;margin-bottom:0.5em}
.ProseMirror li{margin-bottom:0.2em}
.ProseMirror blockquote{border-left:3px solid #d4d4d8;padding-left:1em;margin:0.5em 0;color:#52525b}
.ProseMirror hr{border:none;border-top:1px solid #e4e4e7;margin:1em 0}
.ProseMirror p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:#a1a1aa;pointer-events:none;float:left;height:0}
.ProseMirror u{text-decoration:underline}
.ProseMirror strong{font-weight:700}
.ProseMirror em{font-style:italic}
.ProseMirror code{font-family:monospace;background:#f4f4f5;padding:0.1em 0.3em;border-radius:3px}
.ProseMirror pre{background:#f4f4f5;padding:0.75em 1em;border-radius:4px;overflow-x:auto;margin:0.5em 0}
.ProseMirror pre code{background:none;padding:0}
body{padding:16px 0 0;overflow:auto}
`.trim();

const VERSION = "3.0.0";

const tsContent = `export const EDITOR_CONFIG_VERSION = "${VERSION}";

export function getEditorHtml(): string {
  return \`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>${css}</style>
</head>
<body>
<textarea id="title-input" rows="1" placeholder="제목"></textarea>
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
