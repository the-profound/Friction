import { Editor, Extension } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Heading } from "@tiptap/extension-heading";
import { Bold } from "@tiptap/extension-bold";
import { Italic } from "@tiptap/extension-italic";
import { Blockquote } from "@tiptap/extension-blockquote";
import { BulletList } from "@tiptap/extension-list/bullet-list";
import { OrderedList } from "@tiptap/extension-list/ordered-list";
import { ListItem } from "@tiptap/extension-list/item";
import { UndoRedo } from "@tiptap/extensions/undo-redo";
import { Placeholder } from "@tiptap/extensions/placeholder";
import { Underline } from "@tiptap/extension-underline";
import { HorizontalRule } from "@tiptap/extension-horizontal-rule";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

interface OverflowRange {
  pageIndex: number;
  startCharOffset: number;
}

const overflowPluginKey = new PluginKey<DecorationSet>("overflow-highlights");

function computeOverflowDecorations(doc: PMNode, ranges: OverflowRange[]): DecorationSet {
  if (!ranges || ranges.length === 0) return DecorationSet.empty;

  // 페이지 경계: doc 의 직접 자식 중 horizontalRule 노드를 페이지 구분자로 사용한다.
  // page N 의 컨텐츠 범위 = [start, end) (HR 노드 자체는 제외)
  const pageRanges: { start: number; end: number }[] = [];
  let pageStart = 0;
  doc.forEach((node, offset) => {
    if (node.type.name === "horizontalRule") {
      pageRanges.push({ start: pageStart, end: offset });
      pageStart = offset + node.nodeSize;
    }
  });
  pageRanges.push({ start: pageStart, end: doc.content.size });

  const decorations: Decoration[] = [];
  for (const range of ranges) {
    const page = pageRanges[range.pageIndex];
    if (!page) continue;
    if (page.end <= page.start) continue;

    // 페이지 내부에서 startCharOffset 만큼의 텍스트를 건너뛴 PM position 을 찾는다.
    let charsRemaining = Math.max(0, range.startCharOffset);
    let highlightStart = -1;
    doc.nodesBetween(page.start, page.end, (node, pos) => {
      if (highlightStart >= 0) return false;
      if (!node.isText) return true;
      const text = node.text || "";
      const len = text.length;
      if (charsRemaining < len) {
        // pos 는 텍스트 노드의 시작 위치
        const candidate = pos + charsRemaining;
        const clamped = Math.min(Math.max(candidate, page.start), page.end);
        highlightStart = clamped;
        return false;
      }
      charsRemaining -= len;
      // 텍스트 노드를 모두 소비했으면 그 끝 지점을 후보로 잡아두고 다음 텍스트 노드로 넘어간다.
      // (마지막 텍스트 노드의 끝까지 다 소진됐다면 highlightStart 는 -1 로 남고 아래에서 page.start 로 폴백)
      return true;
    });

    if (highlightStart < 0) {
      // 텍스트 길이보다 startCharOffset 이 더 크면 강조할 글자가 없으므로 건너뛴다.
      continue;
    }
    if (highlightStart >= page.end) continue;

    decorations.push(
      Decoration.inline(highlightStart, page.end, { class: "overflow-highlight" }),
    );
  }

  return DecorationSet.create(doc, decorations);
}

