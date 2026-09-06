/**
 * Cover photo selection/upload now happens only on the dedicated cover-edit
 * page (app/on-01c-cover.tsx), a separate route from the closing screen
 * (app/on-01c.tsx). The closing screen's export action still needs to know
 * whether a photo operation is in flight for the same article so it can block
 * export with the same guidance toast as before. Mirrors the small
 * subscribable-singleton pattern in nativeBodyFontMode.ts instead of
 * threading React state through navigation params.
 */

type Listener = () => void;

const uploadingArticleIds = new Set<string>();
const listeners = new Set<Listener>();

export function isCoverPhotoUploadInProgress(articleId: string): boolean {
  return uploadingArticleIds.has(articleId);
}

export function setCoverPhotoUploadInProgress(articleId: string, active: boolean): void {
  const before = uploadingArticleIds.has(articleId);
  if (active) {
    uploadingArticleIds.add(articleId);
  } else {
    uploadingArticleIds.delete(articleId);
  }
  if (before !== uploadingArticleIds.has(articleId)) {
    for (const listener of listeners) listener();
  }
}

export function subscribeCoverPhotoUploadInProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
