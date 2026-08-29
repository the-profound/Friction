import { describe, expect, it, vi } from "vitest";
import { createReadingSaveBoundary } from "./readingSaveBoundary";

describe("createReadingSaveBoundary", () => {
  it("allows progress writes only for its mounted user and article", () => {
    const boundary = createReadingSaveBoundary("user-a", "article-1");

    expect(boundary.canDispatch("user-a", "article-1")).toBe(true);
    expect(boundary.canDispatch("user-b", "article-1")).toBe(false);
    expect(boundary.canDispatch("user-a", "article-2")).toBe(false);
  });

  it("blocks queued writes and aborts in-flight writes when disposed", () => {
    const boundary = createReadingSaveBoundary("user-a", "article-1");
    const abortListener = vi.fn();
    boundary.signal.addEventListener("abort", abortListener);

    boundary.dispose();

    expect(boundary.canDispatch("user-a", "article-1")).toBe(false);
    expect(boundary.signal.aborted).toBe(true);
    expect(abortListener).toHaveBeenCalledTimes(1);
  });
});