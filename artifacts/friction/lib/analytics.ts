import { posthog } from "./posthog";

function kstHour(): number {
  return new Date(Date.now() + 9 * 3600000).getUTCHours();
}

function kstDayOfWeek(): number {
  return new Date(Date.now() + 9 * 3600000).getUTCDay();
}

// ── 1. App Open ──────────────────────────────────────────────────────────────
// Tracks when the user opens the app and at which hour (KST).
// Use to measure 06:00 / 18:00 peak access patterns.

export function trackAppOpen(): void {
  posthog?.capture("app_open", {
    hour_kst: kstHour(),
    day_of_week: kstDayOfWeek(),
  });
}

// ── 2. Page Turn ─────────────────────────────────────────────────────────────
// Fired each time the user swipes to a new page.
// dwell_ms = time spent on the page that was just left.
// direction: "forward" | "backward" — backward rate answers "다시 앞으로 스크롤하는 비율"
// dwell_ms too low for the page's char count indicates rushed reading.

export function trackPageTurn(params: {
  articleId: string;
  fromPage: number;
  toPage: number;
  direction: "forward" | "backward";
  dwellMs: number;
  totalPages: number;
  pageCharCount?: number;
}): void {
  posthog?.capture("page_turn", {
    article_id: params.articleId,
    from_page: params.fromPage,
    to_page: params.toPage,
    direction: params.direction,
    dwell_ms: params.dwellMs,
    total_pages: params.totalPages,
    page_char_count: params.pageCharCount ?? 0,
    hour_kst: kstHour(),
  });
}

// ── 3. Reading Session Start ──────────────────────────────────────────────────
// Fired once when the user's reading state first becomes READING.
// resumed_from_page > 0 means the user is continuing from a saved position.

export function trackReadingStart(params: {
  articleId: string;
  totalPages: number;
  resumedFromPage: number;
}): void {
  posthog?.capture("reading_start", {
    article_id: params.articleId,
    total_pages: params.totalPages,
    resumed_from_page: params.resumedFromPage,
    hour_kst: kstHour(),
    day_of_week: kstDayOfWeek(),
  });
}

// ── 4. Reading Complete ───────────────────────────────────────────────────────
// Fired when the user reaches the last page and the completion sheet opens.
// total_read_ms = wall-clock time from reading_start to completion.

export function trackReadingComplete(params: {
  articleId: string;
  totalPages: number;
  totalReadMs: number;
}): void {
  posthog?.capture("reading_complete", {
    article_id: params.articleId,
    total_pages: params.totalPages,
    total_read_ms: params.totalReadMs,
    hour_kst: kstHour(),
  });
}

// ── 5. Article Action After Completion ───────────────────────────────────────
// Fired when the user taps "보관" (save) or "나가기/보관 안 함" (skip)
// on the completion sheet.
// ms_since_complete = decision latency after the completion sheet appeared.

export function trackArticleAction(params: {
  articleId: string;
  action: "save" | "skip";
  msSinceComplete: number;
}): void {
  posthog?.capture("article_action", {
    article_id: params.articleId,
    action: params.action,
    ms_since_complete: params.msSinceComplete,
    hour_kst: kstHour(),
  });
}

// ── 6. App Backgrounded During Reading ───────────────────────────────────────
// Fired when the OS sends the app to background while a reading session is active.
// progress_pct lets you see how far through the article the user was.

export function trackAppBackgroundedDuringReading(params: {
  articleId: string;
  currentPage: number;
  totalPages: number;
}): void {
  if (!posthog) return;
  const currentPage = Number(params.currentPage);
  const totalPages = Number(params.totalPages);
  const progressPct: number = totalPages > 0
    ? Math.round((currentPage / totalPages) * 100)
    : 0;
  posthog.capture("app_backgrounded_during_reading", {
    article_id: params.articleId,
    current_page: currentPage,
    total_pages: totalPages,
    progress_pct: progressPct,
    hour_kst: kstHour(),
  });
  // Flush immediately — the app is going to background and the OS may suspend
  // the JS thread before the next automatic flush cycle runs.
  posthog.flush().catch(() => {});
}

// ── 7. Sentence Collected ─────────────────────────────────────────────────────
// Fired when the user saves a collected sentence via the [수집] action.

export function trackSentenceCollected(params: {
  articleId: string;
  page: number;
  textLength: number;
}): void {
  posthog?.capture("sentence_collected", {
    article_id: params.articleId,
    page: params.page,
    text_length: params.textLength,
    hour_kst: kstHour(),
  });
}

// ── 8. Memo Created During Reading ───────────────────────────────────────────
// Fired when the user inserts a quoted sentence into the memo via [메모].

export function trackMemoCreatedDuringReading(params: {
  articleId: string;
  page: number;
}): void {
  posthog?.capture("memo_created_during_reading", {
    article_id: params.articleId,
    page: params.page,
    hour_kst: kstHour(),
  });
}

// ── 9. Article Published ─────────────────────────────────────────────────────
// Fired when the user finalises a letter (status → LETTER) on the closing screen.
// char_count = sum of all page lengths.

export function trackArticlePublished(params: {
  articleId: string;
  charCount: number;
  pageCount: number;
}): void {
  posthog?.capture("article_published", {
    article_id: params.articleId,
    char_count: params.charCount,
    page_count: params.pageCount,
    hour_kst: kstHour(),
    day_of_week: kstDayOfWeek(),
  });
}
