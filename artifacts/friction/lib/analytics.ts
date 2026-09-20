import { posthog } from "./posthog";
import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  setRequestTelemetryObserver,
  type ApiRequestTelemetry,
} from "@workspace/api-client-react";
import {
  questionOpportunityProperties,
  type QuestionOutcome,
} from "./questionAnswerMetrics";

const capturedOutcomeKeys = new Set<string>();

function appContext() {
  return {
    platform: Platform.OS,
    app_version: Constants.expoConfig?.version ?? null,
    build_number:
      Platform.OS === "android"
        ? Constants.expoConfig?.android?.versionCode != null
          ? String(Constants.expoConfig.android.versionCode)
          : null
        : Constants.expoConfig?.ios?.buildNumber ?? null,
  };
}

function captureOutcomeOnce(
  event: "draft_saved" | "article_published" | "send_completed",
  outcomeKey: string,
  properties: Record<string, string | number | null>,
): void {
  const key = `${event}:${outcomeKey}`;
  if (capturedOutcomeKeys.has(key)) return;
  if (!posthog) return;
  capturedOutcomeKeys.add(key);
  posthog.capture(event, { ...properties, ...appContext() });
}

export function trackWritingStarted(params: {
  writingSessionId: string;
  entityId?: string;
  entityMode: "draft" | "dividing";
}): void {
  posthog?.capture("writing_started", {
    writing_session_id: params.writingSessionId,
    entity_id: params.entityId ?? null,
    entity_mode: params.entityMode,
    ...appContext(),
  });
}

export function trackDraftSaved(params: {
  entityId: string;
  entityMode: "draft" | "dividing";
  revision: string;
}): void {
  captureOutcomeOnce("draft_saved", `${params.entityId}:${params.revision}`, {
    entity_id: params.entityId,
    entity_mode: params.entityMode,
    revision: params.revision,
  });
}

export function trackSendCompleted(params: {
  sendRecordId: string;
  articleId: string;
  targetType: "person" | "reply" | "space" | "group";
}): void {
  captureOutcomeOnce("send_completed", params.sendRecordId, {
    send_record_id: params.sendRecordId,
    article_id: params.articleId,
    target_type: params.targetType,
  });
}

function kstHour(): number {
  return new Date(Date.now() + 9 * 3600000).getUTCHours();
}

function kstDayOfWeek(): number {
  return new Date(Date.now() + 9 * 3600000).getUTCDay();
}

export function createAnalyticsSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function captureApiOperationalEvent(event: ApiRequestTelemetry): void {
  // Dev-only diagnostic log. Helps trace question-queue failures on real
  // devices where debuggers are not attached. No PII — route strips entity
  // IDs and the message carries only timing + outcome classification.
  if (__DEV__ && event.outcome !== "success") {
    const detail = event.statusCode != null ? ` (HTTP ${event.statusCode})` : "";
    console.log(
      `[api] ${event.method} ${event.route}` +
        ` → ${event.failureType ?? event.outcome}${detail}` +
        ` in ${event.durationMs}ms`,
    );
  }
  posthog?.capture("api_request", {
    request_id: event.requestId,
    method: event.method,
    route: event.route,
    outcome: event.outcome,
    duration_ms: event.durationMs,
    status_code: event.statusCode ?? null,
    failure_type: event.failureType ?? null,
    platform: Platform.OS,
    app_version: Constants.expoConfig?.version ?? null,
    build_number:
      Platform.OS === "android"
        ? Constants.expoConfig?.android?.versionCode != null
          ? String(Constants.expoConfig.android.versionCode)
          : null
        : Constants.expoConfig?.ios?.buildNumber ?? null,
    release_track:
      Constants.expoConfig?.extra?.releaseDiagnostics?.track ?? "development",
  });
}

setRequestTelemetryObserver(captureApiOperationalEvent);

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
  sessionId: string;
  articleId: string;
  totalPages: number;
  resumedFromPage: number;
  isReread: boolean;
}): void {
  posthog?.capture("reading_start", {
    $insert_id: `reading-start:${params.sessionId}`,
    ...readingProperties(params),
    total_pages: params.totalPages,
    resumed_from_page: params.resumedFromPage,
    hour_kst: kstHour(),
    day_of_week: kstDayOfWeek(),
  });
}

