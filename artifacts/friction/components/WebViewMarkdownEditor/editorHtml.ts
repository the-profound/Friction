export const EDITOR_CONFIG_VERSION = "2.1.0";

export function getEditorHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
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
#editor{
  width:100%;
  min-height:200px;
  height:auto;
  padding:0 0 120px;
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
body{padding:16px 0 0;overflow:auto}
</style>
</head>
<body>
<textarea id="title-input" rows="1" placeholder="제목"></textarea>
<textarea id="editor"></textarea>
<script>
(function(){
  var ta = document.getElementById('editor');
  var titleInput = document.getElementById('title-input');
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

  function autoResizeTitle() {
    titleInput.style.height = 'auto';
    titleInput.style.height = titleInput.scrollHeight + 'px';
  }

  function autoResize() {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  titleInput.addEventListener('input', function() {
    autoResizeTitle();
    postToRN({ type: 'onTitleChange', payload: { title: titleInput.value } });
  });

  ta.addEventListener('input', function() {
    autoResize();
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(function() {
      var text = ta.value;
      var charCount = text.length;
      var wordCount = text.trim() ? text.trim().split(/\\s+/).length : 0;
      postToRN({ type: 'onChange', payload: { isDirty: true, charCount: charCount, wordCount: wordCount } });
    }, CHANGE_THROTTLE_MS);
  });

  window.handleCommand = function(cmd) {
    try {
      switch(cmd.type) {
        case 'init':
          if (!initialized) {
            initialized = true;
            titleInput.value = cmd.payload.titleValue || '';
            autoResizeTitle();
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
        case 'setTitle':
          titleInput.value = cmd.title || '';
          autoResizeTitle();
          break;
        case 'requestExportMarkdown':
          postToRN({
            type: 'onExportMarkdown',
            payload: { requestId: cmd.requestId, markdown: ta.value, isDirty: false }
          });
          break;
        case 'setEditable':
          ta.readOnly = !cmd.isEditable;
          titleInput.readOnly = !cmd.isEditable;
          ta.style.color = cmd.isEditable ? '#18181b' : '#52525b';
          titleInput.style.color = cmd.isEditable ? '#18181b' : '#52525b';
          break;
      }
    } catch(e) {
      postToRN({ type: 'onError', payload: { code: 'COMMAND_FAIL', message: String(e) } });
    }
  };

  document.addEventListener('message', function(e) {
    try { window.handleCommand(JSON.parse(e.data)); } catch(e2) {}
  });
})();
</script>
</body>
</html>`;
}
