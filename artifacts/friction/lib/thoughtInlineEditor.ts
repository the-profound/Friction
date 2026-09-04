export type ThoughtInlineCommitAction =
  | "discard-new"
  | "create"
  | "delete"
  | "update"
  | "unchanged";

export function getThoughtInlineCommitAction(input: {
  isExisting: boolean;
  text: string;
  initialText: string;
}): ThoughtInlineCommitAction {
  const text = input.text.trim();
  const initialText = input.initialText.trim();

  if (!input.isExisting) return text ? "create" : "discard-new";
  if (!text) return "delete";
  return text === initialText ? "unchanged" : "update";
}

export function formatReadingThoughtQuote(
  selectedText: string,
  source?: string,
): string {
  const quote = selectedText.trim().replace(/\n/g, "\n> ");
  return source ? `> ${quote}\n\n— ${source}` : `> ${quote}`;
}