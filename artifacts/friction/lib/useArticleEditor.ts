import { useCallback } from "react";
import { useUpdateArticle, useTransitionArticleStatus, useGetArticle } from "@workspace/api-client-react";
import type { TransitionArticleBody } from "@workspace/api-client-react";
import { useAutoSave } from "./useAutoSave";
import type { AutoSaveStatus } from "./useAutoSave";
import { canTransitionForward, canStepBack, getForwardTarget, getBackTarget, getNextActionLabel, getBackActionLabel } from "./articleStatusCycle";
import type { TransitionGuardInput, PageData } from "./articleStatusCycle";
import { splitContentToPages, validateDivision } from "./pageDivision";
import type { ArticleStatus } from "./policies";

export interface UseArticleEditorOptions {
  articleId: string;
}

export interface ArticleEditorState {
  saveStatus: AutoSaveStatus;
  isDirty: boolean;
  markDirty: (title: string, content: string) => void;
  flush: () => Promise<void>;
  retry: () => Promise<void>;
  transitionForward: (input: TransitionGuardInput) => Promise<{ success: boolean; error?: string }>;
  stepBack: () => Promise<{ success: boolean; error?: string }>;
  forwardTarget: ArticleStatus | null;
  backTarget: ArticleStatus | null;
  nextActionLabel: string | null;
  backActionLabel: string | null;
}

export function useArticleEditor({ articleId }: UseArticleEditorOptions): ArticleEditorState {
  const updateArticle = useUpdateArticle();
  const transitionStatus = useTransitionArticleStatus();
  const { data: article } = useGetArticle(articleId);

  const currentStatus = (article?.status ?? "DRAFT") as ArticleStatus;

  const autoSave = useAutoSave({
    debounceMs: 1200,
    maxRetries: 3,
    storageKey: articleId,
    onSave: async (data) => {
      await updateArticle.mutateAsync({ id: articleId, data });
    },
  });

  const transitionForward = useCallback(
    async (input: TransitionGuardInput) => {
      const check = canTransitionForward(currentStatus, input);
      if (!check.allowed) {
        return { success: false, error: check.reason };
      }

      try {
        await autoSave.flush();
        await transitionStatus.mutateAsync({
          id: articleId,
          data: { targetStatus: check.target as TransitionArticleBody["targetStatus"] },
        });
        return { success: true };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "상태 전환에 실패했습니다.";
        return { success: false, error: msg };
      }
    },
    [currentStatus, articleId, autoSave, transitionStatus],
  );

  const stepBack = useCallback(async () => {
    const check = canStepBack(currentStatus);
    if (!check.allowed) {
      return { success: false, error: check.reason };
    }

    try {
      await transitionStatus.mutateAsync({
        id: articleId,
        data: { targetStatus: check.target as TransitionArticleBody["targetStatus"] },
      });
      return { success: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "상태 전환에 실패했습니다.";
      return { success: false, error: msg };
    }
  }, [currentStatus, articleId, transitionStatus]);

  const forwardTarget = getForwardTarget(currentStatus);
  const backTarget = getBackTarget(currentStatus);
  const nextActionLabel = getNextActionLabel(currentStatus);
  const backActionLabel = getBackActionLabel(currentStatus);

  return {
    saveStatus: autoSave.status,
    isDirty: autoSave.isDirty,
    markDirty: autoSave.markDirty,
    flush: autoSave.flush,
    retry: autoSave.retry,
    transitionForward,
    stepBack,
    forwardTarget,
    backTarget,
    nextActionLabel,
    backActionLabel,
  };
}

export function buildGuardInput(
  title: string,
  content: string,
  maxCharPerPage?: number,
): TransitionGuardInput {
  const pages = splitContentToPages(content);
  const validation = validateDivision(pages, maxCharPerPage);

  const pageData: PageData[] = pages.map((p) => ({
    pageIndex: p.pageIndex,
    content: p.content,
    charCount: p.charCount,
  }));

  return {
    content,
    title,
    pages: pageData,
    hasRedWarnings: validation.hasRedWarnings,
  };
}
