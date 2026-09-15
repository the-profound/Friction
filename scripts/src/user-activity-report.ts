import pg from "pg";

const { Pool } = pg;

export const DEFAULT_CUTOFF = "2026-09-01T00:00:00+09:00";
export const REPORT_TIME_ZONE = "Asia/Seoul";
export const REPORT_VERSION = "task-2272-v1";

export function normalizeSupabaseDbUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("SUPABASE_DB_URL must not be empty.");
  if (trimmed.startsWith("postgres://") || trimmed.startsWith("postgresql://")) return trimmed;
  return `postgresql://${trimmed}`;
}

export type TestUserPolicy = "exclude" | "separate";

export interface ReportOptions {
  cutoff?: string | Date;
  endAt?: string | Date;
  testUserPolicy?: TestUserPolicy;
}

export interface MetricCounts {
  authored_articles: number;
  completed_letters: number;
  sends: number;
  received_visible: number;
  received_opened: number;
  completed_reads: number;
  normal_thoughts: number;
  stored_sentences: number;
  accepted_neighbor_edges: number;
  approved_space_participations: number;
}

export interface UserMetricRow extends MetricCounts {
  app_user_id: string;
  is_test_dev: boolean;
}

interface CohortRow {
  auth_user_id: string;
  app_user_id: string | null;
  is_test_dev: boolean;
}

interface WeeklyRow {
  week_start: string;
  segment: "production" | "test_dev";
  metric: keyof MetricCounts;
  count: number | string;
}

interface NeighborTotalRow {
  segment: "production" | "test_dev";
  count: number | string;
}

export interface ActivityReport {
  report_version: string;
  generated_at: string;
  cutoff_at: string;
  timezone: string;
  test_user_policy: TestUserPolicy;
  cohort: {
    auth_accounts: number;
    matched_app_users: number;
    unmatched_auth_accounts: number;
    production_accounts: number;
    test_dev_accounts: number;
    excluded_test_dev_accounts: number;
  };
  overall: {
    production: SegmentSummary;
    test_dev?: SegmentSummary;
  };
  per_user: PublicUserSummary[];
  weekly_trend: WeeklyTrendRow[];
  quality: {
    no_activity_users: number;
    no_activity_user_ids: string[];
    unmatched_auth_accounts: number;
    metric_reconciliation: Partial<Record<"production" | "test_dev", MetricReconciliation>>;
    classification_quality: string;
    limitations: string[];
  };
  metric_definitions: Record<keyof MetricCounts, MetricDefinition>;
}

interface SegmentSummary {
  cohort_user_denominator: number;
  active_users: number;
  metrics: MetricCounts;
}

export interface PublicUserSummary {
  anonymous_user_id: string;
  cohort_segment: "production" | "test_dev";
  has_activity: boolean;
  metrics: MetricCounts;
}

export interface WeeklyTrendRow {
  week_start_kst: string;
  cohort_segment: "production" | "test_dev";
  metrics: MetricCounts;
}

export interface MetricDefinition {
  numerator: string;
  denominator: string;
  exclusions: string[];
  limitations: string[];
}

export type MetricReconciliation = Record<
  keyof MetricCounts,
  { overall: number; weekly_sum: number; matches: boolean }
>;

const METRIC_NAMES: readonly (keyof MetricCounts)[] = [
  "authored_articles",
  "completed_letters",
  "sends",
  "received_visible",
  "received_opened",
  "completed_reads",
  "normal_thoughts",
  "stored_sentences",
  "accepted_neighbor_edges",
  "approved_space_participations",
];

const ZERO_METRICS: MetricCounts = {
  authored_articles: 0,
  completed_letters: 0,
  sends: 0,
  received_visible: 0,
  received_opened: 0,
  completed_reads: 0,
  normal_thoughts: 0,
  stored_sentences: 0,
  accepted_neighbor_edges: 0,
  approved_space_participations: 0,
};

const AUTH_AND_APP_SQL = `
WITH auth_cohort AS (
  SELECT
    a.id AS auth_user_id,
    p.id AS app_user_id,
    (
      COALESCE(a.email, '') ~* '(^|[+._-])(test|dev)([+@._-]|$)'
      OR COALESCE(a.email, '') ~* '@(test|dev|staging)([.])'
      OR lower(COALESCE(a.raw_user_meta_data ->> 'environment', '')) IN ('test', 'testing', 'dev', 'development', 'staging')
      OR lower(COALESCE(a.raw_app_meta_data ->> 'environment', '')) IN ('test', 'testing', 'dev', 'development', 'staging')
      OR lower(COALESCE(a.raw_user_meta_data ->> 'is_test', 'false')) = 'true'
      OR lower(COALESCE(a.raw_app_meta_data ->> 'is_test', 'false')) = 'true'
    ) AS is_test_dev
  FROM auth.users AS a
  LEFT JOIN public.users AS p ON p.id = a.id
  WHERE a.last_sign_in_at >= $1::timestamptz
    AND a.last_sign_in_at < $2::timestamptz
)
SELECT auth_user_id, app_user_id, is_test_dev
FROM auth_cohort
ORDER BY auth_user_id
`;

