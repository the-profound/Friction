import React, { useCallback, useEffect, useImperativeHandle, forwardRef, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Underline } from "@tiptap/extension-underline";
import { Node as TipTapNode } from "@tiptap/core";
import { marked } from "marked";
import TurndownService from "turndown";
import { ReaderTokens } from "@/constants/tokens";
import {
  getInlineImageTransformUrl,
  isPersistableInlineImageUrl,
  INLINE_IMAGE_DISPLAY_WIDTH,
} from "@/lib/inlineImages";
import { PixelRatio } from "react-native";
import type {
  WebViewMarkdownEditorProps,
  WebViewMarkdownEditorRef,
  OnChangePayload,
} from "./types";

marked.setOptions({ breaks: true, gfm: true } as Parameters<typeof marked.setOptions>[0]);

function markdownToHtml(md: string, ensureTrailingParagraph = true): string {
  try {
    const result = marked.parse(md || "");
    let html = typeof result === "string" ? result : "";
    // 마지막 블록이 단락(<p>)이 아닌 경우(예: blockquote, 리스트, 헤딩) 그
    // 아래를 탭/클릭해도 ProseMirror에 커서를 잡을 노드가 없어 입력이
    // 불가능해진다. 기존 편집기는 항상 빈 단락을 보장한다.
    if (ensureTrailingParagraph && !/<\/p>\s*$/.test(html)) {
      html += "<p></p>";
    }
    return html;
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
    td.escape = (str: string) => str;
    const root = document.createElement("div");
    root.innerHTML = html || "";
    root.querySelectorAll("img[data-original-src]").forEach((image) => {
      image.setAttribute("src", image.getAttribute("data-original-src") ?? "");
    });
    return td.turndown(root.innerHTML).replace(
      /!\[[^\]]*]\(([^)\s]+)\)/g,
      (full, src: string) => isPersistableInlineImageUrl(src) ? full : "",
    );
  } catch {
    return "";
  }
}

const InlineImage = TipTapNode.create({
  name: "inlineImage",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      originalSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-original-src") || element.getAttribute("src"),
      },
      alt: { default: "" },
      imageId: { default: null },
      uploadState: { default: "complete" },
      "data-autosplit": { default: null },
    };
  },
  parseHTML() {
    // marked.parse() emits plain <img> for legacy Markdown image syntax.
    // Parse both forms so opening then saving an existing article never drops
    // its image solely because it predates the custom node attribute.
    return [{ tag: 'img[data-inline="true"]' }, { tag: "img" }];
  },
  renderHTML({ HTMLAttributes }) {
    const state = HTMLAttributes.uploadState ?? "complete";
    return ["img", {
      "data-inline": "true",
      class: `tiptap-inline-image is-${state}`,
      src: getInlineImageTransformUrl(
        HTMLAttributes.originalSrc ?? HTMLAttributes.src ?? "",
        INLINE_IMAGE_DISPLAY_WIDTH,
        PixelRatio.get(),
      ),
      alt: HTMLAttributes.alt ?? "",
      "data-original-src": HTMLAttributes.originalSrc ?? HTMLAttributes.src ?? "",
      "data-image-id": HTMLAttributes.imageId ?? "",
      "data-upload-state": state,
    }];
  },
});

const CHANGE_THROTTLE_MS = 500;

