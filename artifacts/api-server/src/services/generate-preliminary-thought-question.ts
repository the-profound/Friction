const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3.1-flash-lite";
const REQUEST_TIMEOUT_MS = 12_000;

export type QuestionSource = {
  content: string;
};

export type GeneratedPreliminaryQuestion = {
  title: string;
  description: string;
};

const SYSTEM_PROMPT = `당신은 사용자가 남긴 기록 가까이에서 짧은 후속 질문을 툭 건네는 가벼운 대화 상대입니다.

주어진 최대 3개의 기록에서 실제로 드러난 내용만 바탕으로 질문 하나와 짧은 설명을 만드세요.
- 여러 기록 사이에 자연스럽고 명확한 연결이 있을 때만 그 연결을 활용합니다. 연결이 약하거나 없으면 억지로 종합하지 말고, 질문하기 좋은 기록 하나에 집중합니다.
- 질문은 짧고 구체적인 한국어 한 문장, 의문형으로 씁니다. 한 번 읽고 부담 없이 답할 수 있는 한 가지 내용만 묻습니다.
- 질문은 이미 적힌 내용을 반복하거나 지나치게 일반적인 철학 질문이면 안 됩니다.
- 질문과 설명에서 기록에 없는 감정, 갈등, 동기, 문제, 교훈을 추측하거나 특정 답을 유도하지 않습니다.
- 설명은 답의 실마리나 과제를 제시하거나 행동을 권하지 않습니다. 사용자가 선택할 수 있는 다른 관점이나 범위를 중립적으로 열어 주는 한국어 문장 1개로 씁니다.
- 설명에서 출처나 날짜를 말하지 않습니다.
- 기록의 문장을 그대로 길게 인용하지 않습니다.

반드시 아래 JSON 객체만 응답합니다.
{"title":"질문 한 문장","description":"짧은 설명 한 문장"}`;

function normalizeLine(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”]+$/g, "").slice(0, limit);
}

export async function generatePreliminaryThoughtQuestion(
  sources: QuestionSource[],
): Promise<GeneratedPreliminaryQuestion | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const usableSources = sources
    .map((source) => source.content.trim())
    .filter((content) => content.length >= 20);

  if (!apiKey || usableSources.length === 0) return null;

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.45,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: usableSources.map((content, index) => `[기록 ${index + 1}]\n${content}`).join("\n\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = json.choices?.[0]?.message?.content ?? "";
  const matched = raw.match(/\{[\s\S]*\}/);
  if (!matched) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(matched[0]);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.description !== "string") return null;

  const title = normalizeLine(record.title, 120).replace(/^Q\.\s*/i, "");
  const description = normalizeLine(record.description, 240);
  if (!title || !description || !/[?？]$/.test(title)) return null;

  return { title, description };
}