/**
 * Every source is reduced to one row per user before it is joined. This is
 * deliberately kept as plain SQL rather than a wide join so one inbox row
 * cannot multiply a thought, sentence, or article count.
 */
export const USER_METRICS_SQL = `
WITH cohort AS (
  SELECT
    a.id AS auth_user_id,
    p.id AS app_user_id,
    (
      COALESCE(a.email, '') ~* '(^|[+._-])(test|dev)([+@._-]|$)'
      OR COALESCE(a.email, '') ~* '@(test|dev|staging)([.])'
      OR lower(COALESCE(a.raw_user_meta_data ->> 'environment', '')) IN ('test', 'testing', 'dev', 'development', 'staging')
      OR lower(COALESCE(a.raw_app_meta_data ->> 'environment', '')) IN ('test', 'testing', 'dev', 'development', 'staging')
      OR lower(COALESCE(a.raw_user_meta_data ->> 'is_test', 'false')) = 'true'
      OR lower(COALESCE(a.raw_app_meta_data ->> 'is_test', 'false')) = 'true'
    ) AS is_test_dev
  FROM auth.users AS a
  LEFT JOIN public.users AS p ON p.id = a.id
  WHERE a.last_sign_in_at >= $1::timestamptz
    AND a.last_sign_in_at < $2::timestamptz
),
article_counts AS (
  SELECT a.author_id AS user_id,
    count(DISTINCT a.id) FILTER (
      WHERE a.deleted_at IS NULL
        AND a.created_at >= $1::timestamptz AND a.created_at < $2::timestamptz
    )::int AS authored_articles,
    count(DISTINCT a.id) FILTER (
      WHERE a.deleted_at IS NULL AND a.status = 'LETTER'
        AND a.letter_at >= $1::timestamptz AND a.letter_at < $2::timestamptz
    )::int AS completed_letters
  FROM public.articles AS a
  JOIN cohort c ON c.app_user_id = a.author_id
  WHERE (a.created_at >= $1::timestamptz AND a.created_at < $2::timestamptz)
     OR (a.letter_at >= $1::timestamptz AND a.letter_at < $2::timestamptz)
  GROUP BY a.author_id
),
send_counts AS (
  SELECT s.sender_id AS user_id, count(DISTINCT s.id)::int AS sends
  FROM public.send_records AS s
  JOIN cohort c ON c.app_user_id = s.sender_id
  WHERE s.sent_at >= $1::timestamptz AND s.sent_at < $2::timestamptz
  GROUP BY s.sender_id
),
inbox_counts AS (
  SELECT i.recipient_id AS user_id,
    count(DISTINCT i.id) FILTER (
      WHERE i.visible_at >= $1::timestamptz AND i.visible_at < $2::timestamptz
    )::int AS received_visible,
    count(DISTINCT i.id) FILTER (
      WHERE i.opened_at >= $1::timestamptz AND i.opened_at < $2::timestamptz
    )::int AS received_opened
  FROM public.inbox AS i
  JOIN cohort c ON c.app_user_id = i.recipient_id
  WHERE (i.visible_at >= $1::timestamptz AND i.visible_at < $2::timestamptz)
     OR (i.opened_at >= $1::timestamptz AND i.opened_at < $2::timestamptz)
  GROUP BY i.recipient_id
),
read_counts AS (
  SELECT r.user_id, count(DISTINCT r.id)::int AS completed_reads
  FROM public.user_article_reads AS r
  JOIN cohort c ON c.app_user_id = r.user_id
  WHERE r.completed_at >= $1::timestamptz AND r.completed_at < $2::timestamptz
  GROUP BY r.user_id
),
thought_counts AS (
  SELECT t.author_id AS user_id, count(DISTINCT t.id)::int AS normal_thoughts
  FROM public.thoughts AS t
  JOIN cohort c ON c.app_user_id = t.author_id
  WHERE t.created_at >= $1::timestamptz AND t.created_at < $2::timestamptz
    AND t.status = 'NORMAL' AND t.deleted_at IS NULL
  GROUP BY t.author_id
),
sentence_counts AS (
  SELECT s.user_id, count(DISTINCT s.id)::int AS stored_sentences
  FROM public.stored_sentences AS s
  JOIN cohort c ON c.app_user_id = s.user_id
  WHERE s.created_at >= $1::timestamptz AND s.created_at < $2::timestamptz
  GROUP BY s.user_id
),
neighbor_counts AS (
  SELECT x.user_id, count(DISTINCT x.edge_id)::int AS accepted_neighbor_edges
  FROM (
    SELECT n.id AS edge_id, n.user_a_id AS user_id
    FROM public.neighbors n JOIN cohort c ON c.app_user_id = n.user_a_id
    WHERE n.accepted_at >= $1::timestamptz AND n.accepted_at < $2::timestamptz
    UNION ALL
    SELECT n.id AS edge_id, n.user_b_id AS user_id
    FROM public.neighbors n JOIN cohort c ON c.app_user_id = n.user_b_id
    WHERE n.accepted_at >= $1::timestamptz AND n.accepted_at < $2::timestamptz
  ) x
  GROUP BY x.user_id
),
space_counts AS (
  SELECT s.user_id, count(DISTINCT s.id)::int AS approved_space_participations
  FROM public.space_participations AS s
  JOIN cohort c ON c.app_user_id = s.user_id
  WHERE s.created_at >= $1::timestamptz AND s.created_at < $2::timestamptz
    AND s.status = 'APPROVED'
  GROUP BY s.user_id
)
SELECT c.app_user_id, c.is_test_dev,
  COALESCE(a.authored_articles, 0)::int AS authored_articles,
  COALESCE(a.completed_letters, 0)::int AS completed_letters,
  COALESCE(s.sends, 0)::int AS sends,
  COALESCE(i.received_visible, 0)::int AS received_visible,
  COALESCE(i.received_opened, 0)::int AS received_opened,
  COALESCE(r.completed_reads, 0)::int AS completed_reads,
  COALESCE(t.normal_thoughts, 0)::int AS normal_thoughts,
  COALESCE(st.stored_sentences, 0)::int AS stored_sentences,
  COALESCE(n.accepted_neighbor_edges, 0)::int AS accepted_neighbor_edges,
  COALESCE(sp.approved_space_participations, 0)::int AS approved_space_participations
FROM cohort c
LEFT JOIN article_counts a ON a.user_id = c.app_user_id
LEFT JOIN send_counts s ON s.user_id = c.app_user_id
LEFT JOIN inbox_counts i ON i.user_id = c.app_user_id
LEFT JOIN read_counts r ON r.user_id = c.app_user_id
LEFT JOIN thought_counts t ON t.user_id = c.app_user_id
LEFT JOIN sentence_counts st ON st.user_id = c.app_user_id
LEFT JOIN neighbor_counts n ON n.user_id = c.app_user_id
LEFT JOIN space_counts sp ON sp.user_id = c.app_user_id
WHERE c.app_user_id IS NOT NULL
ORDER BY c.app_user_id
`;

