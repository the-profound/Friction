import React, { useCallback, useEffect, useImperativeHandle, forwardRef, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Underline } from "@tiptap/extension-underline";
import { marked } from "marked";
import TurndownService from "turndown";
import type {
  WebViewMarkdownEditorProps,
  WebViewMarkdownEditorRef,
  OnChangePayload,
} from "./types";

marked.setOptions({ breaks: true, gfm: true } as Parameters<typeof marked.setOptions>[0]);

function markdownToHtml(md: string): string {
  try {
    const result = marked.parse(md || "");
    return typeof result === "string" ? result : "";
  } catch (e: unknown) {
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
    return td.turndown(html || "");
  } catch {
    return "";
  }
}

const CHANGE_THROTTLE_MS = 500;

const WebViewMarkdownEditorWeb = forwardRef<WebViewMarkdownEditorRef, WebViewMarkdownEditorProps>(
  function WebViewMarkdownEditorWeb(
    {
      initialMarkdown,
      placeholder,
      editable = true,
      onReady,
      onChange,
      onExportMarkdown,
      onError,
    },
    ref,
  ) {
    const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onExportMarkdownRef = useRef(onExportMarkdown);
    useEffect(() => { onExportMarkdownRef.current = onExportMarkdown; }, [onExportMarkdown]);

    const editor = useEditor({
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Placeholder.configure({ placeholder: placeholder || "여기에 메모를 작성하세요..." }),
        Underline,
      ],
      content: markdownToHtml(initialMarkdown),
      editable,
      autofocus: false,
      onUpdate: ({ editor: ed }) => {
        if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
        changeTimerRef.current = setTimeout(() => {
          const text = ed.state.doc.textContent;
          const charCount = text.length;
          const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
          const payload: OnChangePayload = { isDirty: true, charCount, wordCount };
          onChange?.(payload);
        }, CHANGE_THROTTLE_MS);
      },
      onCreate: () => {
        onReady?.();
      },
    });

    useEffect(() => {
      if (editor && !editor.isDestroyed) {
        editor.setEditable(editable);
      }
    }, [editor, editable]);

    useEffect(() => {
      return () => {
        if (changeTimerRef.current) {
          clearTimeout(changeTimerRef.current);
        }
      };
    }, []);

    const requestExportMarkdown = useCallback(
      (requestId: string) => {
        if (editor && !editor.isDestroyed) {
          try {
            const html = editor.getHTML();
            const markdown = htmlToMarkdown(html);
            onExportMarkdownRef.current?.({ requestId, markdown, isDirty: false });
          } catch (e: unknown) {
            onError?.({ code: "MARKDOWN_CONVERT_FAIL", message: e instanceof Error ? e.message : String(e) });
          }
        }
      },
      [editor, onError],
    );

    useImperativeHandle(ref, () => ({
      setMarkdown(markdown: string) {
        if (editor && !editor.isDestroyed) {
          try {
            const html = markdownToHtml(markdown);
            editor.commands.setContent(html);
          } catch (e: unknown) {
            onError?.({ code: "MARKDOWN_PARSE_FAIL", message: e instanceof Error ? e.message : String(e) });
          }
        }
      },
      requestExportMarkdown,
      setEditable(isEditable: boolean) {
        if (editor && !editor.isDestroyed) {
          editor.setEditable(isEditable);
        }
      },
    }), [editor, requestExportMarkdown, onError]);

    return (
      <div style={containerStyle}>
        <style>{proseMirrorCss}</style>
        <EditorContent editor={editor} style={editorContentStyle} />
      </div>
    );
  },
);

export default WebViewMarkdownEditorWeb;

const containerStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "auto",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: 16,
  lineHeight: 1.7,
  color: "#18181b",
};

const editorContentStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  height: "100%",
};

const proseMirrorCss = `
.ProseMirror {
  min-height: 100%;
  padding: 16px 24px 120px;
  outline: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 16px;
  line-height: 1.7;
  color: #18181b;
  -webkit-text-size-adjust: 100%;
}
.ProseMirror p { margin-bottom: 0.5em; }
.ProseMirror h1 { font-size: 1.75em; font-weight: 700; margin: 1em 0 0.4em; line-height: 1.3; }
.ProseMirror h2 { font-size: 1.4em; font-weight: 700; margin: 0.8em 0 0.3em; line-height: 1.3; }
.ProseMirror h3 { font-size: 1.15em; font-weight: 600; margin: 0.6em 0 0.3em; line-height: 1.4; }
.ProseMirror ul, .ProseMirror ol { padding-left: 1.5em; margin-bottom: 0.5em; }
.ProseMirror li { margin-bottom: 0.2em; }
.ProseMirror blockquote { border-left: 3px solid #d4d4d8; padding-left: 1em; margin: 0.5em 0; color: #52525b; }
.ProseMirror hr { border: none; border-top: 1px solid #e4e4e7; margin: 1em 0; }
.ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: #a1a1aa;
  pointer-events: none;
  float: left;
  height: 0;
}
.ProseMirror u { text-decoration: underline; }
`;
