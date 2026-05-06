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
import { HardBreak } from "@tiptap/extension-hard-break";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

interface OverflowRange {
  pageIndex: number;
  startCharOffset: number;
}

const overflowPluginKey = new PluginKey<DecorationSet>("overflow-highlights");

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

    // 마지막 블록이 단락(<p>)이 아닌 경우(예: blockquote, 리스트, 헤딩으로 문서가
    // 끝나는 경우) 그 아래를 탭해도 커서를 잡을 ProseMirror 노드가 없어 입력이
    // 불가능해진다. 이를 방지하기 위해 항상 빈 단락을 마지막에 보장한다.
    const last = blocks[blocks.length - 1];
    if (!last || !/<\/p>$/.test(last)) {
      blocks.push("<p></p>");
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
  availableContentHeightPx?: number | null;
  text?: string;
  fontSizePx?: number;
  letterSpacingPx?: number;
  titleFontSizePx?: number;
  blockType?: string;
  mark?: string;
  pageIndex?: number;
  blockIndex?: number;
}

(function () {
  let editor: Editor | null = null;
  let titleInput: HTMLTextAreaElement | null = null;
  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  const CHANGE_THROTTLE_MS = 400;

  // 오버플로 강조 측정 — RN 이 setOverflowProbeConfig 로 안전 영역 높이를
  // 알려주면 에디터가 자기 DOM 을 walk 해서 각 페이지(HR 분할)에서 안전 영역을
  // 처음 벗어나는 PM position 을 찾고 [그 위치 ~ 페이지 끝] 을 강조한다.
  // RN 측 측정 레이어(WebViewMeasureLayer) 의 margin/padding 가정과 무관하게
  // 항상 에디터의 실제 시각 레이아웃과 정확히 일치한다.
  let overflowAvailableContentHeight: number | null = null;
  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  const PROBE_DEBOUNCE_MS = 80;

  function scheduleOverflowProbe(delay: number = PROBE_DEBOUNCE_MS) {
    // probe 비활성 (작성 탭 등) 일 때는 doc 변경 핫패스에서 빈 ranges 트랜잭션을
    // 매번 dispatch 하지 않도록 타이머 자체를 걸지 않는다. ProseMirror 트랜잭션은
    // 본문이 길수록 비용이 커서 입력 멈춤의 한 원인이 된다.
    if (overflowAvailableContentHeight == null) return;
    if (probeTimer) clearTimeout(probeTimer);
    probeTimer = setTimeout(runOverflowProbe, delay);
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
              const charOffset = pmPosToPageCharOffset(doc, page.start, blockStartPmPos + 1);
              ranges.push({ pageIndex: pi, startCharOffset: charOffset });
            }
          }
        }
      } catch {
        // DOM 접근 실패 시 이 페이지 강조는 조용히 건너뛴다.
      }
    }

    if (!editor || editor.isDestroyed) return;
    const tr = editor.state.tr.setMeta(overflowPluginKey, { ranges });
    editor.view.dispatch(tr);
  }

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
    };
  }

  function postSelectionState(ed: Editor) {
    postToRN({ type: "onSelectionUpdate", payload: getSelectionPayload(ed) });
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
        Heading.extend({
          addKeyboardShortcuts() {
            return {
              Backspace: ({ editor: ed }) => {
                const { selection } = ed.state;
                const { $from, empty } = selection;
                if (!empty) return false;
                if ($from.parentOffset !== 0) return false;
                if ($from.parent.type !== this.type) return false;
                return ed.commands.setParagraph();
              },
            };
          },
        }).configure({ levels: [1, 2, 3] }),
        Bold,
        Italic,
        Underline,
        Blockquote,
        HorizontalRuleWithControls,
        BulletList,
        OrderedList,
        ListItem,
        UndoRedo,
        HardBreak,
        Placeholder.configure({ placeholder }),
        OverflowDecorationExtension,
        SelectionStabilityExtension,
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
        postSelectionState(ed);
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
          // 초기 콘텐츠 레이아웃이 안정된 뒤 한 번 강조를 측정한다.
          scheduleOverflowProbe(150);
          break;
        }
        case "setMarkdown": {
          if (editor && !editor.isDestroyed) {
            const html = markdownToHtml(cmd.markdown || "");
            editor.commands.setContent(html);
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
        case "setOverflowProbeConfig": {
          const next = cmd.availableContentHeightPx;
          const prev = overflowAvailableContentHeight;
          overflowAvailableContentHeight = (next != null && next > 0) ? next : null;
          if (overflowAvailableContentHeight == null) {
            // probe 가 비활성화되는 순간 1회만 강조를 비운다.
            // (이후 doc 변경 시에는 scheduleOverflowProbe 가 no-op 이라 트랜잭션이 발생하지 않는다.)
            if (prev != null && editor && !editor.isDestroyed) {
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
          const root = document.documentElement;
          if (cmd.fontSizePx != null) {
            root.style.setProperty("--body-font-size", cmd.fontSizePx + "px");
          }
          if (cmd.letterSpacingPx != null) {
            root.style.setProperty("--body-letter-spacing", cmd.letterSpacingPx + "px");
          }
          if (cmd.titleFontSizePx != null) {
            root.style.setProperty("--title-font-size", cmd.titleFontSizePx + "px");
            if (titleInput) autoResizeTitle();
          }
          // 폰트/자간이 바뀌면 줄바꿈 위치도 바뀌므로 강조 재측정.
          scheduleOverflowProbe(150);
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
            editor.chain().focus().setHorizontalRule().run();
          }
          break;
        }
        case "insertHardBreak": {
          if (editor && !editor.isDestroyed) {
            editor.chain().focus().setHardBreak().run();
          }
          break;
        }
        case "scrollToBlock": {
          if (editor && !editor.isDestroyed) {
            const pageIdx = cmd.pageIndex ?? 0;
            const blockIdx = cmd.blockIndex ?? 0;
            const doc = editor.state.doc;
            const pageRanges = getPageRanges(doc);
            const page = pageRanges[pageIdx] ?? pageRanges[0];
            if (!page) break;

            // Walk top-level nodes inside the page to find the Nth content block.
            let blockCount = 0;
            let targetPos = -1;
            doc.forEach((node, offset) => {
              if (targetPos >= 0) return;
              // Skip nodes outside this page range.
              if (offset < page.start || offset >= page.end) return;
              // Skip HR dividers — they are page separators, not content blocks.
              if (node.type.name === "horizontalRule") return;
              if (blockCount === blockIdx) {
                targetPos = offset;
              } else {
                blockCount++;
              }
            });

            // Fallback: use page start when the specific block isn't found.
            if (targetPos < 0) {
              doc.forEach((node, offset) => {
                if (targetPos >= 0) return;
                if (offset < page.start || offset >= page.end) return;
                if (node.type.name !== "horizontalRule") {
                  targetPos = offset;
                }
              });
            }
            if (targetPos < 0) targetPos = page.start;

            // Scroll the block DOM element into view.
            try {
              const view = editor.view;
              const resolvedPos = Math.max(1, targetPos + 1);
              const domInfo = view.domAtPos(resolvedPos);
              let el: Node | null = domInfo.node;
              if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
              while (el && (el as Element).parentElement !== view.dom) {
                el = (el as Element).parentElement;
              }
              if (el) {
                (el as Element).scrollIntoView({ behavior: "smooth", block: "center" });
                // Highlight pulse animation.
                const blockEl = el as Element;
                blockEl.classList.add("anchor-highlight");
                setTimeout(() => {
                  blockEl.classList.remove("anchor-highlight");
                }, 1400);
              }
            } catch {}
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