const WEEKLY_SQL = `
WITH cohort AS (
  SELECT a.id AS user_id,
    CASE WHEN (
      COALESCE(a.email, '') ~* '(^|[+._-])(test|dev)([+@._-]|$)'
      OR COALESCE(a.email, '') ~* '@(test|dev|staging)([.])'
      OR lower(COALESCE(a.raw_user_meta_data ->> 'environment', '')) IN ('test', 'testing', 'dev', 'development', 'staging')
      OR lower(COALESCE(a.raw_app_meta_data ->> 'environment', '')) IN ('test', 'testing', 'dev', 'development', 'staging')
      OR lower(COALESCE(a.raw_user_meta_data ->> 'is_test', 'false')) = 'true'
      OR lower(COALESCE(a.raw_app_meta_data ->> 'is_test', 'false')) = 'true'
    ) THEN 'test_dev' ELSE 'production' END AS segment
  FROM auth.users a JOIN public.users p ON p.id = a.id
  WHERE a.last_sign_in_at >= $1::timestamptz AND a.last_sign_in_at < $2::timestamptz
),
events AS (
  SELECT c.segment, date_trunc('week', a.created_at AT TIME ZONE 'Asia/Seoul')::date AS week_start,
    'authored_articles'::text AS metric, a.id AS event_id
  FROM public.articles a JOIN cohort c ON c.user_id = a.author_id
  WHERE a.created_at >= $1::timestamptz AND a.created_at < $2::timestamptz AND a.deleted_at IS NULL
  UNION ALL
  SELECT c.segment, date_trunc('week', a.letter_at AT TIME ZONE 'Asia/Seoul')::date, 'completed_letters', a.id
  FROM public.articles a JOIN cohort c ON c.user_id = a.author_id
  WHERE a.letter_at >= $1::timestamptz AND a.letter_at < $2::timestamptz
    AND a.deleted_at IS NULL AND a.status = 'LETTER'
  UNION ALL
  SELECT c.segment, date_trunc('week', s.sent_at AT TIME ZONE 'Asia/Seoul')::date, 'sends', s.id
  FROM public.send_records s JOIN cohort c ON c.user_id = s.sender_id
  WHERE s.sent_at >= $1::timestamptz AND s.sent_at < $2::timestamptz
  UNION ALL
  SELECT c.segment, date_trunc('week', i.visible_at AT TIME ZONE 'Asia/Seoul')::date, 'received_visible', i.id
  FROM public.inbox i JOIN cohort c ON c.user_id = i.recipient_id
  WHERE i.visible_at >= $1::timestamptz AND i.visible_at < $2::timestamptz
  UNION ALL
  SELECT c.segment, date_trunc('week', i.opened_at AT TIME ZONE 'Asia/Seoul')::date, 'received_opened', i.id
  FROM public.inbox i JOIN cohort c ON c.user_id = i.recipient_id
  WHERE i.opened_at >= $1::timestamptz AND i.opened_at < $2::timestamptz
  UNION ALL
  SELECT c.segment, date_trunc('week', r.completed_at AT TIME ZONE 'Asia/Seoul')::date, 'completed_reads', r.id
  FROM public.user_article_reads r JOIN cohort c ON c.user_id = r.user_id
  WHERE r.completed_at >= $1::timestamptz AND r.completed_at < $2::timestamptz
  UNION ALL
  SELECT c.segment, date_trunc('week', t.created_at AT TIME ZONE 'Asia/Seoul')::date, 'normal_thoughts', t.id
  FROM public.thoughts t JOIN cohort c ON c.user_id = t.author_id
  WHERE t.created_at >= $1::timestamptz AND t.created_at < $2::timestamptz
    AND t.status = 'NORMAL' AND t.deleted_at IS NULL
  UNION ALL
  SELECT c.segment, date_trunc('week', s.created_at AT TIME ZONE 'Asia/Seoul')::date, 'stored_sentences', s.id
  FROM public.stored_sentences s JOIN cohort c ON c.user_id = s.user_id
  WHERE s.created_at >= $1::timestamptz AND s.created_at < $2::timestamptz
  UNION ALL
  SELECT c.segment, date_trunc('week', n.accepted_at AT TIME ZONE 'Asia/Seoul')::date, 'accepted_neighbor_edges', n.id
  FROM public.neighbors n JOIN cohort c ON c.user_id = n.user_a_id
  WHERE n.accepted_at >= $1::timestamptz AND n.accepted_at < $2::timestamptz
  UNION ALL
  SELECT c.segment, date_trunc('week', n.accepted_at AT TIME ZONE 'Asia/Seoul')::date, 'accepted_neighbor_edges', n.id
  FROM public.neighbors n JOIN cohort c ON c.user_id = n.user_b_id
  WHERE n.accepted_at >= $1::timestamptz AND n.accepted_at < $2::timestamptz
  UNION ALL
  SELECT c.segment, date_trunc('week', s.created_at AT TIME ZONE 'Asia/Seoul')::date, 'approved_space_participations', s.id
  FROM public.space_participations s JOIN cohort c ON c.user_id = s.user_id
  WHERE s.created_at >= $1::timestamptz AND s.created_at < $2::timestamptz AND s.status = 'APPROVED'
)
SELECT week_start::text, segment, metric, count(DISTINCT event_id)::int AS count
FROM events
GROUP BY week_start, segment, metric
ORDER BY week_start, segment, metric
`;

