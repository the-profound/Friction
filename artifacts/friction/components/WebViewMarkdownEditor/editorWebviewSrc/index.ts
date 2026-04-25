import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Underline } from "@tiptap/extension-underline";
import { marked } from "marked";
import TurndownService from "turndown";

marked.setOptions({ breaks: true, gfm: true } as Parameters<typeof marked.setOptions>[0]);

function markdownToHtml(md: string): string {
  try {
    const result = marked.parse(md || "");
    return typeof result === "string" ? result : "";
  } catch {
    return `<p>${md || ""}</p>`;
  }
}

function htmlToMarkdown(html: string): string {
  try {
    const td = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
    });
    const raw = td.turndown(html || "");
    return raw.replace(/^\\([#\-*>])/gm, "$1");
  } catch {
    return "";
  }
}

function postToRN(event: object) {
  try {
    const rn = (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }).ReactNativeWebView;
    if (rn) {
      rn.postMessage(JSON.stringify(event));
    }
  } catch {}
}

interface InitPayload {
  initialMarkdown?: string;
  titleValue?: string;
  placeholder?: string;
  editorConfigVersion?: string;
}

interface Command {
  type: string;
  payload?: InitPayload;
  markdown?: string;
  title?: string;
  requestId?: string;
  isEditable?: boolean;
}

(function () {
  let editor: Editor | null = null;
  let titleInput: HTMLTextAreaElement | null = null;
  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  const CHANGE_THROTTLE_MS = 400;

  function autoResizeTitle() {
    if (!titleInput) return;
    titleInput.style.height = "auto";
    titleInput.style.height = titleInput.scrollHeight + "px";
  }

  function setupEditor(placeholder: string, initialMarkdown: string) {
    const el = document.getElementById("editor-content");
    if (!el) return;

    const initialHtml = markdownToHtml(initialMarkdown);

    editor = new Editor({
      element: el,
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Placeholder.configure({ placeholder }),
        Underline,
      ],
      content: initialHtml,
      editable: true,
      autofocus: false,
      onUpdate: ({ editor: ed }) => {
        if (changeTimer) clearTimeout(changeTimer);
        changeTimer = setTimeout(() => {
          const text = ed.state.doc.textContent;
          const charCount = text.length;
          const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
          postToRN({ type: "onChange", payload: { isDirty: true, charCount, wordCount } });
        }, CHANGE_THROTTLE_MS);
      },
    });
  }

  (window as unknown as { handleCommand: (cmd: Command) => void }).handleCommand = function (cmd: Command) {
    try {
      switch (cmd.type) {
        case "init": {
          const payload = cmd.payload || {};
          const initialMarkdown = payload.initialMarkdown || "";
          const placeholder = payload.placeholder || "여기에 메모를 작성하세요...";
          const titleValue = payload.titleValue || "";

          if (titleInput) {
            titleInput.value = titleValue;
            autoResizeTitle();
          }

          if (!editor) {
            setupEditor(placeholder, initialMarkdown);
          } else {
            const html = markdownToHtml(initialMarkdown);
            editor.commands.setContent(html);
          }

          postToRN({ type: "onReady" });
          break;
        }
        case "setMarkdown": {
          if (editor && !editor.isDestroyed) {
            const html = markdownToHtml(cmd.markdown || "");
            editor.commands.setContent(html);
          }
          break;
        }
        case "setTitle": {
          if (titleInput) {
            titleInput.value = cmd.title || "";
            autoResizeTitle();
          }
          break;
        }
        case "requestExportMarkdown": {
          if (editor && !editor.isDestroyed) {
            const html = editor.getHTML();
            const markdown = htmlToMarkdown(html);
            postToRN({
              type: "onExportMarkdown",
              payload: { requestId: cmd.requestId, markdown, isDirty: false },
            });
          }
          break;
        }
        case "setEditable": {
          if (editor && !editor.isDestroyed) {
            editor.setEditable(!!cmd.isEditable);
          }
          if (titleInput) {
            titleInput.readOnly = !cmd.isEditable;
            titleInput.style.color = cmd.isEditable ? "#18181b" : "#52525b";
          }
          break;
        }
      }
    } catch (e) {
      postToRN({ type: "onError", payload: { code: "COMMAND_FAIL", message: String(e) } });
    }
  };

  document.addEventListener("message", function (e: Event) {
    try {
      const cmd = JSON.parse((e as MessageEvent).data);
      (window as unknown as { handleCommand: (cmd: Command) => void }).handleCommand(cmd);
    } catch {}
  });

  window.addEventListener("load", function () {
    titleInput = document.getElementById("title-input") as HTMLTextAreaElement | null;
    if (titleInput) {
      titleInput.addEventListener("input", function () {
        autoResizeTitle();
        postToRN({ type: "onTitleChange", payload: { title: titleInput!.value } });
      });
    }
  });
})();