export function trackReadingResume(params: {
  sessionId: string;
  articleId: string;
  totalPages: number;
  resumedFromPage: number;
  isReread: boolean;
}): void {
  posthog?.capture("reading_resume", {
    $insert_id: `reading-resume:${params.sessionId}`,
    ...readingProperties(params),
    total_pages: params.totalPages,
    resumed_from_page: params.resumedFromPage,
    hour_kst: kstHour(),
  });
}
export function trackReadingComplete(params: {
  sessionId: string;
  articleId: string;
  totalPages: number;
  totalReadMs: number;
  isReread: boolean;
}): void {
  posthog?.capture("reading_complete", {
    $insert_id: `reading-complete:${params.sessionId}`,
    ...readingProperties(params),
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
  sessionId: string;
  articleId: string;
  action: "save" | "skip";
  msSinceComplete: number;
  isReread: boolean;
}): void {
  posthog?.capture("article_action", {
    $insert_id: `article-action:${params.sessionId}`,
    ...readingProperties(params),
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
  sessionId: string;
  thoughtId: string;
  articleId: string;
  page: number;
  memoLength: number;
  isReread: boolean;
}): void {
  posthog?.capture("memo_created_during_reading", {
    $insert_id: `reading-memo:${params.thoughtId}`,
    ...readingProperties(params),
    page: params.page,
    memo_length: params.memoLength,
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
  captureOutcomeOnce("article_published", params.articleId, {
    article_id: params.articleId,
    char_count: params.charCount,
    page_count: params.pageCount,
    hour_kst: kstHour(),
    day_of_week: kstDayOfWeek(),
  });
}

type ReadingQuestionBase = {
  articleId: string;
  sessionId: string;
  questionIndex: number;
  questionCount: number;
};

export function trackInboxLetterImpression(params: {
  viewSessionId: string;
  inboxId: string;
  articleId: string;
  hasReadBefore: boolean;
}): void {
  posthog?.capture("inbox_letter_impression", {
    $insert_id: `inbox-impression:${params.viewSessionId}:${params.inboxId}`,
    inbox_id: params.inboxId,
    article_id: params.articleId,
    has_read_before: params.hasReadBefore,
    hour_kst: kstHour(),
  });
}

function readingProperties(params: {
  sessionId: string;
  articleId: string;
  isReread: boolean;
}) {
  return {
    reading_session_id: params.sessionId,
    article_id: params.articleId,
    is_reread: params.isReread,
  };
}

export function trackInboxLetterOpened(params: {
  sessionId: string;
  inboxId: string;
  articleId: string;
  isReread: boolean;
}): void {
  posthog?.capture("inbox_letter_opened", {
    $insert_id: `letter-open:${params.sessionId}`,
    ...readingProperties(params),
    inbox_id: params.inboxId,
    hour_kst: kstHour(),
  });
}

export function trackReadingQuestionItemExposed(params: ReadingQuestionBase): void {
  posthog?.capture("reading_question_item_exposed", {
    $insert_id: `reading-question-item-exposed:${params.sessionId}:${params.questionIndex}`,
    ...readingQuestionProperties(params, "exposed"),
  });
}

export function trackReadingQuestionAnswerStarted(params: ReadingQuestionBase): void {
  posthog?.capture("reading_question_answer_started", {
    $insert_id: `reading-question-answer-started:${params.sessionId}:${params.questionIndex}`,
    ...readingQuestionProperties(params, "answer_started"),
  });
}

function readingQuestionProperties(
  params: ReadingQuestionBase,
  outcome: QuestionOutcome,
) {
  return {
    article_id: params.articleId,
    reading_question_session_id: params.sessionId,
    question_index: params.questionIndex,
    question_count: params.questionCount,
    event_key: `${params.sessionId}:${params.questionIndex}`,
    ...questionOpportunityProperties({
      surface: "reading_question",
      opportunityKey: `${params.sessionId}:${params.questionIndex}`,
      sessionKey: params.sessionId,
      outcome,
    }),
  };
}

export function trackReadingQuestionSessionExposed(params: {
  articleId: string;
  sessionId: string;
  questionCount: number;
}): void {
  posthog?.capture("reading_question_session_exposed", {
    $insert_id: `reading-question-session-exposed:${params.sessionId}`,
    article_id: params.articleId,
    reading_question_session_id: params.sessionId,
    question_count: params.questionCount,
    event_key: params.sessionId,
    question_surface: "reading_question",
    question_session_id: `reading_question:${params.sessionId}`,
    question_outcome: "exposed",
    question_aggregation_unit: "session",
  });
}

export function trackReadingQuestionSaveFailed(params: ReadingQuestionBase): void {
  posthog?.capture("reading_question_save_failed", {
    $insert_id: `reading-question-save-failed:${params.sessionId}:${params.questionIndex}`,
    ...readingQuestionProperties(params, "save_failed"),
  });
}

export function trackReadingQuestionSaveSucceeded(
  params: ReadingQuestionBase & { answerLength: number; thoughtId: string },
): void {
  posthog?.capture("reading_question_save_succeeded", {
    $insert_id: `reading-question-save-succeeded:${params.thoughtId}`,
    ...readingQuestionProperties(params, "save_succeeded"),
    answer_length: params.answerLength,
  });
}
