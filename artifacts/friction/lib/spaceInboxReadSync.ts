import type { ReadingMode } from "./policies";

export type ReadingEntrySource = "list" | "inbox" | "space";

export function shouldSyncSpaceInboxRead({
  entrySource,
  mode,
  userId,
  articleId,
}: {
  entrySource?: ReadingEntrySource;
  mode: ReadingMode;
  userId: string;
  articleId: string;
}): boolean {
  return (
    entrySource === "space" &&
    mode === "basic" &&
    userId.length > 0 &&
    articleId.length > 0
  );
}