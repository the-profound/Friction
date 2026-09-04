export interface EditorTransitionSnapshot {
  title: string;
  content: string;
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