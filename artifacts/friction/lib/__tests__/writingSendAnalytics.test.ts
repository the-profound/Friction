import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("writing and send analytics wiring", () => {
  it("records writing only after a meaningful, non-injected editor export", () => {
    const screen = read("app/on-01a.tsx");
    const exportHandler = screen.slice(
      screen.indexOf("const handleAutosaveExport"),
      screen.indexOf("const handleEditorError"),
    );

    expect(exportHandler.indexOf("serverInjectionPendingRef.current")).toBeLessThan(
      exportHandler.indexOf("trackFirstMeaningfulEdit();"),
    );
    expect(exportHandler.indexOf("isMeaningfulThoughtMarkdown(md)")).toBeLessThan(
      exportHandler.indexOf("trackFirstMeaningfulEdit();"),
    );
  });

  it("emits draft saves only after onSave resolves with a server revision", () => {
    const autoSave = read("lib/useAutoSave.ts");
    const success = autoSave.slice(
      autoSave.indexOf("savedBaseline = await networkSave"),
      autoSave.indexOf("saved = true") + 500,
    );
    expect(success).toContain("onSaveSuccessRef.current?.");
    expect(success).toContain("revision: savedBaseline?.serverUpdatedAt");
  });

  it("deduplicates publish, draft, and send outcomes by server identity", () => {
    const analytics = read("lib/analytics.ts");
    expect(analytics).toContain("capturedOutcomeKeys.has(key)");
    expect(analytics).toContain('`${params.entityId}:${params.revision}`');
    expect(analytics).toContain('captureOutcomeOnce("article_published", params.articleId');
    expect(analytics).toContain('captureOutcomeOnce("send_completed", params.sendRecordId');
  });

  it("records send completion only after the authenticated server mutation succeeds", () => {
    const sendInline = read("components/ToInline/SendInline.tsx");
    const handler = sendInline.slice(
      sendInline.indexOf("const handleSend"),
      sendInline.indexOf("const handleSend") + 4000,
    );
    expect(handler.indexOf("await runAuthenticatedMutation")).toBeLessThan(
      handler.indexOf("trackSendCompleted({"),
    );
    expect(handler).toContain("sendRecordId: result.id");
    expect(handler.indexOf("trackSendCompleted({")).toBeLessThan(
      handler.indexOf("} catch (error)"),
    );
  });

  it("keeps analytics properties free of content and recipient names", () => {
    const analytics = read("lib/analytics.ts");
    const contract = analytics.slice(0, analytics.indexOf("function kstHour"));
    expect(contract).not.toMatch(/\b(content|title|recipient_name|nickname)\s*:/);
  });
});