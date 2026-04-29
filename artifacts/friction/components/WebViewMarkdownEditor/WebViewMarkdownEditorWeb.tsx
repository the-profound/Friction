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
    const raw = td.turndown(html || "");
    return raw.replace(/^\\([#\-*>])/gm, "$1");
  } catch {
    return "";
  }
}

const CHANGE_THROTTLE_MS = 500;

const WebViewMarkdownEditorWeb = forwardRef<WebViewMarkdownEditorRef, WebViewMarkdownEditorProps>(
  function WebViewMarkdownEditorWeb(
    {
      initialMarkdown,
      titleValue,
      placeholder,
      editable = true,
      onReady,
      onChange,
      onExportMarkdown,
      onTitleChange,
      onError,
      belowTitleSlot,
    },
    ref,
  ) {
    const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onExportMarkdownRef = useRef(onExportMarkdown);
    const titleRef = useRef<HTMLTextAreaElement>(null);
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
      setTitle(title: string) {
        if (titleRef.current) {
          titleRef.current.value = title;
        }
      },
      blur() {
        if (editor && !editor.isDestroyed) {
          editor.commands.blur();
        }
      },
      setOverflowFromBlock(_blockIndex: number | null) {
      },
    }), [editor, requestExportMarkdown, onError]);

    const handleTitleInput = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onTitleChange?.(e.target.value);
        const el = e.target;
        el.style.height = "auto";
        el.style.height = el.scrollHeight + "px";
      },
      [onTitleChange],
    );

    return (
      <div style={containerStyle}>
        <style>{proseMirrorCss}</style>
        {onTitleChange !== undefined && (
          <textarea
            ref={titleRef}
            defaultValue={titleValue || ""}
            placeholder="제목"
            onChange={handleTitleInput}
            rows={1}
            style={titleInputStyle}
            readOnly={!editable}
          />
        )}
        {belowTitleSlot}
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
  fontFamily: "'Eulyoo1945-Regular', serif",
  fontSize: 16,
  lineHeight: 1.8,
  letterSpacing: "0.05em",
  color: "#1A1A1A",
};

const titleInputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  fontFamily: "'Eulyoo1945-SemiBold', serif",
  fontSize: 22,
  fontWeight: 600,
  lineHeight: 1.25,
  letterSpacing: "-0.01em",
  color: "#1A1A1A",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid #f4f4f5",
  outline: "none",
  resize: "none",
  overflow: "hidden",
  padding: "8px 24px",
  marginBottom: 12,
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
  font-family: 'Eulyoo1945-Regular', serif;
  font-size: 16px;
  line-height: 1.8;
  letter-spacing: 0.05em;
  color: #1A1A1A;
  -webkit-text-size-adjust: 100%;
  text-align: justify;
}
.ProseMirror p { margin-bottom: 1em; text-align: justify; }
.ProseMirror h1 { font-family: 'Eulyoo1945-SemiBold', serif; font-size: 1.6em; font-weight: 700; letter-spacing: 0.025em; margin: 1em 0 0.4em; line-height: 1.25; text-align: left; }
.ProseMirror h2 { font-family: 'Eulyoo1945-SemiBold', serif; font-size: 1.3em; font-weight: 700; letter-spacing: 0.025em; margin: 0.8em 0 0.3em; line-height: 1.3; text-align: left; }
.ProseMirror h3 { font-family: 'Eulyoo1945-SemiBold', serif; font-size: 1.1em; font-weight: 600; letter-spacing: 0.025em; margin: 0.6em 0 0.3em; line-height: 1.35; text-align: left; }
.ProseMirror ul, .ProseMirror ol { padding-left: 1.5em; margin-bottom: 1em; text-align: left; }
.ProseMirror li { margin-bottom: 0.2em; text-align: left; }
.ProseMirror blockquote { font-family: 'Eulyoo1945-Regular', serif; font-style: italic; border-left: 3px solid #d4d4d8; padding-left: 1em; margin: 0.5em 0; color: #52525b; text-align: left; }
.ProseMirror hr { border: none; border-top: 1px solid #e4e4e7; margin: 1em 0; }
.ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: #a1a1aa;
  pointer-events: none;
  float: left;
  height: 0;
}
.ProseMirror u { text-decoration: underline; }
.ProseMirror strong { font-family: 'Eulyoo1945-SemiBold', serif; font-weight: 700; }
.ProseMirror em { font-style: italic; }
.ProseMirror code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f4f4f5; padding: 0.1em 0.3em; border-radius: 3px; letter-spacing: 0; font-size: 0.9em; }
.ProseMirror pre { background: #f4f4f5; padding: 0.75em 1em; border-radius: 4px; overflow-x: auto; margin: 0.5em 0; letter-spacing: 0; text-align: left; }
.ProseMirror pre code { background: none; padding: 0; }
textarea::placeholder { color: #a1a1aa; }
`;
