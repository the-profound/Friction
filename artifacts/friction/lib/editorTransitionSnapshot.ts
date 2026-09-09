import {
  createReviewDocumentSnapshot,
  createThoughtDocumentSnapshot,
} from "@workspace/api-zod";

export interface EditorTransitionSnapshot {
  title: string;
  content: string;
  markdown?: string;
  titleMarkdown?: string;
  bodyMarkdown?: string;
  docVersion?: number;
  editorSessionId?: string;
}

export function createEditorTransitionSnapshot(
  markdown: string,
  title: string,
  metadata: { docVersion?: number; editorSessionId?: string } = {},
): EditorTransitionSnapshot {
  const thoughtSnapshot = createThoughtDocumentSnapshot(markdown, metadata);
  if (thoughtSnapshot) {
    return {
      ...thoughtSnapshot,
      // Existing autosave callers use `content` for the complete thought
      // Markdown. The canonical body remains available as bodyMarkdown.
      content: thoughtSnapshot.markdown,
    };
  }
  const snapshot = createReviewDocumentSnapshot(markdown, title, metadata);
  return {
    ...snapshot,
    content: snapshot.bodyMarkdown,
  };
}

export function isEditorReloadInterruption(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("reloaded before export completed")
    || message.includes("stale reload session")
  );
}

export async function exportEditorTransitionSnapshot(
  requestSnapshot: () => Promise<EditorTransitionSnapshot>,
  maxAttempts = 2,
): Promise<EditorTransitionSnapshot> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await requestSnapshot();
    } catch (error) {
      lastError = error;
      if (!isEditorReloadInterruption(error) || attempt === maxAttempts - 1) {
        throw error;
      }
    }
  }
  throw lastError;
}