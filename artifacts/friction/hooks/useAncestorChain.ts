import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import {
  getArticle,
  getGetArticleQueryKey,
  type Article,
} from "@workspace/api-client-react";

export interface AncestorSlot {
  id: string;
  article: Article | null;
}

/**
 * Shared "letter select mode" ancestor traversal.
 *
 * Given the sourceArticleId of a tapped letter/article, recursively walks up
 * the reply chain (Article.sourceArticleId) until the root. Each discovered
 * slot is exposed immediately with `article: null` (skeleton) and filled in
 * once the fetch resolves — identical behavior across 수신함, 프로필, 공간.
 *
 * Returned slots are ordered oldest → newest (root ancestor first).
 */
export function useAncestorChain(
  startId: string | null | undefined,
  queryClient: QueryClient,
): AncestorSlot[] {
  const [ancestorChain, setAncestorChain] = useState<AncestorSlot[]>([]);

  useEffect(() => {
    if (!startId) {
      setAncestorChain([]);
      return;
    }
    let cancelled = false;
    setAncestorChain([{ id: startId, article: null }]);

    async function traverse(id: string) {
      if (cancelled) return;
      let article: Article | null = null;
      try {
        article = (await queryClient.fetchQuery({
          queryKey: getGetArticleQueryKey(id),
          queryFn: () => getArticle(id),
          staleTime: 5 * 60 * 1000,
        })) as Article;
      } catch {
        return;
      }
      if (cancelled || !article) return;

      setAncestorChain((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { id, article };
        return next;
      });

      const nextId = (article as any).sourceArticleId as string | null | undefined;
      if (nextId && !cancelled) {
        setAncestorChain((prev) => [{ id: nextId, article: null }, ...prev]);
        await traverse(nextId);
      }
    }

    traverse(startId);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startId]);

  return ancestorChain;
}
