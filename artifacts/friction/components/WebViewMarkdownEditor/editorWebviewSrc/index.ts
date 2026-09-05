import { Editor, Extension, Node as TipTapNode } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
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
import { HardBreak } from "@tiptap/extension-hard-break";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMSerializer } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";
import { computeEditorViewportScrollTop } from "../../../lib/editorViewport";
import type { BodyTypographyMetrics } from "../../../lib/bodyLayout";
import { shouldApplyBodyTypographyGeneration } from "../../../lib/bodyTypographyDiagnostics";
import { BODY_FONT_FALLBACK_PROBE_TEXT } from "../../shared/bodyTypographyFonts";
import { normalizePageDividersForMarkdownParser } from "../../../lib/pageDividerMarkdown";
import { splitLeadingH1Markdown } from "../../../utils/leadingH1";
import { handleTitleEnter, insertTitleSoftBreak } from "../titleKeyboardContract";
import { createHeadingWithParagraphShortcut } from "../headingKeyboardShortcuts";
import {
  createEditorSurfaceTouchSession,
  isBlankEditorSurfaceTarget,
  isStationaryBlankSurfaceTap,
  updateEditorSurfaceTouchSession,
  type EditorSurfaceTouchSession,
} from "../editorSurfaceTouch";

interface OverflowRange {
  pageIndex: number;
  startCharOffset: number;
}

const overflowPluginKey = new PluginKey<DecorationSet>("overflow-highlights");

// ─── Spell Highlight Plugin ───────────────────────────────────────────────────
// Persistent Decoration.inline for the currently-reviewed spell suggestion.
// Stored in plugin state so it tracks doc changes via ProseMirror mapping.
const spellHighlightPluginKey = new PluginKey<{ from: number; to: number } | null>("spell-highlight");

const SpellHighlightExtension = Extension.create({
  name: "spellHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<{ from: number; to: number } | null>({
        key: spellHighlightPluginKey,
        state: {
          init: () => null,
          apply(tr, prev) {
            const meta = tr.getMeta(spellHighlightPluginKey) as
              | { from: number; to: number }
              | "clear"
              | undefined;
            if (meta === "clear") return null;
            if (meta && typeof meta === "object") return meta;
            if (tr.docChanged && prev) {
              const from = tr.mapping.map(prev.from);
              const to = tr.mapping.map(prev.to);
              return from < to ? { from, to } : null;
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            const range = spellHighlightPluginKey.getState(state);
            if (!range) return DecorationSet.empty;
            try {
              return DecorationSet.create(state.doc, [
                Decoration.inline(range.from, range.to, { class: "spell-highlight" }),
              ]);
            } catch {
              return DecorationSet.empty;
            }
          },
        },
      }),
    ];
  },
});

// 페이지 경계: doc 의 직접 자식 중 horizontalRule 노드를 페이지 구분자로 사용한다.
// page N 의 컨텐츠 범위 = [start, end) (HR 노드 자체는 제외)
function getPageRanges(doc: PMNode): { start: number; end: number }[] {
  const pageRanges: { start: number; end: number }[] = [];
  let pageStart = 0;
  doc.forEach((node, offset) => {
    if (node.type.name === "horizontalRule") {
      pageRanges.push({ start: pageStart, end: offset });
      pageStart = offset + node.nodeSize;
    }
  });
  pageRanges.push({ start: pageStart, end: doc.content.size });
  return pageRanges;
}

// PM position 을 "페이지 시작점부터의 plain-text char offset" 으로 변환.
// computeOverflowDecorations 의 startCharOffset 해석과 정확히 정합되어야 한다.
function pmPosToPageCharOffset(doc: PMNode, pageStart: number, pos: number): number {
  let charOffset = 0;
  doc.nodesBetween(pageStart, pos, (node, p) => {
    if (!node.isText) return true;
    const overlapStart = Math.max(p, pageStart);
    const overlapEnd = Math.min(p + node.nodeSize, pos);
    if (overlapEnd > overlapStart) {
      charOffset += overlapEnd - overlapStart;
    }
    return true;
  });
  return charOffset;
}

function computeOverflowDecorations(doc: PMNode, ranges: OverflowRange[]): DecorationSet {
  if (!ranges || ranges.length === 0) return DecorationSet.empty;

  const pageRanges = getPageRanges(doc);

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

// SelectionStabilityExtension
// 문제: TipTap/ProseMirror 에디터에서 텍스트를 드래그로 선택한 후,
//       가벼운 탭(touchstart → touchend, 이동 없음) 한 번으로 선택이 해제됨.
// 해결: 비어있지 않은 선택 영역이 있을 때 선택 범위 내부에서의 단순 탭을
//       가로채 ProseMirror 의 mousedown/pointerdown 핸들러가 선택을 collapse 하지 못하게 막는다.
//       선택 범위 외부를 탭하거나 드래그하는 경우는 평소와 동일하게 동작한다.
//       Guard는 300ms timeout으로 자동 소멸해 pointerdown/mousedown이 합성되지 않는
//       플랫폼 경로에서도 상태가 남지 않는다.
const SelectionStabilityExtension = Extension.create({
  name: "selectionStability",
  addProseMirrorPlugins() {
    const TAP_MOVE_THRESHOLD_PX = 10;
    const GUARD_EXPIRE_MS = 300;

    let touchStartX = 0;
    let touchStartY = 0;
    let hadNonEmptySelection = false;
    let selectionFrom = 0;
    let selectionTo = 0;
    let pendingSelectionGuard = false;
    let guardExpireTimer: ReturnType<typeof setTimeout> | null = null;

    function setGuard() {
      if (guardExpireTimer) clearTimeout(guardExpireTimer);
      pendingSelectionGuard = true;
      guardExpireTimer = setTimeout(() => {
        pendingSelectionGuard = false;
        guardExpireTimer = null;
      }, GUARD_EXPIRE_MS);
    }

    function consumeGuard(event: Event) {
      if (!pendingSelectionGuard) return false;
      if (guardExpireTimer) {
        clearTimeout(guardExpireTimer);
        guardExpireTimer = null;
      }
      pendingSelectionGuard = false;
      event.preventDefault();
      return true;
    }

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            touchstart: (view, event) => {
              pendingSelectionGuard = false;
              if (guardExpireTimer) {
                clearTimeout(guardExpireTimer);
                guardExpireTimer = null;
              }
              const sel = view.state.selection;
              hadNonEmptySelection = !sel.empty;
              if (!sel.empty && event.touches.length === 1) {
                touchStartX = event.touches[0].clientX;
                touchStartY = event.touches[0].clientY;
                selectionFrom = sel.from;
                selectionTo = sel.to;
              } else {
                hadNonEmptySelection = false;
              }
              return false;
            },
            touchend: (view, event) => {
              if (!hadNonEmptySelection || event.changedTouches.length === 0) {
                return false;
              }
              const t = event.changedTouches[0];
              const dx = Math.abs(t.clientX - touchStartX);
              const dy = Math.abs(t.clientY - touchStartY);
              if (dx < TAP_MOVE_THRESHOLD_PX && dy < TAP_MOVE_THRESHOLD_PX) {
                // 단순 탭 — 탭 위치가 선택 범위 내부인지 확인
                const pos = view.posAtCoords({ left: t.clientX, top: t.clientY });
                if (pos && pos.pos >= selectionFrom && pos.pos <= selectionTo) {
                  setGuard();
                }
              }
              hadNonEmptySelection = false;
              return false;
            },
            // pointerdown: PointerEvent API (모던 브라우저 / 일부 플랫폼에서 mousedown 대신 발생)
            pointerdown: (_view, event) => {
              return consumeGuard(event);
            },
            // mousedown: 레거시 합성 이벤트 (iOS WKWebView 포함)
            mousedown: (_view, event) => {
              return consumeGuard(event);
            },
          },
        },
      }),
    ];
  },
});

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

// Module-level state: tracks whether any hr-control panel is currently visible.
// Both the NodeView (HorizontalRuleWithControls) and the IIFE event-setup block
// share this state to coordinate blocking of text-editor focus.
let _hrBlockActive = false;
let _hrActiveHide: (() => void) | null = null;

function _activateHrBlock(hideControls: () => void): void {
  _hrBlockActive = true;
  _hrActiveHide = hideControls;
}

function _deactivateHrBlock(): void {
  _hrBlockActive = false;
  _hrActiveHide = null;
}

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

      const moveGroup = document.createElement("div");
      moveGroup.className = "hr-move-group";
      moveGroup.appendChild(upBtn);
      moveGroup.appendChild(downBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "hr-btn hr-btn-delete";
      deleteBtn.textContent = "✕";
      deleteBtn.type = "button";

      controls.appendChild(moveGroup);
      controls.appendChild(deleteBtn);
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

      function hideControls() {
        controls.style.display = "none";
        // Only clear the global block state when this NodeView owns it.
        // Other NodeViews' outsideClickHandlers also call hideControls() when
        // their wrappers don't contain the click target — but their controls
        // are already hidden (display:none), so they must not clear the block
        // state that belongs to whichever NodeView is actually active.
        if (_hrActiveHide === hideControls) {
          _deactivateHrBlock();
        }
      }

      function showControls() {
        // Hide any other open hr-controls panels first
        document.querySelectorAll(".hr-controls").forEach((el) => {
          if (el !== controls) (el as HTMLElement).style.display = "none";
        });
        controls.style.display = "flex";
        updateButtonStates();
        // Blur the editor so the keyboard is dismissed. The editor's onBlur
        // callback will set editorFocused=false and call syncKeyboardState(),
        // which naturally posts onKeyboardHide to React Native.
        editor.commands.blur();
        // Register this panel as the active hr block so the document-level
        // touch/mouse interceptor can close it if the user taps outside.
        _activateHrBlock(hideControls);
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
          hideControls();
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
        // Dispatch may restore editor focus — blur again to keep keyboard dismissed.
        editor.commands.blur();
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
        // Dispatch may restore editor focus — blur again to keep keyboard dismissed.
        editor.commands.blur();
      });

      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos === undefined) return;
        const { state, view } = editor;
        const hrNode = state.doc.nodeAt(pos);
        if (!hrNode) return;
        const tr = state.tr.delete(pos, pos + hrNode.nodeSize);
        view.dispatch(tr);
        editor.commands.blur();
      });

      return {
        dom: wrapper,
        destroy() {
          document.removeEventListener("click", outsideClickHandler, true);
          // If this NodeView is destroyed while its panel is active, clean up
          if (_hrActiveHide === hideControls) {
            _deactivateHrBlock();
          }
        },
      };
    };
  },
});