const WebViewMarkdownEditorWeb = forwardRef<WebViewMarkdownEditorRef, WebViewMarkdownEditorProps>(
  function WebViewMarkdownEditorWeb(
    {
      initialMarkdown,
      titleValue,
      placeholder,
      ensureTrailingParagraph = true,
      editable = true,
      onReady,
      onChange,
      onExportMarkdown,
      onTitleChange,
      onError,
      belowTitleSlot,
      titleFontSize,
      hideTitle = false,
      onImageRetry,
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
        InlineImage,
      ],
       content: markdownToHtml(initialMarkdown, ensureTrailingParagraph),
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
             const html = markdownToHtml(markdown, ensureTrailingParagraph);
            editor.commands.setContent(html);
            // 인용구/리스트/헤딩 등으로 끝나는 메모를 주입할 때, 마지막 빈
            // 단락에 커서를 자동 배치해 사용자가 별도 탭 없이 바로 본문을
            // 이어서 입력할 수 있게 한다.
            try {
              editor.commands.focus("end");
            } catch {}
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
      focus() {
        if (editor && !editor.isDestroyed) {
          editor.commands.focus();
        }
      },
      focusStart() {
        if (editor && !editor.isDestroyed) {
          editor.commands.focus("start");
        }
      },
      blur() {
        if (editor && !editor.isDestroyed) {
          editor.commands.blur();
        }
      },
      undo() {
        if (editor && !editor.isDestroyed) {
          editor.chain().focus().undo().run();
        }
      },
      redo() {
        if (editor && !editor.isDestroyed) {
          editor.chain().focus().redo().run();
        }
      },
      setOverflowRanges(_ranges) {
      },
      setOverflowProbeConfig(_availableContentHeightPx, _autoSplit) {
      },
      setBlockType(blockType: string) {
        if (editor && !editor.isDestroyed) {
          const level = blockType === "h1" ? 1 : blockType === "h2" ? 2 : blockType === "h3" ? 3 : null;
          if (level) {
            editor.chain().focus().toggleHeading({ level }).run();
          } else {
            editor.chain().focus().setParagraph().run();
          }
        }
      },
      toggleMark(mark: string) {
        if (editor && !editor.isDestroyed) {
          if (mark === "bold") editor.chain().focus().toggleBold().run();
          if (mark === "italic") editor.chain().focus().toggleItalic().run();
          if (mark === "underline") editor.chain().focus().toggleUnderline().run();
        }
      },
      insertDivider() {
        if (editor && !editor.isDestroyed) {
          editor.commands.setHorizontalRule();
        }
      },
      insertHardBreak() {
        if (editor && !editor.isDestroyed) {
          editor.chain().focus().setHardBreak().run();
        }
      },
      insertImage(image) {
        if (editor && !editor.isDestroyed) {
          editor.chain().focus().insertContent({
            type: "inlineImage",
            attrs: {
              src: image.url,
              originalSrc: image.url,
              alt: "",
              imageId: image.imageId,
              uploadState: image.uploadState,
            },
          }).run();
        }
      },
      replaceImage(imageId: string, url: string) {
        if (editor && !editor.isDestroyed) {
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name !== "inlineImage" || node.attrs.imageId !== imageId) return true;
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              src: url,
              originalSrc: url,
              uploadState: "complete",
            }));
            return false;
          });
        }
      },
      setImageUploadState(imageId, uploadState) {
        if (editor && !editor.isDestroyed) {
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name !== "inlineImage" || node.attrs.imageId !== imageId) return true;
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              uploadState,
            }));
            return false;
          });
        }
      },
      insertQuote(text: string) {
        if (editor && !editor.isDestroyed && text) {
          editor.chain().focus().insertContent({
            type: "blockquote",
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          }).run();
        }
      },
      autoSplitImages() {
        return Promise.resolve({ hadConsecutiveImages: false });
      },
      scrollToBlock(_pageIndex: number, _blockIndex: number) {
      },
      setSpellHighlight(_original: string, _contextHint: string) {
      },
      clearSpellHighlight() {
      },
      applySpellFix(_original: string, _replacement: string, _contextHint: string) {
      },
    }), [editor, requestExportMarkdown, onError, ensureTrailingParagraph]);

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
      <div
        className="web-markdown-editor-scroll-container"
        style={
          titleFontSize != null
            ? ({ ...containerStyle, "--title-font-size": `${titleFontSize}px` } as React.CSSProperties)
            : containerStyle
        }
      >
        <style>{proseMirrorCss}</style>
        {!hideTitle && onTitleChange !== undefined && (
          <textarea
            ref={titleRef}
            defaultValue={titleValue || ""}
            placeholder="제목"
            onChange={handleTitleInput}
            rows={1}
            style={
              titleFontSize != null
                ? { ...titleInputStyle, fontSize: titleFontSize }
                : titleInputStyle
            }
            readOnly={!editable}
          />
        )}
        {belowTitleSlot}
        <EditorContent
          editor={editor}
          style={editorContentStyle}
          lang="en"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.matches('img[data-upload-state="failed"][data-image-id]')) {
              onImageRetry?.(target.dataset.imageId ?? "");
            }
          }}
        />
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
  fontFamily: "'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif",
  fontSize: 16,
  lineHeight: 1.8,
  letterSpacing: "0.05em",
  color: "#1A1A1A",
};

const titleInputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  fontFamily: "'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif",
  fontSize: `var(--title-font-size, ${ReaderTokens.typeScale.titleCqi}cqi)`,
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
.web-markdown-editor-scroll-container {
  scrollbar-width: none;
  -ms-overflow-style: none;
  scrollbar-gutter: stable;
}
.web-markdown-editor-scroll-container::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.ProseMirror {
  min-height: 100%;
  padding: 16px 24px 120px;
  outline: none;
  font-family: 'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif;
  font-size: 16px;
  line-height: 1.8;
  letter-spacing: 0.05em;
  color: #1A1A1A;
  -webkit-text-size-adjust: 100%;
  text-align: justify;
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: normal;
  -webkit-hyphens: auto;
  hyphens: auto;
}
.ProseMirror p { margin-bottom: 1em; text-align: justify; overflow-wrap: break-word; word-break: normal; -webkit-hyphens: auto; hyphens: auto; }
 .ProseMirror h1 { font-family: 'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif; font-size: var(--title-font-size, ${ReaderTokens.typeScale.titleCqi}cqi); font-weight: 700; letter-spacing: 0.025em; margin: 1em 0 0.4em; line-height: 1.25; text-align: left; }
.ProseMirror h2 { font-family: 'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif; font-size: 1.3em; font-weight: 700; letter-spacing: 0.025em; margin: 0.8em 0 0.3em; line-height: 1.3; text-align: left; }
.ProseMirror h3 { font-family: 'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif; font-size: 1.1em; font-weight: 600; letter-spacing: 0.025em; margin: 0.6em 0 0.3em; line-height: 1.35; text-align: left; }
.ProseMirror ul, .ProseMirror ol { padding-left: 1.5em; margin-bottom: 1em; text-align: left; }
.ProseMirror li { margin-bottom: 0.2em; text-align: left; }
.ProseMirror blockquote { font-family: 'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif; font-style: italic; border-left: 3px solid #d4d4d8; padding-left: 1em; margin: 0.5em 0; color: #52525b; text-align: left; }
.ProseMirror hr { border: none; border-top: 1px solid #e4e4e7; margin: 1em 0; }
.ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: #a1a1aa;
  pointer-events: none;
  float: left;
  height: 0;
}
.ProseMirror u { text-decoration: underline; }
.ProseMirror strong { font-family: 'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif; font-weight: 700; }
.ProseMirror em { font-style: italic; }
.ProseMirror img[data-inline="true"] { display:block; max-width:240px; width:auto; height:auto; border-radius:8px; margin:0.5em 0; }
.ProseMirror img[data-upload-state="uploading"] { opacity:0.55; }
.ProseMirror img[data-upload-state="failed"] { opacity:0.55; outline:2px solid #dc2626; cursor:pointer; }
.ProseMirror code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f4f4f5; padding: 0.1em 0.3em; border-radius: 3px; letter-spacing: 0; font-size: 0.9em; }
.ProseMirror pre { background: #f4f4f5; padding: 0.75em 1em; border-radius: 4px; overflow-x: auto; margin: 0.5em 0; letter-spacing: 0; text-align: left; }
.ProseMirror pre code { background: none; padding: 0; }
textarea::placeholder { color: #a1a1aa; }
`;
