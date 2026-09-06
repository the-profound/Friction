/**
 * Unified view-model for a letter card.
 *
 * Every screen that displays letter cards converts its raw API response into
 * this shape via a screen-specific adapter hook. ArticleCardItem and
 * useLetterSelectionOverlay both accept these fields, so a bug fix or
 * visual change in one place propagates to every screen automatically.
 *
 * Key distinction from the raw API types:
 *   - `spaceName`      – the name of the Space the letter lives in (or null)
 *   - `collectionName` – the name of the personal collection / send-record name
 *
 * These two were previously conflated into a single `collectionName` prop,
 * causing space names to appear as collection labels and vice-versa.
 */

import type { Article, ArticleCover } from "@workspace/api-client-react";

export interface LetterCardViewModel {
  /**
   * Stable id for React key and overlay tracking.
   * Use SpaceLetter.id for space screens (where article may be null)
   * or Article.id for article-based screens.
   */
  id: string;
  /**
   * The underlying article when available.
   * Null for SpaceLetter-only screens (space carousel, inbox before article load)
   * where the article fields are embedded on the SpaceLetter itself.
   */
  article: Article | null;
  /**
   * Resolved card cover. May come from a SpaceLetter's embedded articleCover
   * (before the article is loaded) or from Article.cover.
   * Callers should prefer this field over article?.cover.
   */
  cover?: ArticleCover | null;
  /** Space name when the letter is from / displayed inside a Space. */
  spaceName: string | null;
  /** Personal collection / send-record name (e.g. "봄에게"). */
  collectionName: string | null;
  /** Personal collection id (for overlay info-bar navigation back to collection). */
  collectionId?: string | null;
  /** Space id (for overlay info-bar navigation back to the space). */
  spaceId?: string | null;
  /** Used for the 👥 badge (RECIPIENT_ONLY) on the card cover. */
  visibility?: string | null;
  /** Resolved display name for the author (handles anonymous, display-name overrides). */
  authorName?: string | null;
  /** Author user-id for overlay info-bar navigation. */
  authorId?: string | null;
  /** True when the card should be dimmed (already read). */
  isRead?: boolean | null;
  /** ISO date string shown at the bottom of the card. */
  date?: string | null;
  /** Small badge text (e.g. letter type label). */
  letterTypeBadge?: string | null;
  /** Which screen/context produced this view-model. */
  source: "inbox" | "record" | "my" | "space" | "profile" | "collection" | "recipient-only";
}

/**
 * Convenience: extract cover from a LetterCardViewModel.
 * Prefers the vm.cover field (pre-resolved); falls back to article?.cover.
 */
export function getLetterCardCover(vm: LetterCardViewModel): ArticleCover | null | undefined {
  return vm.cover ?? vm.article?.cover;
}

/**
 * The label shown on the card cover's collection/space line.
 * Prefers spaceName when set; falls back to collectionName.
 */
export function resolveLetterCardLabel(vm: LetterCardViewModel): string | null {
  return vm.spaceName ?? vm.collectionName ?? null;
}
