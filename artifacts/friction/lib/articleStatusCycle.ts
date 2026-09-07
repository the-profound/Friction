import type { ArticleStatus } from "./policies";

export const STATUS_ORDER: ArticleStatus[] = ["DIVIDING", "CLOSING", "LETTER"];

export const STATUS_INDEX: Record<ArticleStatus, number> = {
  DIVIDING: 0,
  CLOSING: 1,
  LETTER: 2,
};

interface TransitionRule {
  forward: ArticleStatus | null;
  back: ArticleStatus | null;
}

const TRANSITIONS: Record<ArticleStatus, TransitionRule> = {
  DIVIDING: { forward: "CLOSING", back: null },
  CLOSING: { forward: "LETTER", back: "DIVIDING" },
  LETTER: { forward: null, back: null },
};

export interface PageData {
  pageIndex: number;
  content: string;
  charCount: number;
}

export interface TransitionGuardInput {
  content: string;
  title: string;
  pages: PageData[];
  hasRedWarnings: boolean;
}

export type TransitionResult =
  | { allowed: true; target: ArticleStatus }
  | { allowed: false; reason: string };

export function canTransitionForward(
  from: ArticleStatus,
  input: TransitionGuardInput,
): TransitionResult {
  const target = TRANSITIONS[from].forward;
  if (!target) return { allowed: false, reason: "더 이상 다음 단계가 없습니다." };

  switch (from) {
    case "DIVIDING":
      if (!input.title.trim()) {
        return { allowed: false, reason: "제목이 비어있습니다." };
      }
      if (input.pages.length < 1) {
        return { allowed: false, reason: "최소 1개 이상의 페이지가 필요합니다." };
      }
      if (input.pages.some((p) => !p.content.trim())) {
        return { allowed: false, reason: "빈 페이지가 있습니다. 내용을 채우거나 페이지를 삭제해주세요." };
      }
      if (input.hasRedWarnings) {
        return {
          allowed: false,
          reason:
            "마감 단계로 넘어가기 위해서는 글을 가위 모양의 버튼을 눌러 구분선으로 분할해주세요!",
        };
      }
      return { allowed: true, target };

    case "CLOSING":
      return { allowed: true, target };

    default:
      return { allowed: false, reason: "전환할 수 없는 상태입니다." };
  }
}

export function canStepBack(from: ArticleStatus): TransitionResult {
  const target = TRANSITIONS[from].back;
  if (!target) return { allowed: false, reason: "이전 단계로 돌아갈 수 없습니다." };
  return { allowed: true, target };
}

export function transition(
  from: ArticleStatus,
  to: ArticleStatus,
): TransitionResult {
  const rule = TRANSITIONS[from];
  if (rule.forward === to) {
    return { allowed: true, target: to };
  }
  if (rule.back === to) {
    return { allowed: true, target: to };
  }
  return { allowed: false, reason: `${from}에서 ${to}(으)로 전환할 수 없습니다.` };
}

export function getForwardTarget(from: ArticleStatus): ArticleStatus | null {
  return TRANSITIONS[from].forward;
}

export function getBackTarget(from: ArticleStatus): ArticleStatus | null {
  return TRANSITIONS[from].back;
}

export function isEditable(status: ArticleStatus): boolean {
  return status !== "LETTER";
}

export function canModifyPages(status: ArticleStatus): boolean {
  return status === "DIVIDING";
}

export function canModifyStyle(status: ArticleStatus): boolean {
  return status === "CLOSING";
}

export function isLetterImmutable(status: ArticleStatus): boolean {
  return status === "LETTER";
}

export function getStatusLabel(status: ArticleStatus): string {
  const labels: Record<ArticleStatus, string> = {
    DIVIDING: "검토 중",
    CLOSING: "마감 중",
    LETTER: "완성",
  };
  return labels[status];
}

export function getNextActionLabel(status: ArticleStatus): string | null {
  const labels: Record<ArticleStatus, string | null> = {
    DIVIDING: "마감하기",
    CLOSING: "완성하기",
    LETTER: null,
  };
  return labels[status];
}

export function getBackActionLabel(status: ArticleStatus): string | null {
  const labels: Record<ArticleStatus, string | null> = {
    DIVIDING: null,
    CLOSING: "검토로 돌아가기",
    LETTER: null,
  };
  return labels[status];
}

export const canTransition = transition;
export { canStepBack as canGoBack };
