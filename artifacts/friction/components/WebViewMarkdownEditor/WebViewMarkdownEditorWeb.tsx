import React, { useCallback, useEffect, useImperativeHandle, forwardRef, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Underline } from "@tiptap/extension-underline";
import { Node as TipTapNode } from "@tiptap/core";
import { marked } from "marked";
import TurndownService from "turndown";
import {
  getInlineImageTransformUrl,
  isPersistableInlineImageUrl,
  INLINE_IMAGE_DISPLAY_WIDTH,
} from "@/lib/inlineImages";
import { PixelRatio } from "react-native";
import {
  BODY_REGULAR_FONT_FAMILY,
  BODY_SEMIBOLD_FONT_FAMILY,
} from "@/components/shared/bodyTypographyFonts";
import { buildBodyTypographyCss } from "@/components/shared/bodyTypographyCss";
import type {
  WebViewMarkdownEditorProps,
  WebViewMarkdownEditorRef,
  OnChangePayload,
} from "./types";
import {
  hasCompleteBodyFontSet,
  logWebBodyTypographyDiagnostic,
  waitForWebBodyFonts,
  type BodyFontLoadStatus,
} from "@/lib/bodyTypographyDiagnostics";
import { splitLeadingH1Markdown } from "@/utils/leadingH1";
import { shouldMoveTitleFocusToBody } from "./titleKeyboardContract";
import {
  createEditorSurfaceTouchSession,
  isBlankEditorSurfaceTarget,
  isStationaryBlankSurfaceTap,
  updateEditorSurfaceTouchSession,
  type EditorSurfaceTouchSession,
} from "./editorSurfaceTouch";

marked.setOptions({ breaks: true, gfm: true } as Parameters<typeof marked.setOptions>[0]);

