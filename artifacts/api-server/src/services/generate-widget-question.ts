const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3.1-flash-lite";

const SYSTEM_PROMPT = `당신은 사용자의 단상 기록을 읽고, 생각을 다시 불러일으키는 '재점화 질문'과 그것을 더 쉽게 만드는 '보조 설명'을 생성하는 AI입니다.

[Role & Goal]
사용자가 최근에 남긴 단상(메모, 생각 조각)들을 종합적으로 읽고, 그 안에서 아직 끝나지 않은 생각의 실마리를 포착합니다.
- 질문은 사용자가 미처 생각하지 못했던 각도에서 접근해야 합니다.
- 보조 설명은 질문을 더 쉬운 문제로 만들어 주는 받침 문장이어야 합니다. 안내나 출처를 알려주는 문장이 아닙니다.
- 단상 원문, 인용문, 출처, 날짜를 보조 설명에 그대로 넣지 않습니다.
- "예전의 글을 보니 어떤 생각이 드나요?"처럼 범위가 너무 넓은 문장은 피합니다.
- 사용자의 생각을 대신 정리하거나 단정하지 않습니다.

[Tone & Style]
- 질문: 친근하고 따뜻하되 지적인 호기심을 담아, 의문형으로 작성합니다. 30~60자 이내.
- 보조 설명: 사용자가 자기 생각을 이어갈 여지를 남기는 문장 1개. 30자 이내.

[Output Format]
반드시 아래 형식으로만 응답합니다. 다른 설명을 추가하지 마세요.

[질문]
{질문 한 문장}

[보조 설명]
{보조 설명 한 문장}`;

export async function generateWidgetQuestion(
  recentThoughts: string[],
): Promise<{ question: string; subtext: string } | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  if (recentThoughts.length === 0) {
    return null;
  }

  const userMessage = `아래는 사용자가 최근에 남긴 단상들입니다.\n\n${recentThoughts
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n\n")}\n\n이 단상들을 읽고, 생각을 재점화하는 질문과 보조 설명을 생성해 주세요.`;

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenRouter API error: ${response.status} ${body}`);
  }

  const json = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = json.choices[0]?.message?.content ?? "";

  const questionMatch = raw.match(/\[질문\]\s*\n(.+)/);
  const subtextMatch = raw.match(/\[보조 설명\]\s*\n(.+)/);

  if (!questionMatch?.[1] || !subtextMatch?.[1]) {
    return null;
  }

  const question = questionMatch[1].trim();
  const subtext = subtextMatch[1].trim();

  if (!question || !subtext) return null;

  return { question, subtext };
}
