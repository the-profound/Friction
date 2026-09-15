import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  DEFAULT_CUTOFF,
  assertReadOnlySql,
  buildReport,
  isWithinReportWindow,
  kstWeekStart,
  normalizeSupabaseDbUrl,
  reportMarkdown,
  USER_METRICS_SQL,
  type MetricCounts,
} from "./user-activity-report.js";

const zero: MetricCounts = {
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

function metrics(changes: Partial<MetricCounts>): MetricCounts {
  return { ...zero, ...changes };
}

test("uses the 2026 cutoff and treats the boundary as inclusive", () => {
  assert.equal(DEFAULT_CUTOFF, "2026-09-01T00:00:00+09:00");
  const cutoff = new Date(DEFAULT_CUTOFF);
  const end = new Date("2026-09-02T00:00:00+09:00");
  assert.equal(isWithinReportWindow(DEFAULT_CUTOFF, cutoff, end), true);
  assert.equal(isWithinReportWindow("2026-08-31T23:59:59+09:00", cutoff, end), false);
  assert.equal(isWithinReportWindow("2026-09-02T00:00:00+09:00", cutoff, end), false);
});

test("normalizes Supabase connection strings without logging or changing protocols", () => {
  assert.equal(normalizeSupabaseDbUrl("db.example.test:5432/postgres"), "postgresql://db.example.test:5432/postgres");
  assert.equal(normalizeSupabaseDbUrl("postgres://db.example.test/postgres"), "postgres://db.example.test/postgres");
  assert.equal(normalizeSupabaseDbUrl("postgresql://db.example.test/postgres"), "postgresql://db.example.test/postgres");
  assert.throws(() => normalizeSupabaseDbUrl("   "), /must not be empty/);
});

test("calculates Monday week starts in KST around UTC midnight", () => {
  assert.equal(kstWeekStart("2026-09-06T14:59:59Z"), "2026-08-31");
  assert.equal(kstWeekStart("2026-09-06T15:00:00Z"), "2026-09-07");
  assert.equal(kstWeekStart("2026-09-07T00:00:00+09:00"), "2026-09-07");
});

test("aggregated source rows do not multiply counts when combined", () => {
  const report = buildReport(
    [{ auth_user_id: "auth-a", app_user_id: "app-a", is_test_dev: false }],
    [{
      app_user_id: "app-a",
      is_test_dev: false,
      ...metrics({ authored_articles: 2, sends: 3, stored_sentences: 4 }),
    }],
    [],
    [{ segment: "production", count: 1 }],
    { cutoff: DEFAULT_CUTOFF, endAt: "2026-09-30T00:00:00+09:00", testUserPolicy: "exclude" },
  );
  assert.deepEqual(report.overall.production.metrics, metrics({
    authored_articles: 2,
    sends: 3,
    stored_sentences: 4,
    accepted_neighbor_edges: 1,
  }));
});

test("article SQL scopes each metric to its own event timestamp", () => {
  assert.match(
    USER_METRICS_SQL,
    /count\(DISTINCT a\.id\) FILTER \(\s*WHERE a\.deleted_at IS NULL\s+AND a\.created_at >= \$1::timestamptz AND a\.created_at < \$2::timestamptz\s*\)/,
  );
  assert.match(
    USER_METRICS_SQL,
    /count\(DISTINCT a\.id\) FILTER \(\s*WHERE a\.deleted_at IS NULL AND a\.status = 'LETTER'\s+AND a\.letter_at >= \$1::timestamptz AND a\.letter_at < \$2::timestamptz\s*\)/,
  );
});

test("redacts direct account identifiers and authored data from public output", () => {
  const report = buildReport(
    [{ auth_user_id: "auth-a", app_user_id: "app-a", is_test_dev: false }],
    [{
      app_user_id: "app-a",
      is_test_dev: false,
      ...metrics({ normal_thoughts: 1 }),
    }],
    [],
    [],
    { cutoff: DEFAULT_CUTOFF, endAt: "2026-09-30T00:00:00+09:00", testUserPolicy: "exclude" },
  );
  const output = JSON.stringify(report).toLowerCase();
  for (const forbidden of ["email", "nickname", "uuid", "content", "source_text", "title", "auth-a", "app-a"]) {
    assert.equal(output.includes(forbidden), false, `output contained ${forbidden}`);
  }
  assert.equal(report.per_user[0].anonymous_user_id, "anonymous_user_0001");
});

test("excludes test/dev rows by default and can separate them deterministically", () => {
  const cohort = [
    { auth_user_id: "auth-prod", app_user_id: "app-prod", is_test_dev: false },
    { auth_user_id: "auth-test", app_user_id: "app-test", is_test_dev: true },
  ];
  const users = [
    { app_user_id: "app-prod", is_test_dev: false, ...metrics({ sends: 2 }) },
    { app_user_id: "app-test", is_test_dev: true, ...metrics({ sends: 9 }) },
  ];
  const totals = [
    { segment: "production" as const, count: 1 },
    { segment: "test_dev" as const, count: 1 },
  ];
  const excluded = buildReport(cohort, users, [], totals, {
    cutoff: DEFAULT_CUTOFF, endAt: "2026-09-30T00:00:00+09:00", testUserPolicy: "exclude",
  });
  assert.equal(excluded.per_user.length, 1);
  assert.equal(excluded.overall.test_dev, undefined);
  const separated = buildReport(cohort, users, [], totals, {
    cutoff: DEFAULT_CUTOFF, endAt: "2026-09-30T00:00:00+09:00", testUserPolicy: "separate",
  });
  assert.equal(separated.per_user.length, 2);
  assert.equal(separated.overall.test_dev?.metrics.sends, 9);
});

test("same source snapshot, cutoff, end, and policy produce byte-for-byte stable output", () => {
  const cohort = [
    { auth_user_id: "auth-a", app_user_id: "app-a", is_test_dev: false },
  ];
  const users = [
    { app_user_id: "app-a", is_test_dev: false, ...metrics({ completed_reads: 1 }) },
  ];
  const weekly = [
    { week_start: "2026-09-07", segment: "production" as const, metric: "completed_reads" as const, count: 1 },
  ];
  const neighbors: { segment: "production" | "test_dev"; count: number }[] = [];
  assert.equal(
    JSON.stringify(buildReport(cohort, users, weekly, neighbors, {
      cutoff: DEFAULT_CUTOFF, endAt: "2026-09-30T00:00:00+09:00", testUserPolicy: "exclude",
    })),
    JSON.stringify(buildReport(cohort, users, weekly, neighbors, {
      cutoff: DEFAULT_CUTOFF, endAt: "2026-09-30T00:00:00+09:00", testUserPolicy: "exclude",
    })),
  );
});

test("rejects the removed include policy and reports classification quality", () => {
  assert.throws(
    () => buildReport([], [], [], [], {
      cutoff: DEFAULT_CUTOFF,
      endAt: "2026-09-30T00:00:00+09:00",
      testUserPolicy: "include" as never,
    }),
    /exclude or separate/,
  );
  const report = buildReport(
    [{ auth_user_id: "auth-a", app_user_id: "app-a", is_test_dev: false }],
    [{ app_user_id: "app-a", is_test_dev: false, ...zero }],
    [],
    [],
    { cutoff: DEFAULT_CUTOFF, endAt: "2026-09-30T00:00:00+09:00", testUserPolicy: "exclude" },
  );
  assert.match(report.quality.classification_quality, /heuristic/i);
  assert.match(report.quality.limitations.join(" "), /historical end/i);
});

test("reconciles visible overall metrics to weekly sums, including neighbor totals", () => {
  const report = buildReport(
    [{ auth_user_id: "auth-a", app_user_id: "app-a", is_test_dev: false }],
    [{
      app_user_id: "app-a",
      is_test_dev: false,
      ...metrics({ sends: 2, accepted_neighbor_edges: 9 }),
    }],
    [
      { week_start: "2026-09-07", segment: "production", metric: "sends", count: 2 },
      { week_start: "2026-09-07", segment: "production", metric: "accepted_neighbor_edges", count: 1 },
    ],
    [{ segment: "production", count: 1 }],
    { cutoff: DEFAULT_CUTOFF, endAt: "2026-09-30T00:00:00+09:00", testUserPolicy: "exclude" },
  );
  assert.equal(report.quality.metric_reconciliation.production?.sends.matches, true);
  assert.equal(report.quality.metric_reconciliation.production?.accepted_neighbor_edges.matches, true);
  assert.equal(report.quality.metric_reconciliation.test_dev, undefined);
});

test("read-only SQL guard rejects writes, locks, and multiple statements", () => {
  assert.doesNotThrow(() => assertReadOnlySql("WITH rows AS (SELECT 1) SELECT * FROM rows"));
  assert.throws(() => assertReadOnlySql("UPDATE public.users SET nickname = 'x'"));
  assert.throws(() => assertReadOnlySql("SELECT 1; DELETE FROM public.users"));
  assert.throws(() => assertReadOnlySql("SELECT 1 FOR UPDATE"));
});

test(
  "documented silent pnpm command emits a Markdown report only",
  { skip: !process.env.SUPABASE_DB_URL, timeout: 120_000 },
  () => {
    const stdout = execFileSync(
      "pnpm",
      ["--silent", "--filter", "@workspace/scripts", "run", "user-activity-report"],
      {
        cwd: new URL("../..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          REPORT_END_AT: "2026-09-15T23:59:59+09:00",
          REPORT_TEST_USERS: "separate",
        },
      },
    );

    assert.match(stdout, /^# Friction 로그인 사용자 활동 리포트/m);
    assert.match(stdout, /## 코호트/);
    assert.match(stdout, /## 지표 정의/);
    assert.equal(stdout.includes("{"), false);
    assert.equal(stdout.endsWith("\n"), true);
  },
);

test("renders a Markdown report without direct identifiers or authored content", () => {
  const report = buildReport(
    [{ auth_user_id: "auth-a", app_user_id: "app-a", is_test_dev: false }],
    [{ app_user_id: "app-a", is_test_dev: false, ...metrics({ sends: 2 }) }],
    [],
    [],
    { cutoff: DEFAULT_CUTOFF, endAt: "2026-09-30T00:00:00+09:00", testUserPolicy: "exclude" },
  );
  const markdown = reportMarkdown(report);
  assert.match(markdown, /^# Friction 로그인 사용자 활동 리포트/m);
  assert.match(markdown, /\| sends \| 2 \|/);
  for (const forbidden of ["email", "nickname", "content", "source_text", "auth-a", "app-a"]) {
    assert.equal(markdown.toLowerCase().includes(forbidden), false, `output contained ${forbidden}`);
  }
});