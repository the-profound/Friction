export type ThoughtInlineCommitAction =
  | "discard-new"
  | "create"
  | "delete"
  | "update"
  | "unchanged";

export type OptimisticThoughtSaveState = "pending" | "failed" | "confirmed";

export interface OptimisticReadingThought {
  id: string;
  content: string;
  sourceArticleId?: string;
  createdAt: string;
  saveState: OptimisticThoughtSaveState;
  error?: string;
  requestGeneration: number;
}

export function mergeReadingThoughtsById<T extends { id: string }>(
  serverThoughts: readonly T[],
  optimisticThoughts: readonly OptimisticReadingThought[],
): Array<T | OptimisticReadingThought> {
  const optimisticById = new Map(optimisticThoughts.map((thought) => [thought.id, thought]));
  const merged: Array<T | OptimisticReadingThought> = serverThoughts.map(
    (thought) => optimisticById.get(thought.id) ?? thought,
  );
  const serverIds = new Set(serverThoughts.map((thought) => thought.id));
  for (const thought of optimisticThoughts) {
    if (!serverIds.has(thought.id)) merged.push(thought);
  }
  return merged;
}

export function isCurrentOptimisticRequest(
  thought: OptimisticReadingThought | undefined,
  requestGeneration: number,
): boolean {
  return thought?.requestGeneration === requestGeneration;
}

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