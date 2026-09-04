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

  it("sends the conversational question principles while preserving the JSON request contract", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              title: "오늘 가장 오래 기억에 남은 장면은 무엇인가요?",
              description: "하루 전체나 한순간 중 어느 범위에서 떠올려도 괜찮습니다.",
            }),
          },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchStub);

    await generatePreliminaryThoughtQuestion([
      { content: "오늘 산책을 하다가 작은 꽃을 보았고 한참 그 자리에 서 있었습니다." },
      { content: "저녁에는 오랜만에 책을 펼쳐 몇 페이지를 천천히 읽었습니다." },
    ]);

    expect(fetchStub).toHaveBeenCalledOnce();
    const request = fetchStub.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      response_format: { type: string };
      messages: Array<{ role: string; content: string }>;
    };
    const systemPrompt = body.messages.find((message) => message.role === "system")?.content ?? "";

    expect(body.response_format).toEqual({ type: "json_object" });
    expect(systemPrompt).toContain("가벼운 대화 상대");
    expect(systemPrompt).toContain("자연스럽고 명확한 연결이 있을 때만");
    expect(systemPrompt).toContain("질문하기 좋은 기록 하나에 집중");
    expect(systemPrompt).toContain("한 가지 내용만 묻습니다");
    expect(systemPrompt).toContain("감정, 갈등, 동기, 문제, 교훈을 추측");
    expect(systemPrompt).toContain("특정 답을 유도하지 않습니다");
    expect(systemPrompt).toContain("답의 실마리나 과제를 제시하거나 행동을 권하지 않습니다");
    expect(systemPrompt).toContain("다른 관점이나 범위를 중립적으로");
    expect(systemPrompt).toContain('{"title":"질문 한 문장","description":"짧은 설명 한 문장"}');
    expect(systemPrompt).not.toContain("편집자");
    expect(systemPrompt).not.toContain("천천히 따라가");
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