const NEIGHBOR_TOTALS_SQL = `
WITH cohort AS (
  SELECT a.id AS user_id,
    CASE WHEN (
      COALESCE(a.email, '') ~* '(^|[+._-])(test|dev)([+@._-]|$)'
      OR COALESCE(a.email, '') ~* '@(test|dev|staging)([.])'
      OR lower(COALESCE(a.raw_user_meta_data ->> 'environment', '')) IN ('test', 'testing', 'dev', 'development', 'staging')
      OR lower(COALESCE(a.raw_app_meta_data ->> 'environment', '')) IN ('test', 'testing', 'dev', 'development', 'staging')
      OR lower(COALESCE(a.raw_user_meta_data ->> 'is_test', 'false')) = 'true'
      OR lower(COALESCE(a.raw_app_meta_data ->> 'is_test', 'false')) = 'true'
    ) THEN 'test_dev' ELSE 'production' END AS segment
  FROM auth.users a JOIN public.users p ON p.id = a.id
  WHERE a.last_sign_in_at >= $1::timestamptz AND a.last_sign_in_at < $2::timestamptz
), edges AS (
  SELECT DISTINCT n.id, c.segment
  FROM public.neighbors n
  JOIN cohort c ON c.user_id = n.user_a_id
  WHERE n.accepted_at >= $1::timestamptz AND n.accepted_at < $2::timestamptz
  UNION
  SELECT DISTINCT n.id, c.segment
  FROM public.neighbors n
  JOIN cohort c ON c.user_id = n.user_b_id
  WHERE n.accepted_at >= $1::timestamptz AND n.accepted_at < $2::timestamptz
)
SELECT segment, count(DISTINCT id)::int AS count FROM edges GROUP BY segment ORDER BY segment
`;

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

