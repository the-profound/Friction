import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readScreen = readFileSync(new URL("../app/read.tsx", import.meta.url), "utf8");
const writingScreen = readFileSync(new URL("../app/on-01a.tsx", import.meta.url), "utf8");
const closingScreen = readFileSync(new URL("../app/on-01c.tsx", import.meta.url), "utf8");
const sendScreen = readFileSync(new URL("../app/to-send.tsx", import.meta.url), "utf8");
const sendInline = readFileSync(
  new URL("../components/ToInline/SendInline.tsx", import.meta.url),
  "utf8",
);

describe("reply after reading flow", () => {
  it("only offers reply for a verified inbox delivery and navigates before background persistence", () => {
    expect(readScreen).toContain("const canStartReply = Boolean(");
    expect(readScreen).toContain("const inboxQueryParams = {");
    expect(readScreen).toContain("recipientId: userId,");
    expect(readScreen).not.toContain("recipientId: userId, isRead: false");
    expect(readScreen).toContain("item.id === inboxId");
    expect(readScreen).toContain("replySourceInbox.senderId !== userId");
    expect(readScreen).toContain('accessibilityLabel="답글 쓰기"');
    const handlerStart = readScreen.indexOf("const handleStartReply = useCallback");
    const handlerEnd = readScreen.indexOf("const handleCommitAndSkip = useCallback", handlerStart);
    const handler = readScreen.slice(handlerStart, handlerEnd);
    expect(handler.indexOf('pathname: "/on-01a"')).toBeGreaterThanOrEqual(0);
    expect(handler.indexOf('pathname: "/on-01a"')).toBeLessThan(
      handler.indexOf("await reading.commitCompletion()"),
    );
    expect(handler).toContain("await applyAnsweredQuestionCardsToMemo()");
    expect(handler).toContain("onSuccess: clearActiveSession");
    expect(handler.indexOf("onSuccess: clearActiveSession")).toBeGreaterThan(
      handler.indexOf("await applyAnsweredQuestionCardsToMemo()"),
    );
  });

  it("supports reply after archive through the idempotent completion contract", () => {
    const persistence = readFileSync(
      new URL("./readingPersistence.ts", import.meta.url),
      "utf8",
    );
    const sessionHook = readFileSync(
      new URL("./useReadingSession.ts", import.meta.url),
      "utf8",
    );
    expect(persistence).toContain(
      'COMPLETED_COMMITTED: ["IDLE", "READING"]',
    );
    expect(sessionHook).toContain(
      'if (disposition === "already_committed")',
    );
  });

  it("persists the source article and exact inbox delivery through writing", () => {
    expect(writingScreen).toContain("...(sourceArticleId ? { sourceArticleId } : {})");
    expect(writingScreen).toContain("`reply_context:${promoted.id}`");
    expect(writingScreen).toContain("replyToInboxId");
  });

  it("branches closing export into reply send or record-only completion", () => {
    expect(closingScreen).toContain('"이 글에 답장으로 바로 보낼까요?"');
    expect(closingScreen).toContain('handleConfirmExport(false)');
    expect(closingScreen).toContain('pathname: "/to-send"');
    expect(closingScreen).toContain("replyToInboxId: effectiveReplyToInboxId");
    expect(closingScreen).toContain("removeItem(`reply_context:${articleId}`)");
    expect(closingScreen).toContain("onBackdropPress={handleDismissExport}");
  });

  it("uses one lock across every completion-screen action", () => {
    expect(readScreen).toContain(
      'completionActionRef = useRef<"save" | "reply" | "exit" | null>(null)',
    );
    expect(readScreen).toContain("lock: completionActionRef");
    expect(readScreen).toContain(
      'if (completionActionRef.current && completionActionRef.current !== "save") return',
    );
    expect(readScreen).toContain(
      "isActionBusy={isSaving || isDeleting || isStartingReply}",
    );
    expect(readScreen).toContain("disabled={isActionBusy}");
  });

  it("requires the exact reply target to be verified on the send screen", () => {
    expect(sendScreen).toContain("prefillReplyInboxId={params.replyToInboxId}");
    expect(sendInline).toContain("item.id === prefillReplyInboxId");
    expect(sendInline).toContain("답장 대상을 확인하지 못했어요.");
    expect(sendInline).toContain('setMode("reply")');
    expect(sendScreen).toContain("removeItem(`reply_context:${prefillArticleId}`)");
  });
});