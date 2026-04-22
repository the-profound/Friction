export const EDITOR_CONFIG_VERSION = "2.0.0";

export function getEditorHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:transparent}
#editor{
  width:100%;
  min-height:100%;
  height:auto;
  padding:16px 0 120px;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:16px;
  line-height:1.7;
  color:#18181b;
  background:transparent;
  border:none;
  outline:none;
  resize:none;
  -webkit-text-size-adjust:100%;
  -webkit-appearance:none;
  overflow:hidden;
}
#editor::placeholder{color:#a1a1aa}
body{padding:0;overflow:auto}
</style>
</head>
<body>
<textarea id="editor"></textarea>
<script>
(function(){
  var ta = document.getElementById('editor');
  var changeTimer = null;
  var CHANGE_THROTTLE_MS = 400;
  var initialized = false;

  function postToRN(event) {
    try {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(event));
      }
    } catch(e) {}
  }

  function autoResize() {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  ta.addEventListener('input', function() {
    autoResize();
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(function() {
      var text = ta.value;
      var charCount = text.length;
      var wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
      postToRN({ type: 'onChange', payload: { isDirty: true, charCount: charCount, wordCount: wordCount } });
    }, CHANGE_THROTTLE_MS);
  });

  window.handleCommand = function(cmd) {
    try {
      switch(cmd.type) {
        case 'init':
          if (!initialized) {
            initialized = true;
            ta.value = cmd.payload.initialMarkdown || '';
            ta.placeholder = cmd.payload.placeholder || '여기에 메모를 작성하세요...';
            autoResize();
          }
          postToRN({ type: 'onReady' });
          break;
        case 'setMarkdown':
          ta.value = cmd.markdown || '';
          autoResize();
          break;
        case 'requestExportMarkdown':
          postToRN({
            type: 'onExportMarkdown',
            payload: { requestId: cmd.requestId, markdown: ta.value, isDirty: false }
          });
          break;
        case 'setEditable':
          ta.readOnly = !cmd.isEditable;
          ta.style.color = cmd.isEditable ? '#18181b' : '#52525b';
          break;
      }
    } catch(e) {
      postToRN({ type: 'onError', payload: { code: 'COMMAND_FAIL', message: String(e) } });
    }
  };

  document.addEventListener('message', function(e) {
    try { window.handleCommand(JSON.parse(e.data)); } catch(e2) {}
  });
  window.addEventListener('message', function(e) {
    try { window.handleCommand(JSON.parse(e.data)); } catch(e2) {}
  });

  postToRN({ type: 'onReady' });
})();
</script>
</body>
</html>`;
}
