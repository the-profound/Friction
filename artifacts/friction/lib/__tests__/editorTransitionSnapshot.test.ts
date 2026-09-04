import { describe, expect, it, vi } from "vitest";
import {
  exportEditorTransitionSnapshot,
  isEditorReloadInterruption,
} from "../editorTransitionSnapshot";

describe("editor transition snapshots", () => {
  it("retries exactly once when a native reload interrupts the old session", async () => {
    const request = vi
      .fn<() => Promise<{ title: string; content: string }>>()
      .mockRejectedValueOnce(
        new Error("Editor reloaded before export completed"),
      )
      .mockResolvedValueOnce({
        title: "재로딩 뒤 제목",
        content: "재로딩 뒤 본문",
      });

    await expect(exportEditorTransitionSnapshot(request)).resolves.toEqual({
      title: "재로딩 뒤 제목",
      content: "재로딩 뒤 본문",
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not retry real conversion failures", async () => {
    const request = vi
      .fn<() => Promise<{ title: string; content: string }>>()
      .mockRejectedValue(new Error("Markdown conversion failed"));

    await expect(exportEditorTransitionSnapshot(request)).rejects.toThrow(
      "Markdown conversion failed",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("recognizes stale responses from the replaced editor session", () => {
    expect(
      isEditorReloadInterruption(
        new Error("Editor export belongs to a stale reload session"),
      ),
    ).toBe(true);
  });
});