const NO_WRITE_WORDS = /\b(insert|update|delete|upsert|merge|create|alter|drop|truncate|grant|revoke|comment|copy|call|do|set|reset|vacuum|refresh|lock|listen|notify|begin|commit|rollback)\b/i;

function stripSqlLiteralsAndComments(sql: string): string {
  return sql
    .replace(/--[^\n\r]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

/** Reject anything that is not one parameterized SELECT statement. */
export function assertReadOnlySql(sql: string): void {
  if (!sql.trim() || sql.includes("\0")) throw new Error("Report SQL guard rejected empty or invalid SQL.");
  const scrubbed = stripSqlLiteralsAndComments(sql);
  let quote: "'" | '"' | null = null;
  let statements = 0;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if ((char === "'" || char === '"') && sql[i - 1] !== "\\") quote = quote === char ? null : quote ?? char;
    if (char === ";" && !quote && sql.slice(i + 1).trim()) statements += 1;
  }
  if (statements > 0 || !/^\s*(select|with)\b/i.test(scrubbed)) {
    throw new Error("Report SQL guard rejected non-read-only SQL.");
  }
  if (NO_WRITE_WORDS.test(scrubbed) || /\bfor\s+(update|share|no\s+key\s+update)\b/i.test(scrubbed)) {
    throw new Error("Report SQL guard rejected a mutating or locking SQL clause.");
  }
}

function toDate(value: string | Date, name: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a valid timestamp.`);
  return date;
}

export function isWithinReportWindow(value: string | Date, cutoff: Date, endAt: Date): boolean {
  const date = toDate(value, "event timestamp");
  return date >= cutoff && date < endAt;
}

/** Monday week start in KST, returned without exposing a source identifier. */
export function kstWeekStart(value: string | Date): string {
  const date = toDate(value, "week timestamp");
  const kstMillis = date.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMillis);
  const day = kst.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  kst.setUTCDate(kst.getUTCDate() - daysSinceMonday);
  return kst.toISOString().slice(0, 10);
}

function numberValue(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function metricCountsFromRow(row: Partial<Record<keyof MetricCounts, unknown>>): MetricCounts {
  const result = { ...ZERO_METRICS };
  for (const metric of METRIC_NAMES) result[metric] = numberValue(row[metric]);
  return result;
}

function addMetricCounts(target: MetricCounts, source: MetricCounts): void {
  for (const metric of METRIC_NAMES) target[metric] += source[metric];
}

function hasActivity(metrics: MetricCounts): boolean {
  return METRIC_NAMES.some((metric) => metrics[metric] > 0);
}

function definition(
  numerator: string,
  denominator: string,
  exclusions: string[],
  limitations: string[],
): MetricDefinition {
  return { numerator, denominator, exclusions, limitations };
}

const METRIC_DEFINITIONS: Record<keyof MetricCounts, MetricDefinition> = {
  authored_articles: definition("Distinct nondeleted article rows created in the window.", "Matched cohort app users.", ["Deleted rows."], ["Creation time is used; edits are not activity."]),
  completed_letters: definition("Distinct articles with status LETTER and a non-null completion timestamp.", "Matched cohort app users.", ["Deleted rows", "Rows without both completion status and timestamp."], ["The latest status is used, so historical transitions are unavailable."]),
  sends: definition("Distinct send_records rows sent in the window.", "Matched cohort app users as senders.", ["Rows outside the sent timestamp window."], ["A send row is a delivery record, not a unique recipient or delivery success."]),
  received_visible: definition("Distinct inbox rows becoming visible in the window.", "Matched cohort app users as recipients.", ["Rows outside the visibility window."], ["Visibility is an inbox state event, not a guaranteed notification delivery."]),
  received_opened: definition("Distinct inbox rows opened in the window.", "Matched cohort app users as recipients.", ["Rows outside the opened timestamp window."], ["An open event is represented by the stored opened timestamp."]),
  completed_reads: definition("Distinct user-article read rows completed in the window.", "Matched cohort app users.", ["Rows outside completed timestamp window."], ["This records completed articles, not reading sessions or duration."]),
  normal_thoughts: definition("Distinct NORMAL, nondeleted thought rows created in the window.", "Matched cohort app users as authors.", ["PRELIMINARY and deleted rows."], ["A row is counted once regardless of related source rows."]),
  stored_sentences: definition("Distinct stored sentence rows created in the window.", "Matched cohort app users.", ["No authored payload is read or emitted."], ["The schema does not distinguish later edits or removal history."]),
  accepted_neighbor_edges: definition("Distinct accepted neighbor edges involving a cohort user.", "Matched cohort users; a cross-segment edge may count in each segment.", ["Edges outside accepted timestamp window."], ["Edge acceptance history is not retained beyond accepted_at."]),
  approved_space_participations: definition("Distinct approved participation rows created in the window.", "Matched cohort app users.", ["Non-approved rows."], ["There is no approval timestamp, so participation creation is the time basis."]),
};

function normalizePolicy(policy: TestUserPolicy | undefined): TestUserPolicy {
  if (policy === undefined) return "exclude";
  if (!["exclude", "separate"].includes(policy)) throw new Error("testUserPolicy must be exclude or separate.");
  return policy;
}

function segmentFor(isTestDev: boolean): "production" | "test_dev" {
  return isTestDev ? "test_dev" : "production";
}

function emptySummary(rows: UserMetricRow[]): SegmentSummary {
  const metrics = { ...ZERO_METRICS };
  for (const row of rows) addMetricCounts(metrics, metricCountsFromRow(row));
  return {
    cohort_user_denominator: rows.length,
    active_users: rows.filter((row) => hasActivity(metricCountsFromRow(row))).length,
    metrics,
  };
}

export function buildReport(
  cohortRows: CohortRow[],
  userRows: UserMetricRow[],
  weeklyRows: WeeklyRow[],
  neighborTotals: NeighborTotalRow[],
  options: Required<Pick<ReportOptions, "cutoff" | "endAt" | "testUserPolicy">>,
): ActivityReport {
  const policy = normalizePolicy(options.testUserPolicy);
  const cutoff = toDate(options.cutoff, "cutoff");
  const endAt = toDate(options.endAt, "endAt");
  if (endAt <= cutoff) throw new Error("endAt must be after cutoff.");
  const matched = new Set(cohortRows.filter((row) => row.app_user_id).map((row) => row.auth_user_id));
  const included = userRows.filter((row) => policy !== "exclude" || !row.is_test_dev);
  const visibleRows = included.filter((row) => policy !== "exclude" || !row.is_test_dev);
  const publicUsers = [...visibleRows]
    .sort((a, b) => a.app_user_id.localeCompare(b.app_user_id))
    .map((row, index) => {
      const metrics = metricCountsFromRow(row);
      return {
        anonymous_user_id: `anonymous_user_${String(index + 1).padStart(4, "0")}`,
        cohort_segment: segmentFor(row.is_test_dev),
        has_activity: hasActivity(metrics),
        metrics,
      };
    });
  const productionRows = included.filter((row) => !row.is_test_dev);
  const testRows = included.filter((row) => row.is_test_dev);
  const totalsBySegment = new Map(neighborTotals.map((row) => [row.segment, numberValue(row.count)]));
  const production = emptySummary(productionRows);
  production.metrics.accepted_neighbor_edges = totalsBySegment.get("production") ?? 0;
  const overall: ActivityReport["overall"] = { production };
  if (policy !== "exclude") {
    const testSummary = emptySummary(testRows);
    testSummary.metrics.accepted_neighbor_edges = totalsBySegment.get("test_dev") ?? 0;
    overall.test_dev = testSummary;
  }
  const trendMap = new Map<string, WeeklyTrendRow>();
  for (const row of weeklyRows) {
    if (policy === "exclude" && row.segment === "test_dev") continue;
    const key = `${row.week_start}:${row.segment}`;
    const current = trendMap.get(key) ?? {
      week_start_kst: row.week_start,
      cohort_segment: row.segment,
      metrics: { ...ZERO_METRICS },
    };
    if (row.metric in current.metrics) current.metrics[row.metric] = numberValue(row.count);
    trendMap.set(key, current);
  }
  const noActivity = publicUsers.filter((user) => !user.has_activity).map((user) => user.anonymous_user_id);
  const testCohort = cohortRows.filter((row) => row.is_test_dev);
  const metricReconciliation = (segment: "production" | "test_dev", summary: SegmentSummary): MetricReconciliation => {
    const weeklyMetrics = { ...ZERO_METRICS };
    for (const row of trendMap.values()) {
      if (row.cohort_segment === segment) addMetricCounts(weeklyMetrics, row.metrics);
    }
    return Object.fromEntries(METRIC_NAMES.map((metric) => [
      metric,
      {
        overall: summary.metrics[metric],
        weekly_sum: weeklyMetrics[metric],
        matches: summary.metrics[metric] === weeklyMetrics[metric],
      },
    ])) as MetricReconciliation;
  };
  const reconciliation: Partial<Record<"production" | "test_dev", MetricReconciliation>> = {
    production: metricReconciliation("production", production),
  };
  if (overall.test_dev) reconciliation.test_dev = metricReconciliation("test_dev", overall.test_dev);
  return {
    report_version: REPORT_VERSION,
    generated_at: endAt.toISOString(),
    cutoff_at: cutoff.toISOString(),
    timezone: REPORT_TIME_ZONE,
    test_user_policy: policy,
    cohort: {
      auth_accounts: cohortRows.length,
      matched_app_users: matched.size,
      unmatched_auth_accounts: cohortRows.length - matched.size,
      production_accounts: cohortRows.filter((row) => !row.is_test_dev).length,
      test_dev_accounts: testCohort.length,
      excluded_test_dev_accounts: policy === "exclude" ? testCohort.length : 0,
    },
    overall,
    per_user: publicUsers,
    weekly_trend: [...trendMap.values()].sort((a, b) =>
      a.week_start_kst.localeCompare(b.week_start_kst) || a.cohort_segment.localeCompare(b.cohort_segment),
    ),
    quality: {
      no_activity_users: noActivity.length,
      no_activity_user_ids: noActivity,
      unmatched_auth_accounts: cohortRows.length - matched.size,
      metric_reconciliation: reconciliation,
      classification_quality:
        "Test/development classification is heuristic. It uses account metadata and marker patterns; it can misclassify accounts unless those markers are maintained.",
      limitations: [
        "Auth supplies the last sign-in timestamp only; login count, sessions, and historical sign-ins are unavailable.",
        "Only aggregate counts and report-local ordinal identifiers are emitted; authored payloads and direct account attributes are excluded.",
        "Byte-stable output requires the same source snapshot, cutoff, end timestamp, and test-user policy.",
        "Because last_sign_in_at is mutable, a historical end can exclude an account whose later sign-in moved past that end.",
        "Current deletion and status values can cause historical rerun drift because prior state is not retained.",
      ],
    },
    metric_definitions: METRIC_DEFINITIONS,
  };
}

export async function generateReport(options: ReportOptions = {}): Promise<ActivityReport> {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL must be set; DATABASE_URL is intentionally not used.");
  const cutoff = options.cutoff ?? DEFAULT_CUTOFF;
  const endAt = options.endAt ?? new Date();
  const policy = normalizePolicy(options.testUserPolicy ?? "exclude");
  const cutoffDate = toDate(cutoff, "cutoff");
  const endDate = toDate(endAt, "endAt");
  if (endDate <= cutoffDate) throw new Error("endAt must be after cutoff.");
  const pool = new Pool({
    connectionString: normalizeSupabaseDbUrl(connectionString),
    max: 1,
    application_name: "task-2272-user-activity-report",
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    for (const sql of [AUTH_AND_APP_SQL, USER_METRICS_SQL, WEEKLY_SQL, NEIGHBOR_TOTALS_SQL]) assertReadOnlySql(sql);
    const values = [cutoffDate.toISOString(), endDate.toISOString()];
    const cohortResult = await client.query(AUTH_AND_APP_SQL, values);
    const userResult = await client.query(USER_METRICS_SQL, values);
    const weeklyResult = await client.query(WEEKLY_SQL, values);
    const neighborResult = await client.query(NEIGHBOR_TOTALS_SQL, values);
    await client.query("COMMIT");
    return buildReport(
      cohortResult.rows as unknown as CohortRow[],
      userResult.rows as unknown as UserMetricRow[],
      weeklyResult.rows as unknown as WeeklyRow[],
      neighborResult.rows as unknown as NeighborTotalRow[],
      { cutoff, endAt, testUserPolicy: policy },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function markdownCell(value: string | number | boolean): string {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function metricTable(metrics: MetricCounts): string {
  return [
    "| 지표 | 수 |",
    "| --- | ---: |",
    ...METRIC_NAMES.map((metric) => `| ${metric} | ${markdownCell(metrics[metric])} |`),
  ].join("\n");
}

function segmentSummaryTable(
  overall: ActivityReport["overall"],
): string {
  const segments: Array<["production" | "test_dev", SegmentSummary | undefined]> = [
    ["production", overall.production],
    ["test_dev", overall.test_dev],
  ];
  return [
    "| 구분 | 코호트 사용자 수 | 활동 사용자 수 |",
    "| --- | ---: | ---: |",
    ...segments
      .filter((entry): entry is ["production" | "test_dev", SegmentSummary] => Boolean(entry[1]))
      .map(([segment, summary]) =>
        `| ${segment} | ${summary.cohort_user_denominator} | ${summary.active_users} |`,
      ),
  ].join("\n");
}

export function reportMarkdown(report: ActivityReport): string {
  const lines = [
    "# Friction 로그인 사용자 활동 리포트",
    "",
    `- 리포트 버전: \`${markdownCell(report.report_version)}\``,
    `- 생성 기준 시각: \`${markdownCell(report.generated_at)}\``,
    `- 활동 시작 시각: \`${markdownCell(report.cutoff_at)}\``,
    `- 기준 시간대: \`${markdownCell(report.timezone)}\``,
    `- 테스트/개발 계정 처리: \`${markdownCell(report.test_user_policy)}\``,
    "",
    "## 코호트",
    "",
    "| 항목 | 수 |",
    "| --- | ---: |",
    `| Supabase Auth 계정 | ${report.cohort.auth_accounts} |`,
    `| 앱 사용자 연결 계정 | ${report.cohort.matched_app_users} |`,
    `| 앱 사용자 미연결 Auth 계정 | ${report.cohort.unmatched_auth_accounts} |`,
    `| 일반 계정 | ${report.cohort.production_accounts} |`,
    `| 테스트/개발 계정 | ${report.cohort.test_dev_accounts} |`,
    `| 제외된 테스트/개발 계정 | ${report.cohort.excluded_test_dev_accounts} |`,
    "",
    "## 전체 요약",
    "",
    segmentSummaryTable(report.overall),
    "",
    ...(["production", "test_dev"] as const).flatMap((segment) => {
      const summary = report.overall[segment];
      if (!summary) return [];
      return [
        "",
        `### ${segment}`,
        "",
        metricTable(summary.metrics),
      ];
    }),
    "",
    "## 사용자별 익명 요약",
    "",
    "| 익명 사용자 ID | 구분 | 활동 여부 | 작성 | 완성 편지 | 발송 | 수신 열기 | 읽기 완료 | 단상 | 문장 | 이웃 | 공간 참여 |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.per_user.map((user) =>
      `| ${markdownCell(user.anonymous_user_id)} | ${user.cohort_segment} | ${user.has_activity ? "예" : "아니오"} | ${user.metrics.authored_articles} | ${user.metrics.completed_letters} | ${user.metrics.sends} | ${user.metrics.received_opened} | ${user.metrics.completed_reads} | ${user.metrics.normal_thoughts} | ${user.metrics.stored_sentences} | ${user.metrics.accepted_neighbor_edges} | ${user.metrics.approved_space_participations} |`,
    ),
    "",
    "## 주간 추세 (KST 월요일 시작)",
    "",
    "| 주 시작일 | 구분 | 작성 | 완성 편지 | 발송 | 수신 표시 | 수신 열기 | 읽기 완료 | 단상 | 문장 | 이웃 | 공간 참여 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.weekly_trend.map((week) =>
      `| ${week.week_start_kst} | ${week.cohort_segment} | ${week.metrics.authored_articles} | ${week.metrics.completed_letters} | ${week.metrics.sends} | ${week.metrics.received_visible} | ${week.metrics.received_opened} | ${week.metrics.completed_reads} | ${week.metrics.normal_thoughts} | ${week.metrics.stored_sentences} | ${week.metrics.accepted_neighbor_edges} | ${week.metrics.approved_space_participations} |`,
    ),
    "",
    "## 데이터 품질",
    "",
    `- 활동이 관측되지 않은 사용자 수: ${report.quality.no_activity_users}`,
    `- 활동이 관측되지 않은 익명 사용자: ${report.quality.no_activity_user_ids.length > 0 ? report.quality.no_activity_user_ids.map((id) => `\`${id}\``).join(", ") : "없음"}`,
    `- 앱 사용자 미연결 Auth 계정: ${report.quality.unmatched_auth_accounts}`,
    `- 테스트/개발 계정 판별: ${markdownCell(report.quality.classification_quality)}`,
    "",
    "### 전체 합계와 주간 합계 대조",
    "",
    "| 구분 | 지표 | 전체 | 주간 합계 | 일치 |",
    "| --- | --- | ---: | ---: | --- |",
    ...(["production", "test_dev"] as const).flatMap((segment) => {
      const reconciliation = report.quality.metric_reconciliation[segment];
      if (!reconciliation) return [];
      return METRIC_NAMES.map((metric) => {
        const row = reconciliation[metric];
        return `| ${segment} | ${metric} | ${row.overall} | ${row.weekly_sum} | ${row.matches ? "예" : "아니오"} |`;
      });
    }),
    "",
    "### 제한 사항",
    "",
    ...report.quality.limitations.map((limitation) => `- ${markdownCell(limitation)}`),
    "",
    "## 지표 정의",
    "",
    "| 지표 | 분자 | 분모 | 제외 조건 | 제한 사항 |",
    "| --- | --- | --- | --- | --- |",
    ...METRIC_NAMES.map((metric) => {
      const definition = report.metric_definitions[metric];
      return `| ${metric} | ${markdownCell(definition.numerator)} | ${markdownCell(definition.denominator)} | ${markdownCell(definition.exclusions.join("; "))} | ${markdownCell(definition.limitations.join("; "))} |`;
    }),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

const isMain = process.argv[1]?.endsWith("user-activity-report.ts");
if (isMain) {
  generateReport({
    testUserPolicy: (process.env.REPORT_TEST_USERS as TestUserPolicy | undefined) ?? "exclude",
    cutoff: process.env.REPORT_CUTOFF ?? DEFAULT_CUTOFF,
    endAt: process.env.REPORT_END_AT,
  })
    .then((report) => process.stdout.write(reportMarkdown(report)))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown report failure.";
      process.stderr.write(`User activity report failed: ${message}\n`);
      process.exitCode = 1;
    });
}