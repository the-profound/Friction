import { afterEach, describe, expect, it, vi } from "vitest";

import { generatePreliminaryThoughtQuestion } from "./generate-preliminary-thought-question";

describe("generatePreliminaryThoughtQuestion", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalApiKey;
    vi.unstubAllGlobals();
  });

  it("quietly skips generation when there is no usable source", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    await expect(generatePreliminaryThoughtQuestion([{ content: "짧음" }])).resolves.toBeNull();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("normalizes a valid model response and removes a duplicate Q prefix", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              title: "Q. 나에게 남은 감정은 무엇일까?",
              description: "두 기록이 만나는 지점을 천천히 따라가 보세요.",
            }),
          },
        }],
      }),
    }));

    await expect(generatePreliminaryThoughtQuestion([
      { content: "충분히 긴 첫 번째 단상입니다. 이 안에는 질문을 만들 재료가 있습니다." },
    ])).resolves.toEqual({
      title: "나에게 남은 감정은 무엇일까?",
      description: "두 기록이 만나는 지점을 천천히 따라가 보세요.",
    });
  });

  it("does not turn an invalid model payload into a stored question", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"title":"질문", "description":"설명"}' } }] }),
    }));

    await expect(generatePreliminaryThoughtQuestion([
      { content: "충분히 긴 첫 번째 단상입니다. 이 안에는 질문을 만들 재료가 있습니다." },
    ])).resolves.toBeNull();
  });
});