const OverflowDecorationExtension = Extension.create({
  name: "overflowDecoration",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: overflowPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(overflowPluginKey) as
              | { ranges: OverflowRange[] | null }
              | undefined;
            if (meta) {
              return computeOverflowDecorations(tr.doc, meta.ranges || []);
            }
            // 문서가 변경됐다면 기존 데코를 새 좌표계로 매핑한다.
            // 이후 다음 setOverflowRanges 호출이 들어오면 정확히 재계산된다.
            if (tr.docChanged && old !== DecorationSet.empty) {
              return old.map(tr.mapping, tr.doc);
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            return overflowPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

const HorizontalRuleWithControls = HorizontalRule.extend({
  addNodeView() {
    // Tracks which position should show controls after a move transaction
    let activatedPos: number | undefined;

    return ({ editor, getPos }) => {
      const wrapper = document.createElement("div");
      wrapper.className = "hr-wrapper";

      const hr = document.createElement("hr");
      wrapper.appendChild(hr);

      const controls = document.createElement("div");
      controls.className = "hr-controls";
      controls.style.display = "none";

      const upBtn = document.createElement("button");
      upBtn.className = "hr-btn";
      upBtn.textContent = "↑";
      upBtn.type = "button";

      const downBtn = document.createElement("button");
      downBtn.className = "hr-btn";
      downBtn.textContent = "↓";
      downBtn.type = "button";

      controls.appendChild(upBtn);
      controls.appendChild(downBtn);
      wrapper.appendChild(controls);

      function getNodeEntries() {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos === undefined) return null;
        const { doc } = editor.state;
        const entries: { pos: number; node: ReturnType<typeof doc.child> }[] = [];
        doc.forEach((node, offset) => entries.push({ pos: offset, node }));
        const idx = entries.findIndex((e) => e.pos === pos);
        if (idx < 0) return null;
        return { pos, entries, idx };
      }

      function updateButtonStates() {
        const info = getNodeEntries();
        if (!info) return;
        upBtn.disabled = info.idx === 0;
        downBtn.disabled = info.idx >= info.entries.length - 1;
        upBtn.style.opacity = upBtn.disabled ? "0.3" : "1";
        downBtn.style.opacity = downBtn.disabled ? "0.3" : "1";
      }

      function showControls() {
        document.querySelectorAll(".hr-controls").forEach((el) => {
          if (el !== controls) (el as HTMLElement).style.display = "none";
        });
        controls.style.display = "flex";
        updateButtonStates();
      }

      // Restore controls visibility if this NodeView was just created after a move
      const initPos = typeof getPos === "function" ? getPos() : undefined;
      if (initPos !== undefined && initPos === activatedPos) {
        activatedPos = undefined;
        showControls();
      }

      // Click anywhere in the wrapper (including padding area) to show controls
      wrapper.addEventListener("click", (e) => {
        e.stopPropagation();
        if (controls.contains(e.target as Node)) return;
        showControls();
      });

      const outsideClickHandler = (e: MouseEvent) => {
        if (!wrapper.contains(e.target as Node)) {
          controls.style.display = "none";
        }
      };
      document.addEventListener("click", outsideClickHandler, true);

      upBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const info = getNodeEntries();
        if (!info || info.idx === 0) return;
        const { state, view } = editor;
        const hrNode = info.entries[info.idx].node;
        const prevEntry = info.entries[info.idx - 1];
        const prevNodeStart = prevEntry.pos;
        // New position of HR after move = prevNodeStart
        activatedPos = prevNodeStart;
        const tr = state.tr
          .insert(prevNodeStart, hrNode)
          .delete(info.pos + hrNode.nodeSize, info.pos + 2 * hrNode.nodeSize);
        view.dispatch(tr);
      });

      downBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const info = getNodeEntries();
        if (!info || info.idx >= info.entries.length - 1) return;
        const { state, view } = editor;
        const hrNode = info.entries[info.idx].node;
        const nextEntry = info.entries[info.idx + 1];
        // New position of HR after move = info.pos + nextEntry.node.nodeSize
        activatedPos = info.pos + nextEntry.node.nodeSize;
        const tr = state.tr
          .delete(info.pos, info.pos + hrNode.nodeSize)
          .insert(info.pos + nextEntry.node.nodeSize, hrNode);
        view.dispatch(tr);
      });

      return {
        dom: wrapper,
        destroy() {
          document.removeEventListener("click", outsideClickHandler, true);
        },
      };
    };
  },
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, "$1<em>$2</em>");
  out = out.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, "<u>$1</u>");
  return out;
}