const QuestionBlock = TipTapNode.create({
  name: "questionBlock",
  group: "block",
  content: "block+",
  parseHTML() {
    return [{ tag: "div.tiptap-question-block" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, class: "tiptap-question-block" }, 0];
  },
});

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
    return [{ tag: 'img[data-inline="true"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, string> = {
      "data-inline": "true",
      class: "tiptap-inline-image",
      src: getInlineImageDisplayUrl(HTMLAttributes.originalSrc ?? HTMLAttributes.src ?? ""),
      alt: HTMLAttributes.alt ?? "",
    };
    if (HTMLAttributes["data-autosplit"]) {
      attrs["data-autosplit"] = HTMLAttributes["data-autosplit"];
    }
    if (HTMLAttributes.originalSrc ?? HTMLAttributes.src) {
      attrs["data-original-src"] = HTMLAttributes.originalSrc ?? HTMLAttributes.src;
    }
    return ["img", attrs];
  },
});

function getInlineImageDisplayUrl(originalUrl: string): string {
  const match = /^(https?:\/\/[^/]+)\/storage\/v1\/object\/public\/([^?]+)$/.exec(originalUrl);
  if (!match) return originalUrl;
  const width = Math.max(1, Math.min(1600, Math.round(240 * window.devicePixelRatio)));
  return `${match[1]}/storage/v1/render/image/public/${match[2]}?width=${width}&resize=contain&quality=80`;
}

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

// 마크다운 텍스트에서 이미지 마커를 기준으로 텍스트/이미지 세그먼트로 분리한다.
// 이미지는 블록 레벨 노드이므로 단락 안에 섞여있을 때 별도 블록으로 분리해야 한다.
type MdSegment =
  | { type: "text"; content: string }
  | { type: "image"; url: string; alt: string };

function splitByImages(text: string): MdSegment[] {
  const result: MdSegment[] = [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      result.push({ type: "text", content: text.slice(lastIndex, m.index) });
    }
    result.push({ type: "image", alt: m[1], url: m[2] });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    result.push({ type: "text", content: text.slice(lastIndex) });
  }
  return result;
}

function markdownToHtml(md: string, ensureTrailingParagraph = true): string {
  try {
    const text = normalizePageDividersForMarkdownParser(md || "");
    const leadingH1 = splitLeadingH1Markdown(text);
    const lines = (leadingH1?.body ?? text).split("\n");
    const blocks: string[] = [];
    if (leadingH1) {
      const titleHtml = leadingH1.titleMarkdown
        .split(/ {2}\n/)
        .map(renderInline)
        .join("<br>");
      blocks.push(`<h1>${titleHtml}</h1>`);
    }
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
        // 내용 없는 ">" 라인(과거 데이터에 남은 빈 인용)은 빈 blockquote 로
        // 만들지 않고 빈 단락으로 치환한다 — 빈 blockquote 는 회색 세로줄만
        // 남기는 잔상이 된다.
        if (inner.length > 0) {
          blocks.push(`<blockquote>${inner.join("")}</blockquote>`);
        } else {
          blocks.push("<p></p>");
        }
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

      if (/^Q\.\s+/.test(line)) {
        const questionLines: string[] = [];
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          !/^(#{1,3})\s+/.test(lines[i]) &&
          !/^>\s?/.test(lines[i]) &&
          !/^[-*]\s+/.test(lines[i]) &&
          !/^\d+\.\s+/.test(lines[i]) &&
          !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
        ) {
          questionLines.push(lines[i]);
          i++;
        }
        const firstText = questionLines[0].replace(/^Q\.\s+/, "");
        const allText = [firstText, ...questionLines.slice(1)].join(" ");
        blocks.push(`<div class="tiptap-question-block"><p>${renderInline(allText)}</p></div>`);
        continue;
      }

      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^Q\.\s+/.test(lines[i]) &&
        !/^(#{1,3})\s+/.test(lines[i]) &&
        !/^>\s?/.test(lines[i]) &&
        !/^[-*]\s+/.test(lines[i]) &&
        !/^\d+\.\s+/.test(lines[i]) &&
        !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      // 단락 내 이미지 마커를 블록 레벨로 분리한다.
      // 이미지가 없으면 기존 경로(inline br 유지)로 처리한다.
      const paraContent = paraLines.join(" ");
      const segments = splitByImages(paraContent);
      const hasImages = segments.some((s) => s.type === "image");
      if (!hasImages) {
        const inner = paraLines
          .map((l, idx) => (idx === 0 ? renderInline(l) : "<br>" + renderInline(l)))
          .join("");
        blocks.push(`<p>${inner}</p>`);
      } else {
        for (const seg of segments) {
          if (seg.type === "image") {
            blocks.push(
              `<img data-inline="true" class="tiptap-inline-image" src="${escapeHtml(seg.url)}" alt="${escapeHtml(seg.alt)}" />`
            );
          } else {
            const trimmed = seg.content.trim();
            if (trimmed) blocks.push(`<p>${renderInline(trimmed)}</p>`);
          }
        }
      }
    }

    // 마지막 블록이 단락(<p>)이 아닌 경우(예: blockquote, 리스트, 헤딩으로 문서가
    // 끝나는 경우) 그 아래를 탭해도 커서를 잡을 ProseMirror 노드가 없어 입력이
    // 불가능해진다. 기존 편집기는 항상 빈 단락을 마지막에 보장한다.
    const last = blocks[blocks.length - 1];
    if (ensureTrailingParagraph && (!last || !/<\/p>$/.test(last))) {
      blocks.push("<p></p>");
    }

    return blocks.join("");
  } catch {
    return `<p>${escapeHtml(md || "")}</p>`;
  }
}

