import { marked, type Token, type Tokens } from "marked";

export type InlineToken =
  | { kind: "text"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "italic"; value: string }
  | { kind: "bold_italic"; value: string };

export type MarkdownBlockType =
  | { type: "h1"; tokens: InlineToken[]; rawText: string }
  | { type: "h2"; tokens: InlineToken[]; rawText: string }
  | { type: "h3"; tokens: InlineToken[]; rawText: string }
  | { type: "paragraph"; tokens: InlineToken[]; rawText: string }
  | { type: "blockquote"; tokens: InlineToken[]; rawText: string }
  | { type: "ul_item"; tokens: InlineToken[]; rawText: string }
  | { type: "ol_item"; tokens: InlineToken[]; rawText: string; index: number };

function parseInlineMarkedTokens(markedTokens: Token[]): InlineToken[] {
  const result: InlineToken[] = [];
  for (const token of markedTokens) {
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
    } else if ("raw" in token) {
      result.push({ kind: "text", value: (token as { raw: string }).raw });
    }
  }
  return result;
}

function inlineTokensFromText(text: string): InlineToken[] {
  if (!text) return [];
  const inlineTokens = marked.lexer(text, { breaks: false, gfm: true });
  const firstBlock = inlineTokens[0];
  if (firstBlock && firstBlock.type === "paragraph" && (firstBlock as Tokens.Paragraph).tokens) {
    return parseInlineMarkedTokens((firstBlock as Tokens.Paragraph).tokens!);
  }
  return [{ kind: "text", value: text }];
}

export function tokensToPlainText(tokens: InlineToken[]): string {
  return tokens.map((t) => t.value).join("");
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
  if (!markdown || !markdown.trim()) return [];

  const lexed = marked.lexer(markdown, { breaks: true, gfm: true });
  const blocks: MarkdownBlockType[] = [];

  for (const token of lexed) {
    if (token.type === "heading") {
      const t = token as Tokens.Heading;
      const rawText = t.text;
      const tokens = t.tokens ? parseInlineMarkedTokens(t.tokens) : [{ kind: "text" as const, value: rawText }];
      if (t.depth === 1) blocks.push({ type: "h1", tokens, rawText });
      else if (t.depth === 2) blocks.push({ type: "h2", tokens, rawText });
      else blocks.push({ type: "h3", tokens, rawText });
    } else if (token.type === "paragraph") {
      const t = token as Tokens.Paragraph;
      const rawText = t.text;
      const tokens = t.tokens ? parseInlineMarkedTokens(t.tokens) : [{ kind: "text" as const, value: rawText }];
      blocks.push({ type: "paragraph", tokens, rawText });
    } else if (token.type === "blockquote") {
      const t = token as Tokens.Blockquote;
      const rawText = t.text;
      const innerBlocks = parseMarkdownBlocks(rawText);
      if (innerBlocks.length > 0) {
        for (const inner of innerBlocks) {
          blocks.push({ type: "blockquote", tokens: inner.tokens, rawText: inner.rawText });
        }
      } else {
        blocks.push({ type: "blockquote", tokens: [{ kind: "text", value: rawText }], rawText });
      }
    } else if (token.type === "list") {
      const t = token as Tokens.List;
      blocks.push(...flattenListItems(t.items, t.ordered, t.start as number || 1));
    } else if (token.type === "space") {
      // skip
    }
  }

  return blocks;
}
