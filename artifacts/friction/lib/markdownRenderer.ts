import type { InlineToken, MarkdownBlockType } from "@/utils/markdownParser";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * InlineToken 배열을 HTML 인라인 마크업으로 변환한다.
 * markdownParser가 파싱한 토큰 구조체를 받아 WebView 측정 HTML에 삽입하는 데 사용한다.
 */
export function inlineTokensToHtml(tokens: InlineToken[]): string {
  return tokens
    .map((t) => {
      switch (t.kind) {
        case "text":
          return escapeHtml(t.value);
        case "bold":
          return `<strong>${escapeHtml(t.value)}</strong>`;
        case "italic":
          return `<em>${escapeHtml(t.value)}</em>`;
        case "bold_italic":
          return `<strong><em>${escapeHtml(t.value)}</em></strong>`;
        case "underline":
          return `<u>${escapeHtml(t.value)}</u>`;
        default:
          return escapeHtml((t as { value: string }).value ?? "");
      }
    })
    .join("");
}

/**
 * 사전 파싱된 MarkdownBlockType 하나를 HTML 문자열로 변환한다.
 * 마진은 모두 제거된 상태(margin:0)로 반환되므로 WebViewMeasureLayer에서
 * blockGap을 별도로 더해 PretextMeasureLayer와 동일한 높이 계약을 유지한다.
 */
export function blockToHtml(block: MarkdownBlockType): string {
  const inner = inlineTokensToHtml(block.tokens);
  switch (block.type) {
    case "h1":
      return `<h1>${inner}</h1>`;
    case "h2":
      return `<h2>${inner}</h2>`;
    case "h3":
      return `<h3>${inner}</h3>`;
    case "paragraph":
      return `<p>${inner}</p>`;
    case "blockquote":
      return `<blockquote><p>${inner}</p></blockquote>`;
    case "ul_item":
      return `<ul><li><p>${inner}</p></li></ul>`;
    case "ol_item":
      return `<ol start="${block.index}"><li><p>${inner}</p></li></ol>`;
    default:
      return `<p>${inner}</p>`;
  }
}

/**
 * MarkdownBlockType 배열을 순서대로 HTML 문자열로 이어 붙인다.
 */
export function blocksToHtml(blocks: MarkdownBlockType[]): string {
  return blocks.map(blockToHtml).join("");
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, "$1<em>$2</em>");
  out = out.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, "<u>$1</u>");
  return out;
}

export function markdownToHtml(md: string): string {
  try {
    const text = (md || "").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    const blocks: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") { i++; continue; }
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push("<hr>"); i++; continue; }

      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        i++; continue;
      }

      if (/^>\s?/.test(line)) {
        const quoteLines: string[] = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { quoteLines.push(lines[i].replace(/^>\s?/, "")); i++; }
        const inner: string[] = [];
        let para: string[] = [];
        for (const q of quoteLines) {
          if (q.trim() === "") { if (para.length) { inner.push(`<p>${renderInline(para.join(" "))}</p>`); para = []; } }
          else { para.push(q); }
        }
        if (para.length) inner.push(`<p>${renderInline(para.join(" "))}</p>`);
        blocks.push(`<blockquote>${inner.join("")}</blockquote>`);
        continue;
      }

      if (/^[-*]\s+(.*)$/.exec(line)) {
        const items: string[] = [];
        while (i < lines.length) { const m = /^[-*]\s+(.*)$/.exec(lines[i]); if (!m) break; items.push(`<li><p>${renderInline(m[1])}</p></li>`); i++; }
        blocks.push(`<ul>${items.join("")}</ul>`);
        continue;
      }

      if (/^\d+\.\s+(.*)$/.exec(line)) {
        const items: string[] = [];
        while (i < lines.length) { const m = /^\d+\.\s+(.*)$/.exec(lines[i]); if (!m) break; items.push(`<li><p>${renderInline(m[1])}</p></li>`); i++; }
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
      ) { paraLines.push(lines[i]); i++; }
      const pInner = paraLines.map((l, idx) => idx === 0 ? renderInline(l) : "<br>" + renderInline(l)).join("");
      blocks.push(`<p>${pInner}</p>`);
    }

    return blocks.join("");
  } catch {
    return `<p>${escapeHtml(md || "")}</p>`;
  }
}