function markdownToHtml(md: string): string {
  try {
    const text = (md || "").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    const blocks: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim() === "") {
        i++;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        blocks.push(`<hr>`);
        i++;
        continue;
      }

      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        i++;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quoteLines: string[] = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        const inner: string[] = [];
        let para: string[] = [];
        for (const q of quoteLines) {
          if (q.trim() === "") {
            if (para.length) {
              inner.push(`<p>${renderInline(para.join(" "))}</p>`);
              para = [];
            }
          } else {
            para.push(q);
          }
        }
        if (para.length) inner.push(`<p>${renderInline(para.join(" "))}</p>`);
        blocks.push(`<blockquote>${inner.join("")}</blockquote>`);
        continue;
      }

      const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
      if (bulletMatch) {
        const items: string[] = [];
        while (i < lines.length) {
          const m = /^[-*]\s+(.*)$/.exec(lines[i]);
          if (!m) break;
          items.push(`<li><p>${renderInline(m[1])}</p></li>`);
          i++;
        }
        blocks.push(`<ul>${items.join("")}</ul>`);
        continue;
      }

      const orderedMatch = /^\d+\.\s+(.*)$/.exec(line);
      if (orderedMatch) {
        const items: string[] = [];
        while (i < lines.length) {
          const m = /^\d+\.\s+(.*)$/.exec(lines[i]);
          if (!m) break;
          items.push(`<li><p>${renderInline(m[1])}</p></li>`);
          i++;
        }
        blocks.push(`<ol>${items.join("")}</ol>`);
        continue;
      }

      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^(#{1,3})\s+/.test(lines[i]) &&
        !/^>\s?/.test(lines[i]) &&
        !/^[-*]\s+/.test(lines[i]) &&
        !/^\d+\.\s+/.test(lines[i]) &&
        !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      const inner = paraLines
        .map((l, idx) => (idx === 0 ? renderInline(l) : "<br>" + renderInline(l)))
        .join("");
      blocks.push(`<p>${inner}</p>`);
    }

    return blocks.join("");
  } catch {
    return `<p>${escapeHtml(md || "")}</p>`;
  }
}

