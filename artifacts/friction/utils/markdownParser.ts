import { marked, type Token, type Tokens } from "marked";
import { splitLeadingH1Markdown } from "./leadingH1";
import { thoughtTitleMarkdownToText } from "@workspace/api-zod";

export type InlineToken =
  | { kind: "text"; value: string }
  | { kind: "break"; value: "\n" }
  | { kind: "bold"; value: string }
  | { kind: "italic"; value: string }
  | { kind: "bold_italic"; value: string }
  | { kind: "underline"; value: string };

export type MarkdownBlockType =
  | { type: "h1"; tokens: InlineToken[]; rawText: string }
  | { type: "h2"; tokens: InlineToken[]; rawText: string }
  | { type: "h3"; tokens: InlineToken[]; rawText: string }
  | { type: "paragraph"; tokens: InlineToken[]; rawText: string }
  | {
      type: "blockquote";
      tokens: InlineToken[];
      rawText: string;
      quoteGroup?: number;
    }
  | { type: "ul_item"; tokens: InlineToken[]; rawText: string }
  | { type: "ol_item"; tokens: InlineToken[]; rawText: string; index: number };

function splitOnUnderline(text: string): InlineToken[] {
  const result: InlineToken[] = [];
  const pattern = /<u>([\s\S]*?)<\/u>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({ kind: "text", value: text.slice(lastIndex, match.index) });
    }
    result.push({ kind: "underline", value: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    result.push({ kind: "text", value: text.slice(lastIndex) });
  }
  if (result.length === 0) {
    result.push({ kind: "text", value: text });
  }
  return result;
}

function expandUnderlines(tokens: InlineToken[]): InlineToken[] {
  const result: InlineToken[] = [];
  for (const token of tokens) {
    if (token.kind === "text" && token.value.includes("<u>")) {
      result.push(...splitOnUnderline(token.value));
    } else {
      result.push(token);
    }
  }
  return result;
}

function parseInlineMarkedTokens(markedTokens: Token[]): InlineToken[] {
  const result: InlineToken[] = [];
  for (let index = 0; index < markedTokens.length; index++) {
    const token = markedTokens[index];
    if (token.type === "html" && /^<u>$/i.test((token as { raw: string }).raw.trim())) {
      const underlined: InlineToken[] = [];
      index++;
      while (index < markedTokens.length) {
        const child = markedTokens[index];
        if (child.type === "html" && /^<\/u>$/i.test((child as { raw: string }).raw.trim())) break;
        underlined.push(...parseInlineMarkedTokens([child]));
        index++;
      }
      result.push({
        kind: "underline",
        value: tokensToPlainText(underlined),
      });
      continue;
    }
    if (token.type === "text") {
      const t = token as Tokens.Text;
      if (t.tokens && t.tokens.length > 0) {
        result.push(...parseInlineMarkedTokens(t.tokens));
      } else {
        result.push({ kind: "text", value: t.text });
      }
    } else if (token.type === "strong") {
      const t = token as Tokens.Strong;
      const inner = t.tokens ? parseInlineMarkedTokens(t.tokens) : [{ kind: "text" as const, value: t.text }];
      for (const child of inner) {
        if (child.kind === "italic") {
          result.push({ kind: "bold_italic", value: child.value });
        } else {
          result.push({ kind: "bold", value: child.value });
        }
      }
    } else if (token.type === "em") {
      const t = token as Tokens.Em;
      const inner = t.tokens ? parseInlineMarkedTokens(t.tokens) : [{ kind: "text" as const, value: t.text }];
      for (const child of inner) {
        if (child.kind === "bold") {
          result.push({ kind: "bold_italic", value: child.value });
        } else {
          result.push({ kind: "italic", value: child.value });
        }
      }
    } else if (token.type === "br") {
      result.push({ kind: "break", value: "\n" });
    } else if (token.type === "link") {
      const t = token as Tokens.Link;
      // Card/list plain text must show a link's label, never its Markdown URL.
      result.push(...(t.tokens ? parseInlineMarkedTokens(t.tokens) : [{ kind: "text" as const, value: t.text }]));
    } else if (token.type === "html") {
      // marked keeps inline <u>...</u> as an HTML token; route it through the
      // same supported-inline sanitizer rather than exposing markup literally.
      result.push(...expandUnderlines([{ kind: "text", value: (token as { raw: string }).raw }]));
    } else if ("raw" in token) {
      result.push({ kind: "text", value: (token as { raw: string }).raw });
    }
  }
  return expandUnderlines(result);
}

function inlineTokensFromText(text: string): InlineToken[] {
  if (!text) return [];
  const inlineTokens = marked.lexer(text, { breaks: false, gfm: true });
  const firstBlock = inlineTokens[0];
  if (firstBlock && firstBlock.type === "paragraph" && (firstBlock as Tokens.Paragraph).tokens) {
    return parseInlineMarkedTokens((firstBlock as Tokens.Paragraph).tokens!);
  }
  return expandUnderlines([{ kind: "text", value: text }]);
}

export function tokensToPlainText(tokens: InlineToken[]): string {
  // marked can split inline underline HTML into separate opening/text/closing
  // tokens. Plain-text consumers must never surface those delimiters.
  return tokens.map((t) => t.value).join("").replace(/<\/?u>/gi, "");
}

