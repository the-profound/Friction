import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { OverflowRange } from "./types";

const overflowPluginKey = new PluginKey<DecorationSet>("web-overflow-highlights");

function getPageRanges(doc: ProseMirrorNode): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let pageStart = 0;
  doc.forEach((node, offset) => {
    if (node.type.name === "horizontalRule") {
      ranges.push({ start: pageStart, end: offset });
      pageStart = offset + node.nodeSize;
    }
  });
  ranges.push({ start: pageStart, end: doc.content.size });
  return ranges;
}

function pageCharOffset(doc: ProseMirrorNode, pageStart: number, pos: number): number {
  let offset = 0;
  doc.nodesBetween(pageStart, pos, (node, nodePos) => {
    if (!node.isText) return true;
    const overlapStart = Math.max(nodePos, pageStart);
    const overlapEnd = Math.min(nodePos + node.nodeSize, pos);
    if (overlapEnd > overlapStart) offset += overlapEnd - overlapStart;
    return true;
  });
  return offset;
}

function createDecorations(doc: ProseMirrorNode, ranges: OverflowRange[]): DecorationSet {
  const pageRanges = getPageRanges(doc);
  const decorations: Decoration[] = [];

  for (const range of ranges) {
    const page = pageRanges[range.pageIndex];
    if (!page || page.end <= page.start) continue;

    let charsRemaining = Math.max(0, range.startCharOffset);
    let highlightStart = -1;
    doc.nodesBetween(page.start, page.end, (node, pos) => {
      if (highlightStart >= 0) return false;
      if (!node.isText) return true;
      const length = node.text?.length ?? 0;
      if (charsRemaining < length) {
        highlightStart = Math.min(Math.max(pos + charsRemaining, page.start), page.end);
        return false;
      }
      charsRemaining -= length;
      return true;
    });

    if (highlightStart >= page.start && highlightStart < page.end) {
      decorations.push(
        Decoration.inline(highlightStart, page.end, { class: "overflow-highlight" }),
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

export const WebOverflowHighlightExtension = Extension.create({
  name: "webOverflowHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: overflowPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, previous) {
            const meta = transaction.getMeta(overflowPluginKey) as
              | { ranges: OverflowRange[] | null }
              | undefined;
            if (meta) return createDecorations(transaction.doc, meta.ranges ?? []);
            return transaction.docChanged
              ? previous.map(transaction.mapping, transaction.doc)
              : previous;
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

export function setWebOverflowRanges(
  editor: Editor,
  ranges: OverflowRange[] | null,
): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(overflowPluginKey, { ranges: ranges ?? [] }),
  );
}

export function measureAndHighlightWebOverflow(
  editor: Editor,
  availableContentHeightPx: number | null,
): void {
  if (editor.isDestroyed) return;
  if (availableContentHeightPx == null || availableContentHeightPx <= 0) {
    setWebOverflowRanges(editor, []);
    return;
  }

  const view = editor.view;
  const doc = editor.state.doc;
  const pageRanges = getPageRanges(doc);
  const ranges: OverflowRange[] = [];

  for (let pageIndex = 0; pageIndex < pageRanges.length; pageIndex += 1) {
    const page = pageRanges[pageIndex];
    if (page.end <= page.start) continue;

    let firstTextPos = -1;
    doc.nodesBetween(page.start, page.end, (node, pos) => {
      if (firstTextPos >= 0) return false;
      if (node.isText && node.text) {
        firstTextPos = pos;
        return false;
      }
      return true;
    });
    if (firstTextPos < 0) continue;

    let pageTop: number;
    try {
      pageTop = view.coordsAtPos(firstTextPos + 1).top;
    } catch {
      continue;
    }
    const availableBottom = pageTop + availableContentHeightPx;

    let low = firstTextPos + 1;
    let high = page.end;
    while (low < high) {
      const middle = (low + high) >> 1;
      try {
        if (view.coordsAtPos(middle).bottom > availableBottom) {
          high = middle;
        } else {
          low = middle + 1;
        }
      } catch {
        low = middle + 1;
      }
    }

    if (low < page.end) {
      ranges.push({
        pageIndex,
        startCharOffset: pageCharOffset(doc, page.start, low),
      });
      continue;
    }

    // coordsAtPos does not include a block's bottom margin. Keep the visible
    // editor warning aligned with the hidden measurement layer when only that
    // margin crosses the page boundary.
    try {
      const lastProbePos = Math.max(firstTextPos + 1, page.end - 1);
      const domInfo = view.domAtPos(lastProbePos);
      let element: Node | null = domInfo.node;
      if (element.nodeType === Node.TEXT_NODE) element = element.parentElement;
      while (element && (element as Element).parentElement !== view.dom) {
        element = (element as Element).parentElement;
      }
      const blockElement = element as Element | null;
      if (blockElement) {
        const rect = blockElement.getBoundingClientRect();
        const marginBottom =
          Number.parseFloat(getComputedStyle(blockElement).marginBottom) || 0;
        if (rect.bottom + marginBottom > availableBottom) {
          const blockStart = view.posAtDOM(blockElement, 0);
          if (blockStart >= page.start && blockStart < page.end) {
            ranges.push({
              pageIndex,
              startCharOffset: pageCharOffset(doc, page.start, blockStart + 1),
            });
          }
        }
      }
    } catch {
      // A transient DOM remount should not interrupt editing; the next probe
      // will run after the next document or layout update.
    }
  }

  setWebOverflowRanges(editor, ranges);
}