import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// on-01a.tsx is a large screen component with no existing component-render
// test harness in this codebase; every other on-01a regression test in this
// directory (on01aAutosave, nonBlockingRecordTransitions, photoNativeRemoval)
// locks in behavior by asserting on the source text itself. This file follows
// the same convention to cover Task 1908's six required scenarios:
//   1. normal open
//   2. transient failure, then retry succeeds
//   3. no such record (404 with a structured body)
//   4. server doesn't provide this lookup yet (404 with no structured body)
//   5. entering while auth restoration is still in progress
//   6. entering directly into an unactivated question-queue item
const appRoot = join(__dirname, "../..");
const readScreen = () => readFileSync(join(appRoot, "app/on-01a.tsx"), "utf8");

describe("on-01a auth-gated, retrying detail queries", () => {
  it("gates both detail queries on auth restoration finishing (scenario: delayed-auth entry)", () => {
    const screen = readScreen();
    // Auth loading must come from AuthContext, not be invented locally.
    expect(screen).toContain('const { isLoading: authIsLoading } = useAuth();');
    expect(screen).toContain(
      'enabled: !!id && !isLocalDirectDraft && modeParam !== "dividing" && !authIsLoading,',
    );
    expect(screen).toContain(
      "enabled: !!id && !isLocalDirectDraft && !authIsLoading,",
    );
  });

  it("uses the bounded retry policy instead of retry:false (scenario: transient failure then retry succeeds)", () => {
    const screen = readScreen();
    // Both detail queries must share the same shared retry policy so a
    // network blip or 5xx auto-recovers instead of hard-failing on the
    // first attempt.
    const thoughtQueryBlock = screen.slice(
      screen.indexOf("const thoughtQuery = useGetThought"),
      screen.indexOf("const articleQuery = useGetArticle"),
    );
    const articleQueryBlock = screen.slice(
      screen.indexOf("const articleQuery = useGetArticle"),
      screen.indexOf("// Determine active entity."),
    );
    for (const block of [thoughtQueryBlock, articleQueryBlock]) {
      expect(block).toContain("retry: shouldRetryDetailQuery");
      expect(block).toContain("retryDelay: detailQueryRetryDelayMs");
      expect(block).not.toContain("retry: false");
    }
    expect(screen).toContain(
      'import {\n  resolveDetailEntity,\n  shouldRetryDetailQuery,\n  detailQueryRetryDelayMs,\n  isRetryableDetailError,\n  isConfirmedGoneError,\n  type DetailErrorReason,\n} from "@/lib/detailEntityResolution";',
    );
  });

  it("derives the failure screen from detailResolution's reason/retryEntity, not a separate ad-hoc check (scenario: normal open stays unaffected)", () => {
    const screen = readScreen();
    // The old ad-hoc `hasLoadError` computed from raw query state (and its
    // hardcoded isThoughtMode-based retry target, which silently retried the
    // wrong query for a direct article fallback) must be gone.
    expect(screen).not.toContain("const hasLoadError");
    expect(screen).toContain(
      'const detailError = !isLocalDirectDraft && detailResolution.kind === "error" ? detailResolution : null;',
    );
    expect(screen).toContain("if (detailError) {");
    expect(screen).toContain("const errorCopy = DETAIL_ERROR_COPY[detailError.reason];");
    expect(screen).toContain("if (detailError.retryEntity === \"thought\") {");
  });

  it("shows cause-specific copy for a missing record vs. a route the server doesn't provide yet", () => {
    const screen = readScreen();
    const copyBlock = screen.slice(
      screen.indexOf("const DETAIL_ERROR_COPY"),
      screen.indexOf("export default function WritingScreen"),
    );
    expect(copyBlock).toContain('"not-found": {');
    expect(copyBlock).toContain('"not-implemented": {');
    expect(copyBlock).toContain("auth: {");
    expect(copyBlock).toContain("connection: {");
    // The four user-facing failure causes required by the task (missing
    // record, connection problem, expired login, unsupported route) must map
    // to distinct titles. "not-dividing" intentionally reuses "not-found"'s
    // copy (both mean "there's nothing here for you"), so dedupe by reason
    // rather than expecting every entry to be unique.
    const distinctReasonCopy = ["not-found", "auth", "not-implemented", "connection"].map((reason) => {
      const start = copyBlock.indexOf(`${reason === "not-found" ? '"not-found"' : reason}: {`);
      const title = copyBlock.slice(start, start + 200).match(/title:\s*"([^"]+)"/);
      return title?.[1];
    });
    expect(new Set(distinctReasonCopy).size).toBe(4);
  });
});

