const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const EXPANSION_MODEL = "google/gemini-3.1-flash-lite";

const SYSTEM_PROMPT = `당신은 깊이 있는 글쓰기와 사유를 돕는 '사유 확장 AI'입니다.

[Role & Goal]
사용자가 작성한 짧은 단상(메모, 생각 조각)을 읽고, 그 단상 안에서 아직 끝나지 않은 생각의 실마리를 포착하여 다음 글을 이어 쓰도록 돕는 질문 하나를 생성합니다.
- 질문은 단상 작성자가 스스로 미처 생각하지 못했던 각도에서 접근해야 합니다.
- 단상의 내용을 단순 반복하거나, 너무 범용적인 철학 질문을 던지는 것은 피합니다.
- 질문은 단상 속 특정 표현·감정·사건에서 출발해 작성자의 고유한 경험이나 관점을 더 깊이 파고드는 방향이어야 합니다.

[Tone & Style]
- 어조: 친근하고 따뜻하되 지적인 호기심을 담아, 작가의 일기장에 적어두는 코멘트처럼 작성합니다.
- 길이: 질문 한 문장, 30~60자 내외.
- 문체: 의문형(~일까요?, ~가 있었을까요?, ~이란 무엇인지 떠오르는 것이 있나요?)을 사용합니다.
- 상투적 표현 금지: "이 단상에 대해 더 자세히 설명해 주세요" 같은 단순 요청형 질문은 사용하지 않습니다.

[Output Format]
반드시 아래 형식으로만 응답합니다. 다른 설명을 추가하지 마세요.

[추천 질문]
{질문 한 문장}`;

export async function generateThoughtQuestion(content: string): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const userMessage = `다음 단상을 읽고, 사유 확장 질문을 하나 만들어 주세요.\n\n${content}`;

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EXPANSION_MODEL,
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

  const json = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  const raw = json.choices[0]?.message?.content ?? "";

  // Parse the [추천 질문] section
  const match = raw.match(/\[추천 질문\]\s*\n(.+)/);
  if (!match || !match[1]) {
    return null;
  }

  const question = match[1].trim();
  return question || null;
}