export interface ParsedLeadingH1Markdown {
  title: string;
  titleMarkdown: string;
  body: string;
}

export function parseLeadingH1Markdown(markdown: string): ParsedLeadingH1Markdown | null {
  const split = splitLeadingH1Markdown(markdown);
  if (!split) return null;
  const title = thoughtTitleMarkdownToText(split.titleMarkdown);
  return { ...split, title };
}

function flattenListItems(
  items: Tokens.ListItem[],
  ordered: boolean,
  startIndex: number,
): MarkdownBlockType[] {
  const result: MarkdownBlockType[] = [];
  let idx = startIndex;
  for (const item of items) {
    const rawText = item.text ?? "";
    const tokens = inlineTokensFromText(rawText);
    if (ordered) {
      result.push({ type: "ol_item", tokens, rawText, index: idx++ });
    } else {
      result.push({ type: "ul_item", tokens, rawText });
    }
  }
  return result;
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlockType[] {
  if (typeof markdown !== 'string') return [];
  if (!markdown || !markdown.trim()) return [];

  const blocks: MarkdownBlockType[] = [];
  let quoteGroup = 0;
  const leadingH1 = splitLeadingH1Markdown(markdown);
  const source = leadingH1?.body ?? markdown;
  if (leadingH1) {
    blocks.push({
      type: "h1",
      tokens: inlineTokensFromText(leadingH1.titleMarkdown),
      rawText: leadingH1.titleMarkdown,
    });
  }
  const lexed = marked.lexer(source, { breaks: true, gfm: true });

  for (const token of lexed) {
    if (token.type === "heading") {
      const t = token as Tokens.Heading;
      const rawText = t.text;
      const tokens = t.tokens ? parseInlineMarkedTokens(t.tokens) : expandUnderlines([{ kind: "text" as const, value: rawText }]);
      if (t.depth === 1) blocks.push({ type: "h1", tokens, rawText });
      else if (t.depth === 2) blocks.push({ type: "h2", tokens, rawText });
      else blocks.push({ type: "h3", tokens, rawText });
    } else if (token.type === "paragraph") {
      const t = token as Tokens.Paragraph;
      const rawText = t.text;
      // 에디터(TipTap)는 빈 단락을 직렬화할 때 연속 빈 단락 사이에
      // `&nbsp;` 만 들어 있는 단락을 끼워 넣는다. 이 단락은 시각적으로
      // 빈 줄이며 에디터에서도 텍스트 컨텐츠가 0이므로 빈 단락 블록으로
      // 정규화해야 측정·offset 모두 정합한다.
      const trimmed = rawText.trim();
      if (trimmed === "&nbsp;" || trimmed === "\u00A0") {
        blocks.push({ type: "paragraph", tokens: [], rawText: "" });
      } else {
        const tokens = t.tokens ? parseInlineMarkedTokens(t.tokens) : expandUnderlines([{ kind: "text" as const, value: rawText }]);
        blocks.push({ type: "paragraph", tokens, rawText });
      }
    } else if (token.type === "blockquote") {
      const t = token as Tokens.Blockquote;
      const rawText = t.text;
      const currentQuoteGroup = quoteGroup++;
      // 내용 없는 ">"(빈 인용, 과거 데이터에 남아 있을 수 있음)는 회색
      // 세로줄만 남기는 잔상이 되므로 빈 단락으로 치환한다.
      if (rawText.trim() === "") {
        blocks.push({ type: "paragraph", tokens: [], rawText: "" });
      } else {
        const innerBlocks = parseMarkdownBlocks(rawText);
        if (innerBlocks.length > 0) {
          for (const inner of innerBlocks) {
            blocks.push({
              type: "blockquote",
              tokens: inner.tokens,
              rawText: inner.rawText,
              quoteGroup: currentQuoteGroup,
            });
          }
        } else {
          blocks.push({
            type: "blockquote",
            tokens: expandUnderlines([{ kind: "text", value: rawText }]),
            rawText,
            quoteGroup: currentQuoteGroup,
          });
        }
      }
    } else if (token.type === "list") {
      const t = token as Tokens.List;
      blocks.push(...flattenListItems(t.items, t.ordered, t.start as number || 1));
    } else if (token.type === "space") {
      // 빈 줄(엔터)을 측정·표시에 한 줄씩 반영하기 위해 빈 단락 블록으로 보존한다.
      // marked 는 단락 사이의 기본 구분자도 space("\n\n") 토큰으로 내보낸다.
      // 그러므로 기본 구분 2개 newline 은 빈 단락 0개에 해당하고, 그 위로
       // newline 하나가 더해질 때마다 빈 단락 1개가 추가된 것이다.
       // 즉 추가 빈 단락 수 = max(0, newlines - 2).
      const raw = (token as { raw?: string }).raw ?? "";
      const newlines = (raw.match(/\n/g) ?? []).length;
       const extraEmpty = Math.max(0, newlines - 2);
      for (let k = 0; k < extraEmpty; k++) {
        blocks.push({ type: "paragraph", tokens: [], rawText: "" });
      }
    }
  }

  return blocks;
}
