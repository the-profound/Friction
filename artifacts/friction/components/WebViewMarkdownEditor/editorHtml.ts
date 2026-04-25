export const EDITOR_CONFIG_VERSION = "3.0.0";

const TIPTAP_VERSION = "3.22.0";
const MARKED_VERSION = "17.0.5";
const TURNDOWN_VERSION = "7.2.2";

export function getEditorHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:transparent;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-text-size-adjust:100%}
body{padding:16px 0 0;overflow:auto}
#title-input{
  display:block;
  width:100%;
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
  -webkit-appearance:none;
  font-family:inherit;
}
#title-input::placeholder{color:#a1a1aa}
#editor{min-height:200px}
.ProseMirror{
  outline:none;
  font-size:16px;
  line-height:1.7;
  color:#18181b;
  padding:0 0 120px;
  min-height:200px;
}
.ProseMirror p{margin-bottom:0.5em}
.ProseMirror h1{font-size:1.75em;font-weight:700;margin:1em 0 0.4em;line-height:1.3}
.ProseMirror h2{font-size:1.4em;font-weight:700;margin:0.8em 0 0.3em;line-height:1.3}
.ProseMirror h3{font-size:1.15em;font-weight:600;margin:0.6em 0 0.3em;line-height:1.4}
.ProseMirror ul,.ProseMirror ol{padding-left:1.5em;margin-bottom:0.5em}
.ProseMirror li{margin-bottom:0.2em}
.ProseMirror blockquote{border-left:3px solid #d4d4d8;padding-left:1em;margin:0.5em 0;color:#52525b}
.ProseMirror hr{border:none;border-top:1px solid #e4e4e7;margin:1em 0}
.ProseMirror u{text-decoration:underline}
.ProseMirror p.is-editor-empty:first-child::before{
  content:attr(data-placeholder);
  color:#a1a1aa;
  pointer-events:none;
  float:left;
  height:0;
}
</style>
</head>
<body>
<textarea id="title-input" rows="1" placeholder="제목"></textarea>
<div id="editor"></div>
<script>
(function(){
  window.__pendingCmds = [];
  window.handleCommand = function(cmd){ window.__pendingCmds.push(cmd); };
  function postToRN(event){
    try {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(event));
      }
    } catch(e) {}
  }
  window.__postToRN = postToRN;
  document.addEventListener('message', function(e){
    try { window.handleCommand(JSON.parse(e.data)); } catch(e2) {}
  });
  window.addEventListener('message', function(e){
    try { window.handleCommand(JSON.parse(e.data)); } catch(e2) {}
  });
})();
</script>
<script type="module">
(async function(){
  var postToRN = window.__postToRN;
  try {
    var coreMod = await import('https://esm.sh/@tiptap/core@${TIPTAP_VERSION}?bundle-deps');
    var starterMod = await import('https://esm.sh/@tiptap/starter-kit@${TIPTAP_VERSION}?bundle-deps');
    var placeholderMod = await import('https://esm.sh/@tiptap/extension-placeholder@${TIPTAP_VERSION}?bundle-deps');
    var markedMod = await import('https://esm.sh/marked@${MARKED_VERSION}');
    var turndownMod = await import('https://esm.sh/turndown@${TURNDOWN_VERSION}');

    var Editor = coreMod.Editor;
    var StarterKit = starterMod.default || starterMod.StarterKit;
    var Placeholder = placeholderMod.default || placeholderMod.Placeholder;
    var marked = markedMod.marked || markedMod.default;
    var TurndownService = turndownMod.default || turndownMod.TurndownService;

    var titleInput = document.getElementById('title-input');
    var editorEl = document.getElementById('editor');
    var changeTimer = null;
    var CHANGE_THROTTLE_MS = 400;
    var editor = null;
    var laterQueue = [];

    var turndown = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
    });

    function autoResizeTitle(){
      titleInput.style.height = 'auto';
      titleInput.style.height = titleInput.scrollHeight + 'px';
    }

    function escapeHtml(s){
      return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function mdToHtml(md){
      try {
        var out = marked.parse(md || '', { gfm: true, breaks: true, async: false });
        return typeof out === 'string' ? out : '';
      } catch (e) {
        return '<p>' + escapeHtml(md || '') + '</p>';
      }
    }

    function htmlToMd(html){
      try {
        var raw = turndown.turndown(html || '');
        return raw.replace(/^\\\\([#\\-*>])/gm, '$1');
      } catch (e) {
        return '';
      }
    }

    function initEditor(initialMd, placeholder){
      editor = new Editor({
        element: editorEl,
        extensions: [
          StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
          Placeholder.configure({ placeholder: placeholder || '여기에 메모를 작성하세요...' }),
        ],
        content: mdToHtml(initialMd || ''),
        autofocus: false,
        editorProps: {
          attributes: { class: 'tiptap-editor' },
        },
        onUpdate: function(props){
          var ed = props.editor;
          if (changeTimer) clearTimeout(changeTimer);
          changeTimer = setTimeout(function(){
            var text = ed.state.doc.textContent;
            var charCount = text.length;
            var wordCount = text.trim() ? text.trim().split(/\\s+/).length : 0;
            postToRN({ type: 'onChange', payload: { isDirty: true, charCount: charCount, wordCount: wordCount } });
          }, CHANGE_THROTTLE_MS);
        },
      });
    }

    titleInput.addEventListener('input', function(){
      autoResizeTitle();
      postToRN({ type: 'onTitleChange', payload: { title: titleInput.value } });
    });

    function realHandleCommand(cmd){
      try {
        switch (cmd.type) {
          case 'init':
            if (!editor) {
              titleInput.value = (cmd.payload && cmd.payload.titleValue) || '';
              autoResizeTitle();
              initEditor(
                (cmd.payload && cmd.payload.initialMarkdown) || '',
                cmd.payload && cmd.payload.placeholder
              );
              var deferred = laterQueue.splice(0);
              for (var i = 0; i < deferred.length; i++) {
                realHandleCommand(deferred[i]);
              }
            }
            postToRN({ type: 'onReady' });
            break;
          case 'setMarkdown':
            if (editor) {
              editor.commands.setContent(mdToHtml(cmd.markdown || ''));
            } else {
              laterQueue.push(cmd);
            }
            break;
          case 'setTitle':
            titleInput.value = cmd.title || '';
            autoResizeTitle();
            break;
          case 'requestExportMarkdown':
            var md = editor ? htmlToMd(editor.getHTML()) : '';
            postToRN({
              type: 'onExportMarkdown',
              payload: { requestId: cmd.requestId, markdown: md, isDirty: false },
            });
            break;
          case 'setEditable':
            if (editor) {
              editor.setEditable(!!cmd.isEditable);
            } else {
              laterQueue.push(cmd);
            }
            titleInput.readOnly = !cmd.isEditable;
            titleInput.style.color = cmd.isEditable ? '#18181b' : '#52525b';
            break;
        }
      } catch (e) {
        postToRN({ type: 'onError', payload: { code: 'COMMAND_FAIL', message: String(e) } });
      }
    }

    var pending = window.__pendingCmds || [];
    window.__pendingCmds = null;
    window.handleCommand = realHandleCommand;
    for (var i = 0; i < pending.length; i++) {
      realHandleCommand(pending[i]);
    }
  } catch (err) {
    if (postToRN) {
      postToRN({ type: 'onError', payload: { code: 'EDITOR_BOOT_FAIL', message: String(err) } });
    }
  }
})();
</script>
</body>
</html>`;
}
