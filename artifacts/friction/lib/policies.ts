export type ArticleStatus = "DIVIDING" | "CLOSING" | "LETTER";
export type ReadingMode = "basic" | "re_read";

const STATUS_ORDER: ArticleStatus[] = ["DIVIDING", "CLOSING", "LETTER"];

export const ArticlePolicy = {
  VALID_TRANSITIONS: {
    DIVIDING: "CLOSING" as const,
    CLOSING: "LETTER" as const,
    LETTER: null,
  },

  canTransition(from: ArticleStatus, to: ArticleStatus): boolean {
    return (this.VALID_TRANSITIONS as Record<ArticleStatus, ArticleStatus | null>)[from] === to;
  },

  canStepBack(from: ArticleStatus): ArticleStatus | null {
    if (from === "CLOSING") return "DIVIDING";
    return null;
  },

  isImmutable(status: ArticleStatus): boolean {
    return status === "LETTER";
  },

  canEdit(status: ArticleStatus): boolean {
    return status !== "LETTER";
  },

  canSend(status: ArticleStatus): boolean {
    return status === "LETTER";
  },

  hasPagesField(status: ArticleStatus): boolean {
    return STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf("DIVIDING");
  },

  statusLabel(status: ArticleStatus): string {
    const labels: Record<ArticleStatus, string> = {
      DIVIDING: "검토 중",
      CLOSING: "마감 중",
      LETTER: "완성",
    };
    return labels[status];
  },
};

export const ReadingPolicy = {
  canExitDuringBasic: false,
  canExitDuringReRead: true,
  blockBackGesture(mode: ReadingMode): boolean {
    return mode === "basic";
  },
  forceReturnToRead(mode: ReadingMode): boolean {
    return mode === "basic";
  },
  canCollectSentences(_mode: ReadingMode): boolean {
    return true;
  },
  canTakeMemos(_mode: ReadingMode): boolean {
    return true;
  },
};

/**
 * An inbox delivery can be unread even when its article was completed before.
 * In that case the delivery opens in reread mode without changing the
 * per-article completion history contract.
 */
export function getInboxReadingMode(
  isRead?: boolean,
  hasReadBefore?: boolean,
): ReadingMode {
  return isRead || hasReadBefore ? "re_read" : "basic";
}

/**
 * Re-reading from the inbox still owns an unread delivery that must be
 * committed when the completion screen is dismissed. Re-reading from a
 * collection or the record tab has no inbox delivery to update.
 */
export function shouldCommitCompletionForEntry(
  mode: ReadingMode,
  inboxId?: string,
): boolean {
  return mode !== "re_read" || Boolean(inboxId);
}

export const DeliveryPolicy = {
  DELIVERY_HOURS_KST: [6] as const,
  TIMEZONE: "Asia/Seoul" as const,
};

export const SpacePolicy = {
  OF_ALLOWS_ONLY_LETTERS: true,
  ON_ALLOWS_ONLY_MEMOS: true,

  canAddToOF(articleStatus: ArticleStatus): boolean {
    return articleStatus === "LETTER";
  },

  canAddToTeamCollection(articleStatus: ArticleStatus, authorId: string, addedById: string): boolean {
    return articleStatus === "LETTER" && authorId === addedById;
  },
};

export const NavigationPolicy = {
  INITIAL_TAB_NEW_USER: "IN" as const,
  INITIAL_TAB_RETURNING: "ON" as const,
  NAVBAR_HIDDEN_SCREENS: ["READ", "ON-01"] as const,
  TAB_ORDER: ["IN", "ON", "OF", "TO"] as const,
};

export const CollectionPolicy = {
  NAME_MIN_LENGTH: 1,
  NAME_MAX_LENGTH: 30,
  MY_COLLECTION_ALLOWS_OTHERS_ARTICLES: true,
  TEAM_COLLECTION_ALLOWS_ONLY_OWN_ARTICLES: true,
};

export const MarkdownPolicy = {
  PAGE_DIVIDER: "---" as const,
  SUPPORTED_FORMATS: ["bold", "italic", "heading", "list", "divider", "quote"] as const,
};