function htmlToMarkdown(html: string): string {
  try {
    const container = document.createElement("div");
    container.innerHTML = html || "";

    function inlineMd(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent || "").replace(/([\\`*_])/g, "\\$1");
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const inner = childrenToInline(el);
      if (tag === "strong" || tag === "b") return `**${inner}**`;
      if (tag === "em" || tag === "i") return `*${inner}*`;
      if (tag === "u") return `<u>${inner}</u>`;
      if (tag === "br") return "  \n";
      return inner;
    }

    function childrenToInline(el: HTMLElement): string {
      let out = "";
      for (const child of Array.from(el.childNodes)) {
        out += inlineMd(child);
      }
      return out;
    }

    function blockMd(el: HTMLElement, depth: number): string {
      const tag = el.tagName.toLowerCase();
      if (tag === "hr") return `---\n\n`;
      if (tag === "h1") return `# ${childrenToInline(el)}\n\n`;
      if (tag === "h2") return `## ${childrenToInline(el)}\n\n`;
      if (tag === "h3") return `### ${childrenToInline(el)}\n\n`;
      if (tag === "p") {
        const txt = childrenToInline(el);
        if (!txt.trim()) return "\n";
        const escaped = txt.replace(/^([#>\-])/, "\\$1");
        return `${escaped}\n\n`;
      }
      if (tag === "ul" || tag === "ol") {
        const items = Array.from(el.children).filter(
          (c) => c.tagName.toLowerCase() === "li",
        ) as HTMLElement[];
        let out = "";
        items.forEach((li, idx) => {
          const marker = tag === "ul" ? "- " : `${idx + 1}. `;
          let liContent = "";
          for (const child of Array.from(li.childNodes)) {
            if (child.nodeType === Node.ELEMENT_NODE) {
              const ce = child as HTMLElement;
              const ct = ce.tagName.toLowerCase();
              if (ct === "ul" || ct === "ol") {
                liContent += "\n" + blockMd(ce, depth + 1).replace(/\n+$/, "");
              } else if (ct === "p") {
                liContent += childrenToInline(ce);
              } else {
                liContent += inlineMd(child);
              }
            } else {
              liContent += inlineMd(child);
            }
          }
          out += `${marker}${liContent.trim()}\n`;
        });
        return out + (depth === 0 ? "\n" : "");
      }
      if (tag === "blockquote") {
        let inner = "";
        for (const child of Array.from(el.children)) {
          inner += blockMd(child as HTMLElement, depth);
        }
        if (!inner) inner = childrenToInline(el) + "\n";
        const quoted = inner
          .replace(/\n+$/, "")
          .split("\n")
          .map((l) => `> ${l}`.trimEnd())
          .join("\n");
        return `${quoted}\n\n`;
      }
      return childrenToInline(el) + "\n\n";
    }

    let md = "";
    for (const child of Array.from(container.children)) {
      md += blockMd(child as HTMLElement, 0);
    }
    return md.replace(/\n{3,}/g, "\n\n").trimEnd();
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
  ranges?: OverflowRange[] | null;
  text?: string;
  fontSizePx?: number;
  letterSpacingPx?: number;
}

(function () {
  let editor: Editor | null = null;
  let titleInput: HTMLTextAreaElement | null = null;
  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  const CHANGE_THROTTLE_MS = 400;

  let titleFocused = false;
  let editorFocused = false;
  let keyboardOpen = false;
  let syncScheduled = false;

  function syncKeyboardState() {
    if (syncScheduled) return;
    syncScheduled = true;
    Promise.resolve().then(() => {
      syncScheduled = false;
      const next = titleFocused || editorFocused;
      if (next !== keyboardOpen) {
        keyboardOpen = next;
        postToRN({ type: keyboardOpen ? "onKeyboardShow" : "onKeyboardHide" });
      }
    });
  }

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
        Document,
        Paragraph,
        Text,
        Heading.configure({ levels: [1, 2, 3] }),
        Bold,
        Italic,
        Underline,
        Blockquote,
        HorizontalRuleWithControls,
        BulletList,
        OrderedList,
        ListItem,
        UndoRedo,
        Placeholder.configure({ placeholder }),
        OverflowDecorationExtension,
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
      onFocus: () => {
        editorFocused = true;
        syncKeyboardState();
      },
      onBlur: () => {
        editorFocused = false;
        syncKeyboardState();
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
        case "setSourceArticleSlot": {
          const s = document.getElementById("source-article-slot");
          if (s) {
            const text = cmd.text || "";
            if (text) {
              s.textContent = text;
              (s as HTMLElement).style.display = "block";
            } else {
              (s as HTMLElement).style.display = "none";
            }
          }
          break;
        }
        case "setOverflowRanges": {
          if (editor && !editor.isDestroyed) {
            const ranges = cmd.ranges || [];
            const tr = editor.state.tr.setMeta(overflowPluginKey, { ranges });
            editor.view.dispatch(tr);
          }
          break;
        }
        case "setBodyMetrics": {
          const root = document.documentElement;
          if (cmd.fontSizePx != null) {
            root.style.setProperty("--body-font-size", cmd.fontSizePx + "px");
          }
          if (cmd.letterSpacingPx != null) {
            root.style.setProperty("--body-letter-spacing", cmd.letterSpacingPx + "px");
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
    const slotEl = document.getElementById("source-article-slot");
    if (slotEl) {
      slotEl.addEventListener("click", function () {
        postToRN({ type: "onSourceArticleSlotTap" });
      });
    }

    titleInput = document.getElementById("title-input") as HTMLTextAreaElement | null;
    if (titleInput) {
      titleInput.addEventListener("input", function () {
        autoResizeTitle();
        postToRN({ type: "onTitleChange", payload: { title: titleInput!.value } });
      });
      titleInput.addEventListener("focus", function () {
        titleFocused = true;
        syncKeyboardState();
      });
      titleInput.addEventListener("blur", function () {
        titleFocused = false;
        syncKeyboardState();
      });
    }

    function isEditorElement(el: EventTarget | null): boolean {
      if (!el || !(el instanceof Element)) return false;
      return el.id === "title-input" || !!el.closest(".ProseMirror");
    }

    document.addEventListener("focusin", function (e) {
      if (!isEditorElement(e.target)) return;
      const target = e.target as Element;
      if (target.id === "title-input") {
        titleFocused = true;
      } else {
        editorFocused = true;
      }
      syncKeyboardState();
    });

    document.addEventListener("focusout", function (e) {
      if (!isEditorElement(e.target)) return;
      const target = e.target as Element;
      if (target.id === "title-input") {
        titleFocused = false;
      } else {
        editorFocused = false;
      }
      syncKeyboardState();
    });

    let swipeStartY = 0;
    let swipeDismissed = false;
    const SWIPE_THRESHOLD = 48;

    document.addEventListener("touchstart", function (e) {
      swipeStartY = e.touches[0].clientY;
      swipeDismissed = false;
    }, { passive: true });

    document.addEventListener("touchmove", function (e) {
      if (swipeDismissed) return;
      if (!keyboardOpen) return;
      if (window.scrollY > 0) return;
      const dy = e.touches[0].clientY - swipeStartY;
      if (dy > SWIPE_THRESHOLD) {
        swipeDismissed = true;
        postToRN({ type: "onSwipeDownToDismiss" });
      }
    }, { passive: true });

    document.addEventListener("touchend", function () {
      swipeDismissed = false;
    }, { passive: true });
  });
})();