function htmlToMarkdown(html: string, onError?: (error: unknown) => void): string {
  try {
    const container = document.createElement("div");
    container.innerHTML = html || "";

    function inlineMd(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || "";
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const inner = childrenToInline(el);
      if (tag === "strong" || tag === "b") return `**${inner}**`;
      if (tag === "em" || tag === "i") return `*${inner}*`;
      if (tag === "u") return `<u>${inner}</u>`;
      if (tag === "br") return "  \n";
      if (tag === "img" && el.getAttribute("data-inline") === "true") {
        const src = el.getAttribute("data-original-src") || el.getAttribute("src") || "";
        const alt = el.getAttribute("alt") || "";
        return /^https?:\/\//i.test(src) ? `![${alt}](${src})` : "";
      }
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
      if (tag === "img" && el.getAttribute("data-inline") === "true") {
        const src = el.getAttribute("data-original-src") || el.getAttribute("src") || "";
        const alt = el.getAttribute("alt") || "";
        return /^https?:\/\//i.test(src) ? `![${alt}](${src})\n\n` : "";
      }
      if (tag === "hr") return `---\n\n`;
      if (tag === "h1") return `# ${childrenToInline(el)}\n\n`;
      if (tag === "h2") return `## ${childrenToInline(el)}\n\n`;
      if (tag === "h3") return `### ${childrenToInline(el)}\n\n`;
      if (tag === "p") {
        const txt = childrenToInline(el);
        if (!txt.trim()) return "\n";
        return `${txt}\n\n`;
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
      if (tag === "div" && el.classList.contains("tiptap-question-block")) {
        let inner = "";
        for (const child of Array.from(el.children)) {
          inner += blockMd(child as HTMLElement, depth);
        }
        const text = inner.replace(/\n+$/, "").trim();
        return `Q. ${text}\n\n`;
      }
      if (tag === "blockquote") {
        let inner = "";
        for (const child of Array.from(el.children)) {
          inner += blockMd(child as HTMLElement, depth);
        }
        if (!inner) inner = childrenToInline(el) + "\n";
        const body = inner.replace(/\n+$/, "");
        // 내용이 없는(사용자가 인용을 켰지만 아무것도 입력하지 않은) 빈
        // 인용은 마크다운으로 내보내지 않는다. ">"만 남기면 다음 라운드트립
        // 에서 빈 blockquote 가 재생성되어 회색 세로줄이 계속 남는 버그가 된다.
        if (!body.trim()) return "\n";
        const quoted = body
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
  } catch (error) {
    onError?.(error);
    return "";
  }
}

// 모든 RN 송신은 webViewBridgeShim 이 head 단계에서 깔아준 window.__rnBridge.post 로
// 통과시킨다. fallback 으로 직접 ReactNativeWebView.postMessage 를 호출하여
// shim 미주입 환경(테스트/구버전 HTML)에서도 동작을 유지한다.
function postToRN(event: object) {
  try {
    const w = window as unknown as {
      __rnBridge?: { post?: (ev: object) => void };
      ReactNativeWebView?: { postMessage: (s: string) => void };
    };
    if (w.__rnBridge && typeof w.__rnBridge.post === "function") {
      w.__rnBridge.post(event);
      return;
    }
    const rn = w.ReactNativeWebView;
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
  editorSessionId?: string;
  hideTitle?: boolean;
  ensureTrailingParagraph?: boolean;
  typography?: BodyTypographyMetrics;
  layoutGeneration?: number;
}

interface Command {
  type: string;
  payload?: InitPayload;
  markdown?: string;
  ensureTrailingParagraph?: boolean;
  focusAtStart?: boolean;
  title?: string;
  requestId?: string;
  isEditable?: boolean;
  ranges?: OverflowRange[] | null;
  availableContentHeightPx?: number | null;
  autoSplit?: boolean;
  mode?: "fallback";
  paddingPx?: number;
  text?: string;
  metrics?: BodyTypographyMetrics;
  layoutGeneration?: number;
  blockType?: string;
  mark?: string;
  pageIndex?: number;
  blockIndex?: number;
  original?: string;
  replacement?: string;
  contextHint?: string;
  occurrenceIndex?: number;
}

// ─── Spell range finder (boundary-safe) ──────────────────────────────────────
// Maps (original, contextHint, occurrenceIndex) → { from, to } PM position range.
//
// Design invariant: matches are only found WITHIN a single block node. No match
// may span a paragraph/heading/list-item boundary. This prevents accidental
// cross-node replacements that would structurally alter the document.
//
// Position mapping: text-node walking inside each block gives exact PM positions.
// Joining only within-block text nodes (not across blocks) makes indexOf safe.

interface TextSegment {
  text: string;
  pmStart: number; // PM position of the first character of this segment
}

interface BlockCandidate {
  segs: TextSegment[];
  blockText: string;
  localOffset: number; // offset of `original` within blockText
}

// Walk a single block node's text nodes and collect segments with exact PM positions.
function collectBlockSegments(blockNode: PMNode, blockOffset: number): TextSegment[] {
  const segs: TextSegment[] = [];
  blockNode.nodesBetween(0, blockNode.content.size, (node, pos) => {
    if (node.isText && node.text) {
      // pos is relative to blockNode; PM position = blockOffset + 1 (opener) + pos
      segs.push({ text: node.text, pmStart: blockOffset + 1 + pos });
    }
    return true;
  });
  return segs;
}

// Map a within-block character offset to a PM position using the block's segments.
function localOffsetToPmPos(segs: TextSegment[], offset: number): number {
  let rem = offset;
  for (const seg of segs) {
    if (rem <= seg.text.length) return seg.pmStart + rem;
    rem -= seg.text.length;
  }
  if (segs.length === 0) return 0;
  const last = segs[segs.length - 1];
  return last.pmStart + last.text.length;
}

// occurrenceIndex: 0-based index among all within-block occurrences of `original`.
// Disambiguation priority:
//  1. contextHint found inside a block → prefer occurrences in that block.
//     If the context window uniquely identifies one occurrence, use it.
//  2. occurrenceIndex as tiebreaker (clamped to available count).
function spellFindRange(
  doc: PMNode,
  original: string,
  contextHint: string,
  occurrenceIndex = 0,
): { from: number; to: number } | null {
  if (!original) return null;

  // Collect all within-block occurrences
  const candidates: BlockCandidate[] = [];

  doc.forEach((blockNode, blockOffset) => {
    // Skip non-content nodes (e.g. horizontalRule)
    if (!blockNode.isTextblock && blockNode.content.size === 0) return;
    const segs = collectBlockSegments(blockNode, blockOffset);
    if (segs.length === 0) return;
    const blockText = segs.map((s) => s.text).join("");
    let si = 0;
    while (true) {
      const idx = blockText.indexOf(original, si);
      if (idx < 0) break;
      candidates.push({ segs, blockText, localOffset: idx });
      si = idx + 1;
    }
  });

  if (candidates.length === 0) return null;

  let chosen: BlockCandidate;

  if (candidates.length === 1) {
    chosen = candidates[0];
  } else {
    // Try to use contextHint to narrow down candidates
    let resolved: BlockCandidate | null = null;

    if (contextHint) {
      // Find candidates whose blockText contains contextHint
      const inCtx = candidates.filter((c) => {
        const ctxPos = c.blockText.indexOf(contextHint);
        if (ctxPos < 0) return false;
        const ctxEnd = ctxPos + contextHint.length;
        // The occurrence must start inside the context window
        return c.localOffset >= ctxPos && c.localOffset + original.length <= ctxEnd;
      });

      if (inCtx.length === 1) {
        resolved = inCtx[0];
      } else if (inCtx.length > 1) {
        // Multiple inside window: use occurrenceIndex within this subset
        resolved = inCtx[Math.min(occurrenceIndex, inCtx.length - 1)];
      }
      // inCtx.length === 0 → contextHint doesn't narrow; fall through to occurrenceIndex
    }

    chosen = resolved ?? candidates[Math.min(occurrenceIndex, candidates.length - 1)];
  }

  const from = localOffsetToPmPos(chosen.segs, chosen.localOffset);
  const to = localOffsetToPmPos(chosen.segs, chosen.localOffset + original.length);
  return from < to ? { from, to } : null;
}

(function () {
  let editor: Editor | null = null;
  let titleInput: HTMLTextAreaElement | null = null;
  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  const CHANGE_THROTTLE_MS = 400;

  // ── 본문 동기화 핫패스 캐시 ──
  // setMarkdown / requestExportMarkdown 의 markdown↔HTML 전체 변환과
  // ProseMirror 전체 setContent 는 본문이 길수록 가장 큰 비용이라
  // 다음 캐시들로 중복 작업을 건너뛴다.
  //
  //   lastAppliedMarkdown
  //     마지막으로 setContent 한 markdown 의 정규화된 사본.
  //     동일한 markdown 으로 setMarkdown 이 다시 들어오면 setContent 자체를 생략한다.
  //
  //   lastExportedMarkdown / lastExportedDocVersion
  //     마지막 export 가 성공한 시점의 markdown 과 그때의 docChanged 카운터.
  //     이후 doc 이 변하지 않았으면 htmlToMarkdown 변환을 생략하고 캐시를 반환한다.
  //
  //   docChangeCounter
  //     onUpdate 의 transaction.docChanged 마다 증가. lastExportedDocVersion 비교에 사용.
  //
  let lastAppliedMarkdown: string | null = null;
  let lastExportedMarkdown = "";
  let lastExportedDocVersion = -1;
  let docChangeCounter = 0;
  let editorSessionId = "";
  // Tracks whether the next docChanged transaction is from a programmatic
  // setMarkdown/setContent call (not user input). When true, onUpdate skips
  // the onChange emission so the RN side doesn't start an autosave debounce
  // for an unchanged document.
  let programmaticUpdatePending = false;

  // 멱등 처리용 캐시 — 같은 값을 재전송한 경우 비싼 DOM/style 작업을 스킵한다.
  let lastEditable: boolean | null = null;
  let lastTextColumnWidth: number | null = null;
  let lastBodyFontSizePx: number | null = null;
  let lastBodyLineHeightPx: number | null = null;
  let lastBodyParagraphGapPx: number | null = null;
  let lastBodyLetterSpacingPx: number | null = null;
  let lastTitleFontSizePx: number | null = null;
  let lastLayoutGeneration = -1;

  // 오버플로 강조 측정 — RN 이 setOverflowProbeConfig 로 안전 영역 높이를
  // 알려주면 에디터가 자기 DOM 을 walk 해서 각 페이지(HR 분할)에서 안전 영역을
  // 처음 벗어나는 PM position 을 찾고 [그 위치 ~ 페이지 끝] 을 강조한다.
  // RN 측 측정 레이어(WebViewMeasureLayer) 의 margin/padding 가정과 무관하게
  // 항상 에디터의 실제 시각 레이아웃과 정확히 일치한다.
  let overflowAvailableContentHeight: number | null = null;
  // true면 오버플로 감지 시 빨간 강조 대신 문서를 잘라 다음 페이지로 넘기는
  // "자동 페이지 분할" 이벤트를 RN 으로 보낸다(메모 모드 전용). 검토/분할
  // 모드(on-01)의 기존 강조 동작은 이 값이 false 일 때와 동일하게 유지된다.
  let overflowAutoSplit = false;
  // 같은 overflowPos 에 대해 분할 이벤트를 중복 전송하지 않기 위한 가드.
  // RN 이 setMarkdown 으로 잘라낸 내용을 반영하면 문서가 바뀌어 다음 probe 에서
  // 자연히 초기화된다(overflowPos 가 없어지거나 달라짐).
  let lastAutoSplitPos: number | null = null;
  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  let probeRafId: number | null = null;
  const PROBE_DEBOUNCE_MS = 80;
  // runOverflowProbe 결과(decoration 트랜잭션)는 동일 ranges 면 재dispatch 하지 않는다.
  // setMarkdown 등 docChanged 후에는 무조건 1회 재dispatch 가 필요하므로 키를 비워둔다.
  let lastProbeRangesKey: string | null = "";
  function rangesKey(ranges: OverflowRange[]): string {
    let k = "";
    for (const r of ranges) {
      k += r.pageIndex + ":" + r.startCharOffset + "|";
    }
    return k;
  }

  function scheduleOverflowProbe(delay: number = PROBE_DEBOUNCE_MS) {
    // probe 비활성 (작성 탭 등) 일 때는 doc 변경 핫패스에서 빈 ranges 트랜잭션을
    // 매번 dispatch 하지 않도록 타이머 자체를 걸지 않는다. ProseMirror 트랜잭션은
    // 본문이 길수록 비용이 커서 입력 멈춤의 한 원인이 된다.
    if (overflowAvailableContentHeight == null) return;
    if (probeTimer) clearTimeout(probeTimer);
    if (probeRafId != null) {
      cancelAnimationFrame(probeRafId);
      probeRafId = null;
    }
    probeTimer = setTimeout(() => {
      probeTimer = null;
      // setTimeout 만으로는 한 프레임 내 여러 doc 변경/메트릭 변경을 합치지 못한다.
      // rAF 한 단계를 더 끼워 한 프레임 내 호출을 1회 측정으로 coalesce.
      probeRafId = requestAnimationFrame(() => {
        probeRafId = null;
        runOverflowProbe();
      });
    }, delay);
  }

  // 문서를 splitPos 기준으로 앞/뒤 두 조각으로 잘라 각각 markdown 문자열로
  // 변환해 RN 으로 보낸다(메모 모드의 "타이핑 중 오버플로 → 다음 페이지로
  // 자동 이동" 용). ProseMirror 슬라이스를 DOMSerializer 로 실제 DOM 조각을
  // 만든 뒤, 기존 htmlToMarkdown() 변환 파이프라인을 그대로 재사용한다.
  function emitOverflowSplit(doc: PMNode, splitPos: number) {
    if (!editor || editor.isDestroyed) return;
    try {
      const before = doc.cut(0, splitPos);
      const after = doc.cut(splitPos, doc.content.size);
      const serializer = DOMSerializer.fromSchema(editor.schema);
      const beforeDiv = document.createElement("div");
      beforeDiv.appendChild(serializer.serializeFragment(before.content));
      const afterDiv = document.createElement("div");
      afterDiv.appendChild(serializer.serializeFragment(after.content));
      postToRN({
        type: "onOverflowSplit",
        payload: {
          beforeMarkdown: htmlToMarkdown(beforeDiv.innerHTML),
          afterMarkdown: htmlToMarkdown(afterDiv.innerHTML),
        },
      });
    } catch (e) {
      postToRN({ type: "onError", payload: { code: "OVERFLOW_SPLIT_FAIL", message: String(e) } });
    }
  }

  function runOverflowProbe() {
    probeTimer = null;
    if (!editor || editor.isDestroyed) return;
    const avail = overflowAvailableContentHeight;
    if (avail == null || !(avail > 0)) return;

    const view = editor.view;
    const doc = editor.state.doc;
    const pageRanges = getPageRanges(doc);

    const ranges: OverflowRange[] = [];

    for (let pi = 0; pi < pageRanges.length; pi++) {
      const page = pageRanges[pi];
      if (page.end <= page.start) continue;

      // 페이지 내 첫 텍스트 위치를 찾아 시작 y 를 잡는다.
      // (빈 페이지나 텍스트 없는 페이지는 건너뛴다.)
      let firstTextPos = -1;
      doc.nodesBetween(page.start, page.end, (node, pos) => {
        if (firstTextPos >= 0) return false;
        if (node.isText && node.text && node.text.length > 0) {
          firstTextPos = pos;
          return false;
        }
        return true;
      });
      if (firstTextPos < 0) continue;

      let pageTopY: number;
      try {
        pageTopY = view.coordsAtPos(firstTextPos + 1).top;
      } catch {
        continue;
      }
      const availBottom = pageTopY + avail;

      // ── Binary search: 글리프 bottom 이 availBottom 을 처음 넘는 위치 탐색 ──
      //
      // .top 기준이 아닌 .bottom 기준을 쓰는 이유:
      //   마지막 줄의 top 이 availBottom 안에 있어도 bottom(= top + line-height)
      //   이 넘칠 수 있다. .top 기준 bsearch 는 이 케이스를 탐지 못해서
      //   "경고 chip 은 뜨는데 빨간 강조는 없는" 불일치가 생긴다.
      //   .bottom 기준이면 "글리프가 경계 밖으로 튀어나오는 첫 글자"를 잡는다.
      let lo = firstTextPos + 1;
      let hi = page.end;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        let bottomY: number;
        try {
          bottomY = view.coordsAtPos(mid).bottom;
        } catch {
          lo = mid + 1;
          continue;
        }
        if (bottomY > availBottom) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
      const overflowPos = lo;

      if (overflowPos < page.end) {
        if (overflowAutoSplit) {
          if (lastAutoSplitPos !== overflowPos) {
            lastAutoSplitPos = overflowPos;
            emitOverflowSplit(doc, overflowPos);
          }
          return;
        }
        // 일반 케이스: 글리프가 경계를 넘는 글자가 있다.
        const charOffset = pmPosToPageCharOffset(doc, page.start, overflowPos);
        ranges.push({ pageIndex: pi, startCharOffset: charOffset });
        continue;
      }

      // ── DOM 폴백: 블록 margin-bottom 만 넘치는 케이스 ──
      //
      // ProseMirror coordsAtPos 는 CSS margin-bottom 을 포함하지 않는다.
      // 텍스트 본문은 모두 안에 들어오지만 마지막 블록의 margin-bottom 만
      // 경계를 넘는 경우, bsearch 는 아무것도 찾지 못한다.
      // 이때 경고 chip 은 뜨지만 빨간 강조가 없는 불일치가 발생한다.
      //
      // 해결: 마지막 블록 DOM 노드의 getBoundingClientRect().bottom +
      //       getComputedStyle().marginBottom 로 실제 시각 바닥을 확인하고,
      //       그것도 넘치면 마지막 블록 전체를 강조한다.
      try {
        const lastProbePos = Math.max(firstTextPos + 1, page.end - 1);
        const domInfo = view.domAtPos(lastProbePos);
        let el: Node | null = domInfo.node;
        // 텍스트 노드이면 부모 Element 로 올라간다.
        if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
        // 에디터 direct-child 블록 노드까지 올라간다.
        while (el && (el as Element).parentElement !== view.dom) {
          el = (el as Element).parentElement;
        }
        const blockEl = el as Element | null;
        if (blockEl) {
          const rect = blockEl.getBoundingClientRect();
          const marginBottom = parseFloat(getComputedStyle(blockEl).marginBottom) || 0;
          if (rect.bottom + marginBottom > availBottom) {
            // 블록 시작 PM position 을 찾아 그 블록 전체를 강조한다.
            const blockStartPmPos = view.posAtDOM(blockEl, 0);
            if (blockStartPmPos >= page.start && blockStartPmPos < page.end) {
              if (overflowAutoSplit) {
                if (lastAutoSplitPos !== blockStartPmPos + 1) {
                  lastAutoSplitPos = blockStartPmPos + 1;
                  emitOverflowSplit(doc, blockStartPmPos + 1);
                }
                return;
              }
              const charOffset = pmPosToPageCharOffset(doc, page.start, blockStartPmPos + 1);
              ranges.push({ pageIndex: pi, startCharOffset: charOffset });
            }
          }
        }
      } catch {
        // DOM 접근 실패 시 이 페이지 강조는 조용히 건너뛴다.
      }
    }

    if (overflowAutoSplit) {
      // 이 프레임에서 어떤 페이지도 오버플로 되지 않았다 — 다음 오버플로 발생 시
      // 다시 분할 이벤트를 보낼 수 있도록 가드를 초기화한다.
      lastAutoSplitPos = null;
      return;
    }

    if (!editor || editor.isDestroyed) return;
    const key = rangesKey(ranges);
    if (key === lastProbeRangesKey) return;
    lastProbeRangesKey = key;
    const tr = editor.state.tr.setMeta(overflowPluginKey, { ranges });
    editor.view.dispatch(tr);
  }

  let titleFocused = false;
  let titleComposing = false;
  let editorFocused = false;
  let keyboardOpen = false;
  let syncScheduled = false;
  let viewportCorrectionGeneration = 0;
  const LARGE_PASTE_MIN_CHARS = 800;
  const LARGE_PASTE_MIN_LINES = 6;
  const CARET_VIEWPORT_MARGIN_PX = 16;

  function getDocumentScrollTop(): number {
    return (
      window.scrollY ||
      document.scrollingElement?.scrollTop ||
      document.documentElement.scrollTop ||
      0
    );
  }

  function getDocumentViewportHeight(): number {
    return Math.max(
      1,
      document.documentElement.clientHeight || window.innerHeight || 1,
    );
  }

  function correctDocumentViewport(keepEditorSelectionVisible: boolean) {
    const scrollingElement = document.scrollingElement || document.documentElement;
    const viewportHeight = getDocumentViewportHeight();
    const maxScrollTop = Math.max(0, scrollingElement.scrollHeight - viewportHeight);
    const currentScrollTop = getDocumentScrollTop();
    let caretTop: number | undefined;
    let caretBottom: number | undefined;

    if (
      keepEditorSelectionVisible &&
      editor &&
      !editor.isDestroyed &&
      editor.isFocused
    ) {
      try {
        const selectionHead = Math.min(
          editor.state.selection.head,
          editor.state.doc.content.size,
        );
        const caretRect = editor.view.coordsAtPos(selectionHead);
        caretTop = caretRect.top + currentScrollTop;
        caretBottom = caretRect.bottom + currentScrollTop;
      } catch {
        // Selection DOM can be between layout passes immediately after paste.
      }
    }

    const nextScrollTop = computeEditorViewportScrollTop({
      currentScrollTop,
      maxScrollTop,
      viewportHeight,
      marginPx: CARET_VIEWPORT_MARGIN_PX,
      caretTop,
      caretBottom,
    });
    if (Math.abs(nextScrollTop - currentScrollTop) > 1) {
      window.scrollTo({ top: nextScrollTop, behavior: "instant" });
    }
  }

  function scheduleViewportCorrection(keepEditorSelectionVisible: boolean) {
    const generation = ++viewportCorrectionGeneration;
    const run = () => {
      if (generation !== viewportCorrectionGeneration) return;
      correctDocumentViewport(keepEditorSelectionVisible);
    };

    // The first pass follows ProseMirror's DOM commit; the delayed pass follows
    // WKWebView's keyboard/frame animation and final text reflow.
    requestAnimationFrame(() => requestAnimationFrame(run));
    setTimeout(run, 180);
  }

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

  // hideTitle 은 최초 "init" 처리 중, ProseMirror 를 마운트하는 setupEditor()
  // 보다 먼저 적용해야 한다. onReady 이후 별도 injection 으로 뒤늦게 적용하면
  // 제목 입력창 + 본문이 분리된 기본 레이아웃이 첫 프레임에 노출되는
  // flash 가 생긴다.
  function applyTitleVisibility(hideTitle: boolean) {
    if (!hideTitle) return;
    if (titleInput) titleInput.style.display = "none";
    document.body.style.paddingTop = "0px";
    const ec = document.getElementById("editor-content");
    if (ec) (ec as HTMLElement).style.paddingBottom = "24px";
  }

  function focusEditorStartFromTitle() {
    titleInput?.blur();
    if (!editor || editor.isDestroyed) return;
    try {
      editor.commands.focus("start", { scrollIntoView: false });
    } catch {}
  }

  function focusEditorAtDocumentStart() {
    if (!editor || editor.isDestroyed) return;
    try {
      editor.commands.focus("start", { scrollIntoView: false });
    } catch {}
  }

  function handleTitleKeydown(event: KeyboardEvent) {
    handleTitleEnter(
      event,
      {
        preventDefault: () => event.preventDefault(),
        focusBodyStart: focusEditorStartFromTitle,
      },
      titleComposing,
    );
  }

  function getSelectionPayload(ed: Editor) {
    const activeBlock = ed.isActive("horizontalRule") ? "horizontalRule"
      : ed.isActive("heading", { level: 1 }) ? "heading1"
      : ed.isActive("heading", { level: 2 }) ? "heading2"
      : ed.isActive("heading", { level: 3 }) ? "heading3"
      : ed.isActive("blockquote") ? "blockquote"
      : ed.isActive("bulletList") ? "bulletList"
      : ed.isActive("orderedList") ? "orderedList"
      : "paragraph";
    return {
      activeBlock,
      isBold: ed.isActive("bold"),
      isItalic: ed.isActive("italic"),
      isUnderline: ed.isActive("underline"),
      canUndo: ed.can().undo(),
      canRedo: ed.can().redo(),
    };
  }

  // 선택 변경/마크 토글은 한 프레임 내에 여러 번 발생할 수 있다.
  // requestAnimationFrame 으로 마지막 상태만 RN 으로 보내고, 직전과 동일한
  // payload(activeBlock/marks)는 생략해 빠른 드래그·타이핑 중 메시지 폭주를 막는다.
  let selectionRafId: number | null = null;
  let lastSelectionPayload: ReturnType<typeof getSelectionPayload> | null = null;
  function postSelectionState(_ed: Editor) {
    if (selectionRafId != null) return;
    selectionRafId = requestAnimationFrame(() => {
      selectionRafId = null;
      if (!editor || editor.isDestroyed) return;
      const payload = getSelectionPayload(editor);
      if (
        lastSelectionPayload &&
        payload.activeBlock === lastSelectionPayload.activeBlock &&
        payload.isBold === lastSelectionPayload.isBold &&
        payload.isItalic === lastSelectionPayload.isItalic &&
        payload.isUnderline === lastSelectionPayload.isUnderline &&
        payload.canUndo === lastSelectionPayload.canUndo &&
        payload.canRedo === lastSelectionPayload.canRedo
      ) {
        return;
      }
      lastSelectionPayload = payload;
      postToRN({ type: "onSelectionUpdate", payload });
    });
  }

  function setupEditor(
    placeholder: string,
    initialMarkdown: string,
    ensureTrailingParagraph = true,
  ) {
    const el = document.getElementById("editor-content");
    if (!el) return;

    const initialHtml = markdownToHtml(initialMarkdown, ensureTrailingParagraph);

    editor = new Editor({
      element: el,
      extensions: [
        Document,
        Paragraph,
        Text,
        createHeadingWithParagraphShortcut().configure({ levels: [1, 2, 3] }),
        Bold,
        Italic,
        Underline,
        Blockquote,
        HorizontalRuleWithControls,
        BulletList,
        OrderedList,
        ListItem,
        QuestionBlock,
        InlineImage,
        UndoRedo,
        HardBreak,
        Placeholder.configure({ placeholder }),
        OverflowDecorationExtension,
        SpellHighlightExtension,
        SelectionStabilityExtension,
      ],
      content: initialHtml,
      editable: true,
      autofocus: false,
      onUpdate: ({ editor: ed, transaction }) => {
        // export 캐시 무효화: 실제 doc 이 바뀐 트랜잭션만 카운트.
        // selection/decoration-only 트랜잭션으로는 무효화하지 않는다.
        if (transaction.docChanged) {
          docChangeCounter++;
          if (programmaticUpdatePending) {
            // 프로그래매틱 setMarkdown/setContent 로 인한 변경이다.
            // onChange 를 emit 하지 않으면 RN 측 autosave 디바운스가 시작되지
            // 않아 실제 사용자 편집과 구분된다.
            programmaticUpdatePending = false;
            // 이전 사용자 편집이 남긴 stale 타이머가 있으면 취소한다.
            if (changeTimer) { clearTimeout(changeTimer); changeTimer = null; }
            // dedup 키 및 overflow probe 는 정상적으로 갱신한다.
            lastProbeRangesKey = null;
            scheduleOverflowProbe();
            postSelectionState(ed);
            return;
          }
          // 사용자 입력으로 인한 변경이 발생하면 setMarkdown guard 도 무효화한다.
          // (이후 동일한 markdown 이 들어와도 setContent 가 다시 실행되도록.)
          lastAppliedMarkdown = null;
        }
        if (changeTimer) clearTimeout(changeTimer);
        changeTimer = setTimeout(() => {
          const text = ed.state.doc.textContent;
          const charCount = text.length;
          const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
          let conversionFailed = false;
          let conversionError: unknown;
          const markdown = htmlToMarkdown(ed.getHTML(), (error) => {
            conversionFailed = true;
            conversionError = error;
          });
          if (conversionFailed) {
            postToRN({
              type: "onError",
              payload: {
                code: "MARKDOWN_EXPORT_FAIL",
                message: String(conversionError),
              },
            });
            return;
          }
          lastExportedMarkdown = markdown;
          lastExportedDocVersion = docChangeCounter;
          // Korean IME composition and formatting changes can replace the
          // document while keeping both metrics identical. Every debounced
          // docChanged transaction must notify RN so the newest Markdown is
          // exported instead of leaving an older syllable/format unsaved.
          postToRN({
            type: "onChange",
            payload: {
              isDirty: true,
              charCount,
              wordCount,
              markdown,
              docVersion: docChangeCounter,
              editorSessionId,
            },
          });
        }, CHANGE_THROTTLE_MS);
        postSelectionState(ed);
        // doc 가 바뀌면 기존 decoration 은 매핑된 좌표가 stale 일 수 있으므로
        // dedup 키를 무효화해 다음 probe 가 반드시 재dispatch 되도록 한다.
        lastProbeRangesKey = null;
        // 강조 위치는 시각 레이아웃에 의존하므로 doc 변경 직후 재측정한다.
        scheduleOverflowProbe();
      },
      onSelectionUpdate: ({ editor: ed }) => {
        postSelectionState(ed);
      },
      onFocus: () => {
        editorFocused = true;
        syncKeyboardState();
      },
      onBlur: () => {
        editorFocused = false;
        syncKeyboardState();
      },
      onPaste: (event) => {
        const pastedText = event.clipboardData?.getData("text/plain") || "";
        const pastedLineCount = pastedText ? pastedText.split(/\r?\n/).length : 0;
        if (
          pastedText.length >= LARGE_PASTE_MIN_CHARS ||
          pastedLineCount >= LARGE_PASTE_MIN_LINES
        ) {
          scheduleViewportCorrection(true);
        }
      },
    });
  }

  function readLineBreakOffsets(element: HTMLElement): number[] {
    const MAX_DIAGNOSTIC_CHARACTERS = 1200;
    const offsets: number[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let absoluteOffset = 0;
    let previousTop: number | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent || "";
      for (let index = 0; index < text.length; index += 1) {
        if (absoluteOffset + index >= MAX_DIAGNOSTIC_CHARACTERS) return offsets;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && previousTop != null && Math.abs(rect.top - previousTop) > 0.5) {
          offsets.push(absoluteOffset + index);
        }
        if (rect.width > 0) previousTop = rect.top;
      }
      absoluteOffset += text.length;
    }
    return offsets;
  }

  function applyBodyMetrics(metrics: BodyTypographyMetrics, layoutGeneration: number): boolean {
    if (
      !metrics ||
      !shouldApplyBodyTypographyGeneration(layoutGeneration, lastLayoutGeneration)
    ) return false;
    const root = document.documentElement;
    let changed = layoutGeneration !== lastLayoutGeneration;
    lastLayoutGeneration = layoutGeneration;
    const values: Array<[keyof BodyTypographyMetrics, string, number | null, (value: number) => void]> = [
      ["textColumnWidth", "--text-column-width", lastTextColumnWidth, (value) => { lastTextColumnWidth = value; }],
      ["fontSizePx", "--body-font-size", lastBodyFontSizePx, (value) => { lastBodyFontSizePx = value; }],
      ["lineHeightPx", "--body-line-height", lastBodyLineHeightPx, (value) => { lastBodyLineHeightPx = value; }],
      ["paragraphGapPx", "--body-paragraph-gap", lastBodyParagraphGapPx, (value) => { lastBodyParagraphGapPx = value; }],
      ["letterSpacingPx", "--body-letter-spacing", lastBodyLetterSpacingPx, (value) => { lastBodyLetterSpacingPx = value; }],
      ["titleFontSizePx", "--title-font-size", lastTitleFontSizePx, (value) => { lastTitleFontSizePx = value; }],
    ];
    for (const [key, variable, previous, commit] of values) {
      const value = metrics[key];
      if (value !== previous) {
        root.style.setProperty(variable, value + "px");
        commit(value);
        changed = true;
      }
    }
    if (titleInput) autoResizeTitle();
    return changed;
  }

  (window as unknown as { handleCommand: (cmd: Command) => void }).handleCommand = function (cmd: Command) {
    try {
      switch (cmd.type) {
        case "init": {
          const payload = cmd.payload || {};
          if (!payload.typography) {
            postToRN({ type: "onError", payload: { code: "EDITOR_METRICS_MISSING", message: "Editor typography was not provided before initialization" } });
            break;
          }
          applyBodyMetrics(payload.typography, payload.layoutGeneration ?? 0);
          const initialMarkdown = payload.initialMarkdown || "";
          const placeholder = payload.placeholder || "여기에 메모를 작성하세요...";
          const titleValue = payload.titleValue || "";
            const ensureTrailingParagraph = cmd.ensureTrailingParagraph ?? true;
          editorSessionId = payload.editorSessionId || "";

          if (titleInput) {
            titleInput.value = titleValue;
            autoResizeTitle();
          }
          applyTitleVisibility(!!payload.hideTitle);

          if (!editor) {
            setupEditor(placeholder, initialMarkdown, ensureTrailingParagraph);
          } else {
            // setContent 는 docChanged 트랜잭션을 발생시켜 onUpdate 를 trigger 한다.
            // 프로그래매틱 변경임을 표시해 spurious onChange 가 RN 으로 가지 않도록 한다.
            programmaticUpdatePending = true;
              const html = editor.getHTML();
            editor.commands.setContent(html);
          }
          // setupEditor / setContent 직후 캐시를 정합 상태로 맞춘다.
          lastAppliedMarkdown = initialMarkdown;
          // 새 본문이 들어왔으니 export 캐시도 비운다.
          lastExportedMarkdown = "";
          lastExportedDocVersion = -1;

          postToRN({ type: "onReady", payload: { editorSessionId } });
          // 초기 콘텐츠 레이아웃이 안정된 뒤 한 번 강조를 측정한다.
          scheduleOverflowProbe(150);
          break;
        }
        case "setMarkdown": {
          if (editor && !editor.isDestroyed) {
            const next = insertTitleSoftBreak(
              titleInput.value,
              titleInput.selectionStart,
              titleInput.selectionEnd,
            );
            const ensureTrailingParagraph = cmd.ensureTrailingParagraph ?? true;
            // 동일한 markdown 이 다시 들어오면 markdown→HTML 변환과
            // ProseMirror 전체 setContent 를 모두 생략한다 (no-op).
            if (lastAppliedMarkdown !== null && next === lastAppliedMarkdown) {
              if (cmd.focusAtStart) focusEditorAtDocumentStart();
              break;
            }
            // setContent 는 기존 문서를 완전히 교체하는 트랜잭션이라, 포커스된
            // 상태에서 실행하면 브라우저가 현재 선택 영역(커서)이 있던 DOM
            // 노드를 잃어 contenteditable 을 blur 시켰다가 다시 focus 하는
            // 경우가 있다 — 이 blur/focus 가 네이티브 키보드를 순간적으로
            // 내렸다 올리는 "버벅임"으로 보인다. 페이지 전환 중에도 사용자는
            // 계속 타이핑할 의도이므로, 교체 전 포커스 여부를 기억해 뒀다가
            // 같은 동기 실행 흐름 안에서 즉시 재포커스해 blur 가 실제
            // 키보드 숨김으로 이어지기 전에 되돌린다.
            const wasFocused = editor.isFocused;
            // setContent 는 docChanged 트랜잭션을 발생시켜 onUpdate 를 trigger 한다.
            // 프로그래매틱 변경임을 표시해 spurious onChange 가 RN 으로 가지 않도록 한다.
            programmaticUpdatePending = true;
              const html = editor.getHTML();
            editor.commands.setContent(html);
            if (cmd.focusAtStart) {
              focusEditorAtDocumentStart();
            } else if (wasFocused) {
              // 새 페이지 콘텐츠의 끝으로 커서를 옮기며 동기적으로 재포커스한다.
              editor.commands.focus("end", { scrollIntoView: false });
            }
            lastAppliedMarkdown = next;
            // 새 본문이 들어왔으니 export 캐시도 비운다.
            // (setContent 트랜잭션은 docChanged=true 라 docChangeCounter 가
            //  자동으로 증가하지만, 캐시도 명시적으로 비워 안전하게 둔다.)
            lastExportedMarkdown = "";
            lastExportedDocVersion = -1;
            scheduleOverflowProbe(150);
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
            // doc 이 마지막 export 이후 변하지 않았으면 htmlToMarkdown 변환을
            // 생략하고 캐시된 markdown 을 그대로 반환한다.
            let markdown: string;
            if (lastExportedDocVersion === docChangeCounter) {
              markdown = lastExportedMarkdown;
            } else {
              const html = editor.getHTML();
              let conversionFailed = false;
              let conversionError: unknown;
              markdown = htmlToMarkdown(html, (error) => {
                conversionFailed = true;
                conversionError = error;
              });
              if (conversionFailed) {
                postToRN({
                  type: "onExportMarkdown",
                  payload: {
                    requestId: cmd.requestId,
                    isDirty: true,
                    docVersion: docChangeCounter,
                    editorSessionId,
                    error: {
                      code: "MARKDOWN_EXPORT_FAIL",
                      message: String(conversionError),
                    },
                  },
                });
                break;
              }
              lastExportedMarkdown = markdown;
              lastExportedDocVersion = docChangeCounter;
            }
            postToRN({
              type: "onExportMarkdown",
              payload: {
                requestId: cmd.requestId,
                markdown,
                  title: titleInput?.value ?? "",
                isDirty: false,
                docVersion: docChangeCounter,
                editorSessionId,
              },
            });
          }
          break;
        }
        case "setEditable": {
            const next = insertTitleSoftBreak(
              titleInput.value,
              titleInput.selectionStart,
              titleInput.selectionEnd,
            );
          // 같은 값을 재전송한 경우 ProseMirror/DOM 작업을 생략한다.
          if (lastEditable !== next) {
            if (editor && !editor.isDestroyed) {
              editor.setEditable(next);
            }
            if (titleInput) {
              titleInput.readOnly = !next;
              titleInput.style.color = next ? "#18181b" : "#52525b";
            }
            lastEditable = next;
          }
          break;
        }
        case "setOverflowRanges": {
          if (editor && !editor.isDestroyed) {
            const ranges = cmd.ranges || [];
              const tr = editor.state.tr.setMeta(overflowPluginKey, { ranges: [] });
            editor.view.dispatch(tr);
          }
          break;
        }
        case "setOverflowProbeConfig": {
            const next = insertTitleSoftBreak(
              titleInput.value,
              titleInput.selectionStart,
              titleInput.selectionEnd,
            );
          const prev = overflowAvailableContentHeight;
          overflowAvailableContentHeight = (next != null && next > 0) ? next : null;
          overflowAutoSplit = !!cmd.autoSplit;
          lastAutoSplitPos = null;
          if (overflowAvailableContentHeight == null) {
            // probe 가 비활성화되는 순간 1회만 강조를 비운다.
            // (이후 doc 변경 시에는 scheduleOverflowProbe 가 no-op 이라 트랜잭션이 발생하지 않는다.)
            if (prev != null && !overflowAutoSplit && editor && !editor.isDestroyed) {
              const tr = editor.state.tr.setMeta(overflowPluginKey, { ranges: [] });
              editor.view.dispatch(tr);
            }
          } else {
            // 폰트/레이아웃이 안정될 시간을 잠깐 둔다.
            scheduleOverflowProbe(50);
          }
          break;
        }
        case "setBodyMetrics": {
          const metrics = cmd.metrics;
          if (!metrics) break;
          const layoutGeneration = cmd.layoutGeneration ?? 0;
          if (!shouldApplyBodyTypographyGeneration(layoutGeneration, lastLayoutGeneration)) break;
          const changed = applyBodyMetrics(metrics, layoutGeneration);
          // 폭/폰트/행간/자간이 바뀐 경우에만 강조 재측정.
          if (changed) scheduleOverflowProbe(150);
          requestAnimationFrame(() => {
            const probe = document.querySelector<HTMLElement>(".ProseMirror");
            if (!probe) return;
            const computed = getComputedStyle(probe);
            const fonts = document.fonts;
            postToRN({
              type: "onBodyTypographyDiagnostic",
              payload: {
                layoutGeneration,
                domWidthPx: probe.getBoundingClientRect().width,
                fontSizePx: Number.parseFloat(computed.fontSize),
                lineHeightPx: Number.parseFloat(computed.lineHeight),
                letterSpacingPx: Number.parseFloat(computed.letterSpacing),
                textSizeAdjust:
                  computed.getPropertyValue("text-size-adjust") ||
                  computed.getPropertyValue("-webkit-text-size-adjust") ||
                  "unknown",
                devicePixelRatio: window.devicePixelRatio || 1,
                configuredTextZoomPercent: metrics.textScalePercent,
                effectiveFontScaleRatio:
                  Number.parseFloat(computed.fontSize) / metrics.fontSizePx,
                fontFamily: computed.fontFamily,
                fonts: {
                  eulyooRegular: !!fonts?.check("400 16px 'Eulyoo1945-Regular'", BODY_FONT_FALLBACK_PROBE_TEXT),
                  eulyooSemiBold: !!fonts?.check("600 16px 'Eulyoo1945-SemiBold'", BODY_FONT_FALLBACK_PROBE_TEXT),
                  notoRegular: !!fonts?.check("400 16px 'NotoSerifKR_400Regular'", BODY_FONT_FALLBACK_PROBE_TEXT),
                  notoSemiBold: !!fonts?.check("600 16px 'NotoSerifKR_600SemiBold'", BODY_FONT_FALLBACK_PROBE_TEXT),
                },
                lineBreakOffsets: readLineBreakOffsets(probe),
              },
            });
          });
          break;
        }
        case "setBodyFontMode": {
          if (cmd.mode !== "fallback") break;
          const root = document.documentElement;
          root.style.setProperty("--body-regular-font-family", BODY_FALLBACK_REGULAR_FONT_FAMILY);
          root.style.setProperty("--body-semibold-font-family", BODY_FALLBACK_SEMIBOLD_FONT_FAMILY);
          scheduleOverflowProbe(50);
          break;
        }
        case "setContentBottomPadding": {
          const rawPaddingPx = cmd.paddingPx;
          const paddingPx =
            typeof rawPaddingPx === "number" && Number.isFinite(rawPaddingPx)
            ? Math.max(0, rawPaddingPx)
            : 120;
          document.documentElement.style.setProperty(
            "--editor-content-bottom-padding",
            paddingPx + "px",
          );
          scheduleViewportCorrection(false);
          break;
        }
        case "setBlockType": {
          if (editor && !editor.isDestroyed) {
            const bt = cmd.blockType || "paragraph";
            const chain = editor.chain().focus();
            if (bt === "heading1") {
              chain.setHeading({ level: 1 }).run();
            } else if (bt === "heading2") {
              chain.setHeading({ level: 2 }).run();
            } else if (bt === "heading3") {
              chain.setHeading({ level: 3 }).run();
            } else if (bt === "blockquote") {
              chain.setBlockquote().run();
            } else if (bt === "bulletList") {
              if (!editor.isActive("bulletList")) {
                chain.toggleBulletList().run();
              }
            } else if (bt === "orderedList") {
              if (!editor.isActive("orderedList")) {
                chain.toggleOrderedList().run();
              }
            } else {
              chain.clearNodes().setParagraph().run();
            }
            postSelectionState(editor);
          }
          break;
        }
        case "undo": {
          if (editor && !editor.isDestroyed) {
            editor.chain().focus().undo().run();
          }
          break;
        }
        case "redo": {
          if (editor && !editor.isDestroyed) {
            editor.chain().focus().redo().run();
          }
          break;
        }
        case "toggleMark": {
          if (editor && !editor.isDestroyed) {
            const mk = cmd.mark || "";
            const chain = editor.chain().focus();
            if (mk === "bold") {
              chain.toggleBold().run();
            } else if (mk === "italic") {
              chain.toggleItalic().run();
            } else if (mk === "underline") {
              chain.toggleUnderline().run();
            }
            postSelectionState(editor);
          }
          break;
        }
        case "insertDivider": {
          if (editor && !editor.isDestroyed) {
            editor.chain().focus().clearNodes().setHorizontalRule().run();
          }
          break;
        }
        case "insertHardBreak": {
          if (titleFocused && titleInput) {
            const next = insertTitleSoftBreak(
              titleInput.value,
              titleInput.selectionStart,
              titleInput.selectionEnd,
            );
            titleInput.value = next.value;
            titleInput.setSelectionRange(next.caret, next.caret);
            titleInput.dispatchEvent(new Event("input", { bubbles: true }));
            break;
          }
          if (editor && !editor.isDestroyed) {
            editor.chain().focus().setHardBreak().run();
          }
          break;
        }
        case "insertQuote": {
          if (editor && !editor.isDestroyed && cmd.text) {
            // cmd.text may be a JSON-encoded { text, attribution? } object
            // (produced by the reader sentence-quote path) or a plain string
            // (produced by the quote-picker path). Parse defensively.
            let quoteText = cmd.text as string;
            let quoteAttribution: string | null = null;
            try {
              const parsed = JSON.parse(cmd.text as string) as unknown;
              if (parsed && typeof parsed === "object" && "text" in parsed) {
                quoteText = (parsed as { text: string }).text;
                const attr = (parsed as { attribution?: string }).attribution;
                if (attr && attr.trim()) quoteAttribution = attr.trim();
              }
            } catch {
              // Not JSON — treat as plain string.
            }
            const blockContent: object[] = [
              { type: "paragraph", content: [{ type: "text", text: quoteText }] },
            ];
            if (quoteAttribution) {
              blockContent.push({
                type: "paragraph",
                content: [{ type: "text", text: quoteAttribution }],
              });
            }
            editor.chain().focus().insertContent({
              type: "blockquote",
              content: blockContent,
            }).run();
          }
          break;
        }
        case "autoSplitImages": {
          if (!editor || editor.isDestroyed) {
            postToRN({ type: "onAutoSplitComplete", payload: { hadConsecutiveImages: false } });
            break;
          }

          const { state } = editor;
          const { doc, schema: sc } = state;

          const _isHR = (n: PMNode) => n.type.name === "horizontalRule";
          const _isImg = (n: PMNode) => n.type.name === "inlineImage";
          const _isRemoteImg = (n: PMNode) =>
            _isImg(n) && /^https?:\/\//i.test(String(n.attrs.originalSrc ?? n.attrs.src ?? ""));
          const _isEmptyPara = (n: PMNode) =>
            n.type.name === "paragraph" && n.content.size === 0;

          const original: PMNode[] = [];
          doc.forEach((n) => original.push(n));

          if (!original.some((n) => _isRemoteImg(n) && !n.attrs["data-autosplit"])) {
            postToRN({ type: "onAutoSplitComplete", payload: { hadConsecutiveImages: false } });
            break;
          }

          const prevSigOrig = (idx: number): PMNode | null => {
            for (let j = idx - 1; j >= 0; j--) {
              if (!_isEmptyPara(original[j])) return original[j];
            }
            return null;
          };
          const nextSigOrig = (idx: number): PMNode | null => {
            for (let j = idx + 1; j < original.length; j++) {
              if (!_isEmptyPara(original[j])) return original[j];
            }
            return null;
          };

          let hadConsecutive = false;
          const result: PMNode[] = [];

          const resultLastSig = (): PMNode | null => {
            for (let j = result.length - 1; j >= 0; j--) {
              if (!_isEmptyPara(result[j])) return result[j];
            }
            return null;
          };

          for (let i = 0; i < original.length; i++) {
            const node = original[i];

            if (!_isRemoteImg(node) || node.attrs["data-autosplit"]) {
              result.push(node);
              continue;
            }

            const origPrev = prevSigOrig(i);
            const origNext = nextSigOrig(i);
            const resLastSig = resultLastSig();

            const needHRBefore =
              origPrev !== null && (resLastSig === null || !_isHR(resLastSig));
            const needHRAfter = origNext !== null && !_isHR(origNext);
            const consecutiveAfter = origNext !== null && _isImg(origNext);

            if (consecutiveAfter) hadConsecutive = true;

            if (needHRBefore) {
              while (result.length > 0 && _isEmptyPara(result[result.length - 1])) {
                result.pop();
              }
              result.push(sc.nodes.horizontalRule.create());
            }

            result.push(
              sc.nodes.inlineImage.create({ ...node.attrs, "data-autosplit": "1" })
            );

            if (needHRAfter) {
              result.push(sc.nodes.horizontalRule.create());
              if (consecutiveAfter) {
                result.push(sc.nodes.paragraph.create());
                result.push(sc.nodes.horizontalRule.create());
              }
            }
          }

          // 문서 맨 끝이 사진이면(다음 유의미 노드가 없어 needHRAfter가 붙지 않음)
          // 커서가 갈 빈 문단을 사진과 같은 페이지에 그냥 붙이면 안 된다 —
          // 그 문단에 이어 타이핑하면 텍스트가 사진과 한 페이지를 공유하게 된다.
          // 사진 바로 뒤에 HR을 하나 더 넣어 반드시 별도 페이지로 분리한다.
          const lastNode = result[result.length - 1];
          if (!lastNode || lastNode.type.name !== "paragraph") {
            if (lastNode && _isImg(lastNode)) {
              result.push(sc.nodes.horizontalRule.create());
            }
            result.push(sc.nodes.paragraph.create());
          }

          // [Fix 5] 파괴적 변환 직전 현재 마크다운을 localStorage에 스냅샷한다.
          // replaceWith 후 어떤 이유로든 복구가 필요할 때 사용할 수 있다.
          try {
            const snapshotMd = htmlToMarkdown(editor.getHTML());
            localStorage.setItem(
              "friction_autosplit_snapshot",
              JSON.stringify({ markdown: snapshotMd, ts: Date.now() }),
            );
          } catch {}

          // [Fix 3] replaceWith 후 ProseMirror가 커서 위치로 스크롤 점프하면
          // 텍스트가 뷰포트 위로 사라져 보이는 착시가 발생한다.
          // dispatch 전 스크롤 위치를 저장하고, 다음 프레임에서 복원한다.
          const savedScrollTop =
            (window.scrollY !== undefined ? window.scrollY : 0) ||
            document.documentElement.scrollTop ||
            0;

          // [Fix 4] 다음 requestExportMarkdown이 반드시 최신 HTML을 재직렬화하도록
          // dispatch 직전에 export 캐시를 강제 무효화한다.
          lastExportedDocVersion = -1;

          const autoTr = state.tr.replaceWith(0, doc.content.size, result);
          autoTr.setMeta("autoSplit", true);
          editor.view.dispatch(autoTr);

          // [Fix 3 continued] 스크롤 위치 복원 (다음 프레임에서 실행).
          requestAnimationFrame(() => {
            window.scrollTo({ top: savedScrollTop, behavior: "instant" });
          });

          postToRN({ type: "onAutoSplitComplete", payload: { hadConsecutiveImages: hadConsecutive } });
          break;
        }
        case "scrollToBlock": {
          // Resolve the target block element + ALL non-HR block elements in the
          // requested page, then scroll and show a page-wide blue overlay.
          // Content may not be fully rendered yet (setMarkdown is async via WebView
          // round-trip + TipTap commit); retry with backoff until doc is ready.
          const pageIdx = cmd.pageIndex ?? 0;
          const blockIdx = cmd.blockIndex ?? 0;

          const posToBlockEl = (view: any, pos: number): Element | null => {
            try {
              const resolvedPos = Math.max(1, pos + 1);
              const domInfo = view.domAtPos(resolvedPos);
              let el: Node | null = domInfo.node;
              if (el && el.nodeType === Node.TEXT_NODE) el = (el as Node).parentElement;
              while (el && (el as Element).parentElement !== view.dom) {
                el = (el as Element).parentElement;
              }
              return el as Element | null;
            } catch {
              return null;
            }
          };

          const showPageOverlay = (firstEl: Element, lastEl: Element): void => {
            try {
              const container = document.body;
              const containerRect = container.getBoundingClientRect();
              const firstRect = firstEl.getBoundingClientRect();
              const lastRect = lastEl.getBoundingClientRect();
              const top = firstRect.top - containerRect.top + container.scrollTop;
              const height = Math.max(0, lastRect.bottom - firstRect.top);
              const overlay = document.createElement("div");
              overlay.className = "page-anchor-overlay";
              overlay.style.top = (top - 6) + "px";
              overlay.style.height = (height + 12) + "px";
              container.appendChild(overlay);
              setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
              }, 1700);
            } catch {}
          };

          const attemptScroll = (retriesLeft: number): void => {
            if (!editor || editor.isDestroyed) return;
            const doc = editor.state.doc;
            const pageRanges = getPageRanges(doc);
            const page = pageRanges[pageIdx] ?? pageRanges[0];

            // Collect every non-HR block position inside the page range.
            const blocksInPage: number[] = [];
            if (page) {
              doc.forEach((node, offset) => {
                if (offset < page.start || offset >= page.end) return;
                if (node.type.name === "horizontalRule") return;
                blocksInPage.push(offset);
              });
            }

            // Doc not populated yet → retry.
            if (!page || blocksInPage.length === 0) {
              if (retriesLeft > 0) {
                setTimeout(() => attemptScroll(retriesLeft - 1), 150);
              }
              return;
            }

            const targetPos = blocksInPage[Math.min(blockIdx, blocksInPage.length - 1)];
            const view = editor.view;
            const targetEl = posToBlockEl(view, targetPos);
            const firstEl = posToBlockEl(view, blocksInPage[0]);
            const lastEl = posToBlockEl(view, blocksInPage[blocksInPage.length - 1]);

            // DOM not painted yet (block has 0 height) → retry.
            if (!firstEl || !lastEl || (firstEl as HTMLElement).offsetHeight === 0) {
              if (retriesLeft > 0) {
                setTimeout(() => attemptScroll(retriesLeft - 1), 150);
              }
              return;
            }

            if (targetEl) {
              // Use explicit scrollTo with an absolute position instead of
              // scrollIntoView so the scroll is synchronous and predictable on
              // Android WebView (smooth scroll + concurrent DOM mutation causes
              // Android to abort the animation mid-way).
              const rect = targetEl.getBoundingClientRect();
              const targetTop = rect.top + window.scrollY;
              window.scrollTo({ top: Math.max(0, targetTop - 24), behavior: "instant" });
            }
            // Call showPageOverlay directly — instant scroll is already reflected
            // in the DOM, so getBoundingClientRect() returns the correct position.
            showPageOverlay(firstEl, lastEl);
          };

          attemptScroll(8); // ~8 * 150ms = up to 1.2s of retries
          break;
        }
        case "setSpellHighlight": {
          if (editor && !editor.isDestroyed) {
            const range = spellFindRange(
              editor.state.doc,
              cmd.original || "",
              cmd.contextHint || "",
              cmd.occurrenceIndex ?? 0,
            );
            // Always dispatch — set range if found, clear if not found so no
            // stale range from a previous item persists in plugin state.
            editor.view.dispatch(
              editor.state.tr.setMeta(spellHighlightPluginKey, range ?? "clear"),
            );
          }
          break;
        }
        case "clearSpellHighlight": {
          if (editor && !editor.isDestroyed) {
            editor.view.dispatch(
              editor.state.tr.setMeta(spellHighlightPluginKey, "clear"),
            );
          }
          break;
        }
        case "applySpellFix": {
          if (editor && !editor.isDestroyed) {
            // Always re-resolve from cmd.original/contextHint/occurrenceIndex.
            // Do NOT use plugin state — it may hold a range from a different
            // suggestion if the previous setSpellHighlight failed.
            const range = spellFindRange(
              editor.state.doc,
              cmd.original || "",
              cmd.contextHint || "",
              cmd.occurrenceIndex ?? 0,
            );
            // Clear highlight regardless of whether fix succeeds
            editor.view.dispatch(
              editor.state.tr.setMeta(spellHighlightPluginKey, "clear"),
            );
            if (range) {
              try {
                const repNode = cmd.replacement
                  ? editor.state.schema.text(cmd.replacement)
                  : null;
                editor.view.dispatch(
                  editor.state.tr.replaceWith(range.from, range.to, repNode ? [repNode] : []),
                );
              } catch {}
            }
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
    window.addEventListener("resize", function () {
      scheduleViewportCorrection(editorFocused);
    });

    titleInput = document.getElementById("title-input") as HTMLTextAreaElement | null;
    if (titleInput) {
      titleInput.addEventListener("input", function () {
        autoResizeTitle();
        postToRN({ type: "onTitleChange", payload: { title: titleInput!.value } });
      });
      titleInput.addEventListener("compositionstart", function () {
        titleComposing = true;
      });
      titleInput.addEventListener("compositionend", function () {
        titleComposing = false;
      });
      titleInput.addEventListener("keydown", handleTitleKeydown);
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
      const target = e.target as Node;
      if (target.id === "title-input") {
        titleFocused = true;
      } else {
        editorFocused = true;
      }
      syncKeyboardState();
    });

    document.addEventListener("focusout", function (e) {
      if (!isEditorElement(e.target)) return;
      const target = e.target as Node;
      if (target.id === "title-input") {
        titleFocused = false;
      } else {
        editorFocused = false;
      }
      syncKeyboardState();
    });

    // 제목/본문/별도 컨트롤은 각 요소의 기본 탭 동작을 그대로 소유한다.
    // 키보드가 닫힌 상태에서 그 밖의 빈 표면을 한 손가락으로 정지 탭한
    // 경우에만 편집기를 재활성화한다.
    let surfaceTouchSession: EditorSurfaceTouchSession | null = null;
    document.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) {
        surfaceTouchSession = null;
        return;
      }
      var t = e.touches[0];
      if (t) {
        selHandleDragStartX = t.clientX;
        selHandleDragStartY = t.clientY;
      }
      selHandleDragging = false;
    }, { passive: true });

    document.addEventListener("touchmove", function (e) {
      if (selHandleDragging) return;
      if (!selHandleHasActiveSelection) return;
      var t = e.touches[0];
      updateEditorSurfaceTouchSession(surfaceTouchSession, t.clientX, t.clientY);
    }, { passive: true });

    const markSurfaceTouchScrolled = function () {
      if (surfaceTouchSession) surfaceTouchSession.scrolled = true;
    };
    document.addEventListener("scroll", markSurfaceTouchScrolled, {
      capture: true,
      passive: true,
    });
    window.addEventListener("scroll", markSurfaceTouchScrolled, { passive: true });

    document.addEventListener("touchcancel", function () {
      surfaceTouchSession = null;
    }, { passive: true });

    document.addEventListener("touchend", function (e) {
      const session = surfaceTouchSession;
      surfaceTouchSession = null;
      if (
        !session
        || keyboardOpen
        || !editor
        || editor.isDestroyed
        || e.changedTouches.length !== 1
      ) {
        return;
      }
      var t = e.touches[0];
      if (
        !isStationaryBlankSurfaceTap(
          session,
          t.clientX,
          t.clientY,
          isBlankEditorSurfaceTarget(e.target),
        )
      ) {
        return;
      }

      try {
        editor.commands.focus();
      } catch {}
    }, { passive: true });

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
      if (selHandleHasActiveSelection || selHandleDragging) return;
      var dy = t.clientY - selHandleDragStartY;
      if (dy > SWIPE_THRESHOLD) {
        swipeDismissed = true;
        postToRN({ type: "onSwipeDownToDismiss" });
      }
    }, { passive: true });

    document.addEventListener("touchend", function () {
      swipeDismissed = false;
    }, { passive: true });

    // ── Selection handle drag detection ──
    // When the user drags an OS selection handle (the blue teardrop), the
    // WebView's own scroll fires before the selection can expand, collapsing
    // it. We detect: active selection + touch movement > DRAG_THRESHOLD, then
    // post onSelHandleDragStart so the native side can temporarily disable
    // WebView scrollEnabled. On touch end/cancel we post onSelHandleDragEnd.
    var selHandleHasActiveSelection = false;
    var selHandleDragStartX = 0;
    var selHandleDragStartY = 0;
    var selHandleDragging = false;
    var SEL_HANDLE_DRAG_THRESHOLD = 6;

    document.addEventListener("selectionchange", function () {
      var sel = window.getSelection();
      selHandleHasActiveSelection = !!(sel && sel.rangeCount > 0 && !sel.isCollapsed);
    });

    document.addEventListener("touchstart", function (e) {
      var t = e.touches[0];
      if (t) {
        selHandleDragStartX = t.clientX;
        selHandleDragStartY = t.clientY;
      }
      selHandleDragging = false;
    }, { passive: true });

    document.addEventListener("touchmove", function (e) {
      if (selHandleDragging) return;
      if (!selHandleHasActiveSelection) return;
      var t = e.touches[0];
      if (!t) return;
      var dx = t.clientX - selHandleDragStartX;
      var dy = t.clientY - selHandleDragStartY;
      if (Math.sqrt(dx * dx + dy * dy) > SEL_HANDLE_DRAG_THRESHOLD) {
        selHandleDragging = true;
        postToRN({ type: "onSelHandleDragStart" });
      }
    }, { passive: true });

    document.addEventListener("touchend", function () {
      if (selHandleDragging) {
        selHandleDragging = false;
        postToRN({ type: "onSelHandleDragEnd" });
      }
    }, { passive: true });

    document.addEventListener("touchcancel", function () {
      if (selHandleDragging) {
        selHandleDragging = false;
        postToRN({ type: "onSelHandleDragEnd" });
      }
    }, { passive: true });

    // While an hr-control panel is active, intercept touches outside any
    // .hr-wrapper so the text editor cannot gain focus and the keyboard
    // stays dismissed. preventDefault() on touchstart suppresses the
    // subsequent focus/click events, so we also manually invoke the hide
    // callback so the panel closes on that same tap.
    document.addEventListener("touchstart", function (e) {
      if (!_hrBlockActive) return;
      const target = e.target as Node;
      const inWrapper = (target instanceof Element) && !!target.closest(".hr-wrapper");
      if (!inWrapper) {
        e.preventDefault();
        if (_hrActiveHide) {
          _hrActiveHide();
        } else {
          _deactivateHrBlock();
        }
      }
    }, { capture: true, passive: false });

    // For desktop/simulator mouse events: prevent focus on editor text while
    // an hr-control panel is open. The click event still fires after mousedown
    // preventDefault, so the existing outsideClickHandler will close the panel.
    document.addEventListener("mousedown", function (e) {
      if (!_hrBlockActive) return;
      const target = e.target as Node;
      const inWrapper = (target instanceof Element) && !!target.closest(".hr-wrapper");
      if (!inWrapper) {
        e.preventDefault();
      }
    }, { capture: true });
  });
})();
