export const EDITOR_CONFIG_VERSION = "1.0.0";

export function getEditorHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.7;color:#18181b;-webkit-text-size-adjust:100%}
.ProseMirror{min-height:100%;padding:16px 24px 120px;outline:none}
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
</style>
</head>
<body>
<div id="editor"></div>
<script src="https://cdn.jsdelivr.net/npm/@tiptap/core@2.11.5/dist/index.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@tiptap/starter-kit@2.11.5/dist/index.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@tiptap/extension-placeholder@2.11.5/dist/index.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@tiptap/extension-underline@2.11.5/dist/index.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js"></script>
<script src="https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js"></script>
<script>
(function(){
  var editor = null;
  var changeTimer = null;
  var CHANGE_THROTTLE_MS = 500;

  function postToRN(event) {
    try {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(event));
      }
    } catch(e) {}
  }

  function markdownToHtml(md) {
    try {
      return marked.parse(md || '', { breaks: true, gfm: true });
    } catch(e) {
      postToRN({ type: 'onError', payload: { code: 'MARKDOWN_PARSE_FAIL', message: e.message } });
      return '<p>' + (md || '') + '</p>';
    }
  }

  function htmlToMarkdown(html) {
    try {
      var td = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced' });
      return td.turndown(html || '');
    } catch(e) {
      postToRN({ type: 'onError', payload: { code: 'MARKDOWN_CONVERT_FAIL', message: e.message } });
      return '';
    }
  }

  function getStats() {
    if (!editor) return { charCount: 0, wordCount: 0 };
    var text = editor.state.doc.textContent;
    return {
      charCount: text.length,
      wordCount: text.trim() ? text.trim().split(/\\s+/).length : 0
    };
  }

  function initEditor(payload) {
    try {
      var html = markdownToHtml(payload.initialMarkdown);
      var extensions = [
        window.TiptapStarterKit.StarterKit.configure({ heading: { levels: [1,2,3] } }),
        window.TiptapPlaceholder.Placeholder.configure({ placeholder: payload.placeholder || '여기에 메모를 작성하세요...' }),
        window.TiptapUnderline.Underline
      ];
      editor = new window.TiptapCore.Editor({
        element: document.getElementById('editor'),
        extensions: extensions,
        content: html,
        editable: true,
        autofocus: false,
        onUpdate: function() {
          if (changeTimer) clearTimeout(changeTimer);
          changeTimer = setTimeout(function() {
            var stats = getStats();
            postToRN({ type: 'onChange', payload: { isDirty: true, charCount: stats.charCount, wordCount: stats.wordCount } });
          }, CHANGE_THROTTLE_MS);
        }
      });
      postToRN({ type: 'onReady' });
    } catch(e) {
      postToRN({ type: 'onError', payload: { code: 'INIT_FAIL', message: e.message } });
    }
  }

  function handleCommand(cmd) {
    try {
      switch(cmd.type) {
        case 'init':
          initEditor(cmd.payload);
          break;
        case 'setMarkdown':
          if (editor) {
            var html = markdownToHtml(cmd.markdown);
            editor.commands.setContent(html);
          }
          break;
        case 'requestExportMarkdown':
          if (editor) {
            var exportHtml = editor.getHTML();
            var md = htmlToMarkdown(exportHtml);
            var stats = getStats();
            postToRN({ type: 'onExportMarkdown', payload: { requestId: cmd.requestId, markdown: md, isDirty: false } });
          }
          break;
        case 'setEditable':
          if (editor) editor.setEditable(cmd.isEditable);
          break;
      }
    } catch(e) {
      postToRN({ type: 'onError', payload: { code: 'COMMAND_FAIL', message: e.message } });
    }
  }

  document.addEventListener('message', function(e) { handleCommand(JSON.parse(e.data)); });
  window.addEventListener('message', function(e) { handleCommand(JSON.parse(e.data)); });
})();
</script>
</body>
</html>`;
}