function markdownToHtml(md: string, ensureTrailingParagraph = true): string {
  try {
    const leadingH1 = splitLeadingH1Markdown(md || "");
    const result = marked.parse(leadingH1?.body ?? md ?? "");
    let html = leadingH1
      ? `<h1>${marked.parseInline(leadingH1.titleMarkdown)}</h1>${typeof result === "string" ? result : ""}`
      : typeof result === "string" ? result : "";
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
  } catch (error) {
    throw new Error("Failed to convert editor HTML to Markdown", { cause: error });
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
    return ["img", {
      "data-inline": "true",
      class: "tiptap-inline-image",
      src: getInlineImageTransformUrl(
        HTMLAttributes.originalSrc ?? HTMLAttributes.src ?? "",
        INLINE_IMAGE_DISPLAY_WIDTH,
        PixelRatio.get(),
      ),
      alt: HTMLAttributes.alt ?? "",
      "data-original-src": HTMLAttributes.originalSrc ?? HTMLAttributes.src ?? "",
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
      typography,
      hideTitle = false,
      contentBottomPadding = 120,
    },
    ref,
  ) {
    const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onExportMarkdownRef = useRef(onExportMarkdown);
    const editorSessionIdRef = useRef(`editor_web_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const titleRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [fontsReady, setFontsReady] = useState(false);
    const fontStatusRef = useRef<BodyFontLoadStatus | null>(null);
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
          try {
            const payload: OnChangePayload = {
              isDirty: true,
              charCount,
              wordCount,
              markdown: htmlToMarkdown(ed.getHTML()),
              editorSessionId: editorSessionIdRef.current,
            };
            onChange?.(payload);
          } catch (error) {
            onError?.({
              code: "MARKDOWN_EXPORT_FAIL",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }, CHANGE_THROTTLE_MS);
      },
      onCreate: () => {
        waitForWebBodyFonts().then((status) => {
          fontStatusRef.current = status;
          setFontsReady(true);
          onReady?.(editorSessionIdRef.current);
        });
      },
    });

    useEffect(() => {
      if (!fontsReady || !containerRef.current) return;
      const frame = requestAnimationFrame(() => {
        const target = containerRef.current?.querySelector<HTMLElement>(".ProseMirror");
        if (target) {
          logWebBodyTypographyDiagnostic(
            "editor",
            target,
            typography,
            fontStatusRef.current ?? undefined,
          );
        }
      });
      return () => cancelAnimationFrame(frame);
    }, [fontsReady, typography]);

    useEffect(() => {
      if (editor && !editor.isDestroyed) {
        editor.setEditable(editable);
      }
    }, [editor, editable]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !editor || editor.isDestroyed) return;

      let touchSession: EditorSurfaceTouchSession | null = null;
      let activePointerId: number | null = null;

      const handlePointerDown = (event: PointerEvent) => {
        if (!event.isPrimary || activePointerId != null) {
          touchSession = null;
          activePointerId = null;
          return;
        }
        activePointerId = event.pointerId;
        touchSession = createEditorSurfaceTouchSession(
          event.clientX,
          event.clientY,
          isBlankEditorSurfaceTarget(event.target),
        );
      };

      const handlePointerMove = (event: PointerEvent) => {
        if (!touchSession || event.pointerId !== activePointerId) return;
        updateEditorSurfaceTouchSession(touchSession, event.clientX, event.clientY);
      };

      const handleScroll = () => {
        if (touchSession) touchSession.scrolled = true;
      };

      const handlePointerCancel = (event: PointerEvent) => {
        if (event.pointerId !== activePointerId) return;
        touchSession = null;
        activePointerId = null;
      };

      const handlePointerUp = (event: PointerEvent) => {
        if (event.pointerId !== activePointerId) return;
        const session = touchSession;
        touchSession = null;
        activePointerId = null;
        if (
          !session
          || editor.isDestroyed
          || editor.isFocused
          || document.activeElement === titleRef.current
        ) {
          return;
        }

        if (
          !isStationaryBlankSurfaceTap(
            session,
            event.clientX,
            event.clientY,
            isBlankEditorSurfaceTarget(event.target),
          )
        ) {
          return;
        }

        editor.commands.focus();
      };

      container.addEventListener("pointerdown", handlePointerDown, { passive: true });
      container.addEventListener("pointermove", handlePointerMove, { passive: true });
      container.addEventListener("pointerup", handlePointerUp, { passive: true });
      container.addEventListener("pointercancel", handlePointerCancel, { passive: true });
      container.addEventListener("scroll", handleScroll, { passive: true });

      return () => {
        container.removeEventListener("pointerdown", handlePointerDown);
        container.removeEventListener("pointermove", handlePointerMove);
        container.removeEventListener("pointerup", handlePointerUp);
        container.removeEventListener("pointercancel", handlePointerCancel);
        container.removeEventListener("scroll", handleScroll);
      };
    }, [editor]);

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
            onExportMarkdownRef.current?.({
              requestId,
              markdown,
              isDirty: false,
              editorSessionId: editorSessionIdRef.current,
            });
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            onExportMarkdownRef.current?.({
              requestId,
              isDirty: true,
              editorSessionId: editorSessionIdRef.current,
              error: { code: "MARKDOWN_EXPORT_FAIL", message },
            });
            onError?.({ code: "MARKDOWN_EXPORT_FAIL", message });
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

    const handleTitleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Let the IME finish its composition. Some browsers report Enter as
        // keyCode 229 even when isComposing has already been cleared.
        if (!shouldMoveTitleFocusToBody({
          key: e.key,
          shiftKey: e.shiftKey,
          isComposing: e.nativeEvent.isComposing,
          keyCode: e.nativeEvent.keyCode,
        })) {
          return;
        }

        // Shift+Enter intentionally keeps the textarea's native soft-break
        // behavior. A plain Enter commits the title and starts the body.
        e.preventDefault();
        titleRef.current?.blur();
        if (editor && !editor.isDestroyed) {
          editor.commands.focus("start", { scrollIntoView: false });
        }
      },
      [editor],
    );

    return (
      <div
        ref={containerRef}
        className="web-markdown-editor-scroll-container"
        style={{
          ...containerStyle,
          visibility: fontsReady ? "visible" : "hidden",
          width: typography.textColumnWidth,
          minWidth: typography.textColumnWidth,
          maxWidth: typography.textColumnWidth,
          fontSize: typography.fontSizePx,
          lineHeight: `${typography.lineHeightPx}px`,
          letterSpacing: typography.letterSpacingPx,
          "--text-column-width": `${typography.textColumnWidth}px`,
          "--body-regular-font-family": hasCompleteBodyFontSet(fontStatusRef.current)
            ? BODY_REGULAR_FONT_FAMILY
            : "serif",
          "--body-semibold-font-family": hasCompleteBodyFontSet(fontStatusRef.current)
            ? BODY_SEMIBOLD_FONT_FAMILY
            : "serif",
          "--body-font-size": `${typography.fontSizePx}px`,
          "--body-line-height": `${typography.lineHeightPx}px`,
          "--body-paragraph-gap": `${typography.paragraphGapPx}px`,
          "--body-letter-spacing": `${typography.letterSpacingPx}px`,
          "--title-font-size": `${typography.titleFontSizePx}px`,
          "--content-bottom-padding": `${Math.max(0, contentBottomPadding)}px`,
        } as React.CSSProperties}
      >
        <style>{proseMirrorCss}</style>
        {!hideTitle && onTitleChange !== undefined && (
          <textarea
            ref={titleRef}
            defaultValue={titleValue || ""}
            placeholder="제목"
            onChange={handleTitleInput}
            onKeyDown={handleTitleKeyDown}
            rows={1}
            style={{ ...titleInputStyle, fontSize: typography.titleFontSizePx }}
            readOnly={!editable}
          />
        )}
        {belowTitleSlot}
        <EditorContent editor={editor} style={editorContentStyle} lang="ko" />
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
  backgroundColor: "#FFFFFF",
  fontFamily: `var(--body-regular-font-family, ${BODY_REGULAR_FONT_FAMILY})`,
  color: "#1A1A1A",
};

const titleInputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  fontFamily: `var(--body-semibold-font-family, ${BODY_SEMIBOLD_FONT_FAMILY})`,
  fontSize: "var(--title-font-size)",
  fontWeight: 600,
  lineHeight: 1.25,
  letterSpacing: "-0.01em",
  color: "#1A1A1A",
  backgroundColor: "#FFFFFF",
  border: "none",
  borderBottom: "1px solid #f4f4f5",
  outline: "none",
  resize: "none",
  overflow: "hidden",
  WebkitAppearance: "none",
  WebkitTapHighlightColor: "transparent",
  colorScheme: "light",
  padding: "8px 0",
  marginBottom: 12,
  boxSizing: "border-box",
};

const editorContentStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  height: "100%",
  width: "100%",
};

const editorTypographyCss = buildBodyTypographyCss({
  rootSelector: ".web-markdown-editor-scroll-container",
  blockSelector: ".ProseMirror",
  blockMargins: "spaced",
  hrStyle: "spaced",
});

const proseMirrorCss = `
${editorTypographyCss}
.web-markdown-editor-scroll-container {
  scrollbar-width: none;
  -ms-overflow-style: none;
  box-sizing: border-box;
}
.web-markdown-editor-scroll-container::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.ProseMirror {
  box-sizing: border-box;
  width: var(--text-column-width);
  max-width: 100%;
  min-height: 100%;
  padding: 16px 0 var(--content-bottom-padding);
  outline: none;
}
.ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: #a1a1aa;
  pointer-events: none;
  float: left;
  height: 0;
}
.ProseMirror code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f4f4f5; padding: 0.1em 0.3em; border-radius: 3px; letter-spacing: 0; font-size: 0.9em; }
.ProseMirror pre { background: #f4f4f5; padding: 0.75em 1em; border-radius: 4px; overflow-x: auto; margin: 0.5em 0; letter-spacing: 0; text-align: left; }
.ProseMirror pre code { background: none; padding: 0; }
textarea::placeholder { color: #a1a1aa; }
`;