describe("on-01a unactivated question redirection (scenario: direct entry into a queued question)", () => {
  it("detects an unactivated queued question from its own fetched status, not route params", () => {
    const screen = readScreen();
    expect(screen).toContain('thought?.createdFrom === "question"');
    expect(screen).toContain('thought?.status === "PRELIMINARY"');
    const gate = screen.slice(
      screen.indexOf("const isUnactivatedQuestion ="),
      screen.indexOf("// Mutations"),
    );
    expect(gate).toContain('detailResolution.entity === "thought"');
  });

  it("activates through the same endpoint the question queue screen uses, guarded against overlapping runs", () => {
    const screen = readScreen();
    expect(screen).toContain("const activateThoughtQuestion = useActivateThoughtQuestion();");
    expect(screen).toContain("const questionActivationRef = useRef<string | null>(null);");
    const runner = screen.slice(
      screen.indexOf("runQuestionActivationRef.current = () => {"),
      screen.indexOf("useEffect(() => {\n    if (!isUnactivatedQuestion || !id) return;"),
    );
    expect(runner).toContain("if (!id || isRunningQuestionActivationRef.current) return;");
    expect(runner).toContain("await activateThoughtQuestion.mutateAsync({ id });");
    expect(runner).toContain("setThoughtQuestionQueueCache(queryClient, result);");
    expect(runner).toContain("upsertThoughtInRecordCaches(queryClient, result.activatedThought);");
  });

  it("shows a preparing state (not the editor) while activation is in flight", () => {
    const screen = readScreen();
    expect(screen).toContain("if (isUnactivatedQuestion) {");
    const preparing = screen.slice(
      screen.indexOf("if (isUnactivatedQuestion) {"),
      screen.indexOf('if ((!isLocalDirectDraft && !id) || dataLoading) {'),
    );
    expect(preparing).toContain("질문을 준비하고 있어요");
  });

  it("only navigates back for a confirmed-gone response (404/409), never for a transient or auth failure", () => {
    const screen = readScreen();
    const runner = screen.slice(
      screen.indexOf("runQuestionActivationRef.current = () => {"),
      screen.indexOf("useEffect(() => {\n    if (!isUnactivatedQuestion || !id) return;"),
    );
    // The confirmed-gone branch (and only that branch) triggers the
    // "it's gone" toast + navigation.
    const confirmedGoneBranch = runner.slice(
      runner.indexOf("if (isConfirmedGoneError(error)) {"),
      runner.indexOf("if (attempt < 2 && isRetryableDetailError(error)) {"),
    );
    expect(confirmedGoneBranch).toContain("이미 사라진 질문이에요");
    expect(confirmedGoneBranch).toContain("if (returnSessionRef.current.begin()) {");
    expect(confirmedGoneBranch).toContain("exitToPreviousList();");

    // A retryable failure (network/timeout/5xx) is retried up to twice
    // before giving up, and giving up must NOT navigate away.
    const retryBranch = runner.slice(
      runner.indexOf("if (attempt < 2 && isRetryableDetailError(error)) {"),
    );
    expect(retryBranch).toContain("detailQueryRetryDelayMs(attempt)");
    expect(retryBranch).toContain("setQuestionActivationFailed(true);");
    expect(retryBranch).not.toContain("exitToPreviousList();");
    expect(retryBranch).not.toContain("이미 사라진 질문이에요");
  });

  it("lets the user retry from the activation failure state instead of only offering to leave", () => {
    const screen = readScreen();
    const failureUi = screen.slice(
      screen.indexOf("questionActivationFailed ? ("),
      screen.indexOf(") : (\n              <>\n                <ActivityIndicator"),
    );
    expect(failureUi).toContain("질문을 여는 데 문제가 있어요");
    expect(failureUi).toContain("onPress={() => runQuestionActivationRef.current()}");
    expect(failureUi).toContain("다시 시도");
    expect(failureUi).toContain("이전 화면");
  });
});
