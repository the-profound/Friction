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

export interface KeyedSingleFlight<TResult> {
  run(key: string, operation: () => Promise<TResult>): Promise<TResult>;
  pendingKey(): string | undefined;
}

export function shouldShowReadingThoughtToolbar(input: {
  visible: boolean;
  editorActive: boolean;
  editorFocused: boolean;
  keyboardVisible: boolean;
  native: boolean;
}): boolean {
  return input.visible
    && input.editorActive
    && input.editorFocused
    && input.keyboardVisible
    && input.native;
}

/**
 * TextInput/platform/server boundaries may produce different line separators.
 * Store one canonical LF representation without trimming user-authored structure.
 */
export function normalizeThoughtLineBreaks(text: string): string {
  return text.replace(/\r\n?|\u2028|\u2029/g, "\n");
}

/**
 * 저장 작업이 최신 편집 스냅샷을 동기적으로 캡처하게 한 뒤, 그 Promise를 기다리지
 * 않고 같은 호출 스택에서 닫기 피드백을 시작한다.
 */
export function startImmediateClose(
  saveSnapshot: () => Promise<boolean>,
  startClose: () => void,
): Promise<boolean> {
  const save = saveSnapshot();
  startClose();
  return save;
}

/**
 * 같은 편집 키의 중복 요청만 한 물리 요청을 공유한다. 다른 키는 앞 요청이 끝난 뒤
 * 자신의 operation을 실행해, 오래된 저장 성공을 새 편집의 성공으로 오인하지 않는다.
 */
export function createKeyedSingleFlight<TResult>(): KeyedSingleFlight<TResult> {
  let pending: { key: string; promise: Promise<TResult> } | null = null;
  return {
    run(key, operation) {
      if (pending?.key === key) return pending.promise;
      const previous = pending?.promise.catch(() => undefined);
      let started!: Promise<TResult>;
      started = (previous ? previous.then(operation) : operation()).finally(() => {
        if (pending?.promise === started) pending = null;
      });
      pending = { key, promise: started };
      return started;
    },
    pendingKey() {
      return pending?.key;
    },
  };
}

export function mergeReadingThoughtsById<T extends { id: string; content?: unknown }>(
  serverThoughts: readonly T[],
  optimisticThoughts: readonly OptimisticReadingThought[],
): Array<T | OptimisticReadingThought> {
  const optimisticById = new Map(optimisticThoughts.map((thought) => [thought.id, thought]));
  const merged: Array<T | OptimisticReadingThought> = serverThoughts.map(
    (thought) => {
      const optimistic = optimisticById.get(thought.id);
      if (!optimistic) return thought;
      // 확정된 수정 fence는 서버 카드 형태를 유지해 빠른 재열기에도 다시 편집할 수
      // 있게 하되, 지연 목록 응답의 이전 content만 덮어쓴다.
      if (optimistic.saveState === "confirmed") {
        return { ...thought, content: optimistic.content };
      }
      return optimistic;
    },
  );
  const serverIds = new Set(serverThoughts.map((thought) => thought.id));
  for (const thought of optimisticThoughts) {
    if (!serverIds.has(thought.id)) merged.push(thought);
  }
  return merged;
}

export function reconcileConfirmedThoughts<T extends { id: string; content?: unknown }>(
  serverThoughts: readonly T[],
  optimisticThoughts: readonly OptimisticReadingThought[],
): OptimisticReadingThought[] {
  return optimisticThoughts.filter((optimistic) => {
    if (optimistic.saveState !== "confirmed") return true;
    const server = serverThoughts.find((thought) => thought.id === optimistic.id);
    return server?.content !== optimistic.content;
  });
}

export function reconcileDeletedThoughtIds<T extends { id: string }>(
  serverThoughts: readonly T[],
  deletedIds: ReadonlySet<string>,
): Set<string> {
  const serverIds = new Set(serverThoughts.map((thought) => thought.id));
  return new Set([...deletedIds].filter((id) => serverIds.has(id)));
}

export function isCurrentOptimisticRequest(
  thought: OptimisticReadingThought | undefined,
  requestGeneration: number,
): boolean {
  return thought?.requestGeneration === requestGeneration;
}

export function isCurrentEditorCommit(
  currentEditorKey: string | undefined,
  committedEditorKey: string,
): boolean {
  return currentEditorKey === committedEditorKey;
}

export function getThoughtInlineCommitAction(input: {
  isExisting: boolean;
  text: string;
  initialText: string;
}): ThoughtInlineCommitAction {
  const text = normalizeThoughtLineBreaks(input.text).trim();
  const initialText = normalizeThoughtLineBreaks(input.initialText).trim();

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