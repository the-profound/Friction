const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const EXPANSION_MODEL = "google/gemini-3.1-flash-lite";

export interface ThoughtNote {
  id: string;
  content: string;
}

export interface ThoughtExpansionResult {
  id: string;
  r: string | null;
  k: string[] | null;
  h: string[] | null;
}

const SYSTEM_PROMPT = `당신은 깊이 있는 독서와 글쓰기를 돕는 '사유 확장 분석 AI'입니다.
사용자가 현재 읽고 있는 '기준 단상(1번 단상)'과, 추천 후보로 제시된 '후보 단상 목록(2번 단상들)'을 비교 분석하여 사용자의 생각이 자연스럽게 이어지고 확장되도록 돕는 것이 당신의 역할입니다.

[분석 및 추출 가이드라인]
1. r (Thought Expansion Reason - 생각 확장 추천 사유):
   - 1번 단상을 읽은 사람이 2번 단상을 이어서 읽었을 때 "어떤 사유의 확장이나 관점의 전환을 얻을 수 있는지"를 설명하는 문장을 작성합니다.
   - 억지스러운 연결은 하지 않습니다. 적절한 연결점이 없다면 null을 반환합니다.
   - 선생님이 일기장에 적어두는 코멘트처럼, 친근하면서도 창의적인 시선으로 접근합니다.
   - 너무 장황하고 진지한 표현이나, 단순히 "이 메모를 추천합니다" 같은 상투적인 표현은 금지합니다.
   - 문장 형태: 40~60자 내외로, 어조(~입니다, ~할 수 있습니다)나 질문형(~일까요?)으로 작성합니다.

2. k (Target Keyword - 1번 단상의 매개 키워드):
   - r이 null이라면 빈 배열([])을 반환합니다.
   - 1번 단상 본문 내에 '실제로 존재하는' 단어/어구 중 1~2개를 배열 형태로 추출합니다.
   - r의 사유를 통해 후보 단상으로 생각을 이어나갈 때 핵심 고리가 되는 단어여야 합니다.
   - r이 null이 아니라면 빈 배열을 반환하지 않으며, 반드시 1~2개의 단어/어구를 선정합니다.

3. h (Candidate Highlight Tokens - 2번 단상의 하이라이트 어구 배열):
   - r이 null이라면 빈 배열([])을 반환합니다.
   - 2번 단상 본문 내에 '실제로 존재하는' 단어/어구 중 1~2개를 배열 형태로 추출합니다.
   - r의 사유를 통해 k의 키워드와 직접 연관되거나, 새로운 시각을 제공하는 강조 단어여야 합니다.
   - 특별히 강조할 단어가 없다면 빈 배열([])을 반환합니다.


[응답 JSON 규격]
반드시 다른 설명 없이 아래 구조의 JSON 객체만 반환해야 합니다.
{
  "results": [
    {
      "id": "후보 단상 ID",
      "r": "생각 확장 추천 사유 문장" 또는 null
      "k": ["1번 단상의 매개 키워드1", "2번 단상의 매개 키워드2(선택)"] 또는 null
      "h": ["2번 단상의 매개 키워드1", "2번 단상의 매개 키워드2(선택)"] 또는 null
    }
  ]
}

[퓨샷 예시 (Few-Shot Examples)]

--- 예시 1 ---
[입력]
Target Note (1번): "오늘 카페에서 사유한 내용을 기록장에 남겼다. 디지털 기기의 즉각적인 알림에서 벗어나 종이 위에 생각을 정립할 때 비로소 내면의 오롯한 언어가 완성되는 느낌이다."
Candidates:
  - id: "note_101"
    content: "18세기 영국의 커피하우스는 단순히 음료를 마시는 곳이 아니라, 사유를 나누고 글을 고쳐 쓰는 집단 지성의 장소였다."

[출력]
{
  "results": [
    {
      "id": "note_101",
      "r": "카페에서 사유하고 글을 쓰는 모습이 커피하우스의 문화와 닮아 있습니다.",
      "k": ["카페", "사유한"],
      "h": ["커피하우스", "집단 지성의 장소"]
    }
  ]
}

--- 예시 2 ---
[입력]
Target Note (1번): "즉각적인 답장보다 시차를 둔 느린 전송이 마음의 깊이를 더해준다. 생각이 숙성되는 시간을 견딜 때 비로소 진심이 전달된다."
Candidates:
  - id: "note_102"
    content: "어른이 되면서 멀어지는 친구들도 있지만, 오히려 더 가까워지는 친구들도 있습니다."

[출력]
{
  "results": [
    {
      "id": "note_102",
      "r": "친구들은 멀어진 것이 아니라, 생각이 숙성될 시간을 가지고 있는 것이 아닐까요?",
      "k": ["시차", "생각이 숙성되는 시간"],
      "h": ["멀어지는 친구들"]
    }
  ]
}

--- 예시 3 ---
[입력]
Target Note (1번): "데이터를 분석할 때 숫자의 가시성에 매몰되면 맥락에 숨겨진 인간의 서사를 놓치기 쉽다. 통계는 현상을 요약하지만, 원인은 언제나 맥락 속에 있다."
Candidates:
  - id: "note_103"
    content: "질적 연구와 현장 관찰이 주는 직관은 종종 통계 표본이 담아내지 못하는 뜻밖의 오차와 인간적 진실을 드러내 준다."

[출력]
{
  "results": [
    {
      "id": "note_103",
      "r": "숫자 뒤의 맥락을 찾는 여정이 질적 연구와 현장 관찰이 주는 직관을 통해 확장될 수 있습니다.",
      "k": ["맥락"],
      "h": ["직관"]
    }
  ]
}`;

function validateResults(results: unknown, expectedIds: string[]): results is ThoughtExpansionResult[] {
  if (!Array.isArray(results) || results.length !== expectedIds.length) return false;
  return results.every((item, i) => {
    if (typeof item !== "object" || item === null) return false;
    const r = item as Record<string, unknown>;
    if (r.id !== expectedIds[i]) return false;
    if (r.r !== null && typeof r.r !== "string") return false;
    if (!Array.isArray(r.k) && r.k !== null) return false;
    if (!Array.isArray(r.h) && r.h !== null) return false;
    if (Array.isArray(r.k) && !r.k.every((x: unknown) => typeof x === "string")) return false;
    if (Array.isArray(r.h) && !r.h.every((x: unknown) => typeof x === "string")) return false;
    return true;
  });
}

export async function analyzeThoughtExpansion(
  targetNote: ThoughtNote,
  candidates: ThoughtNote[],
): Promise<ThoughtExpansionResult[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const candidateLines = candidates
    .map((c) => `  - id: "${c.id}"\n    content: "${c.content}"`)
    .join("\n");

  const userMessage = [
    `Target Note (1번): "${targetNote.content}"`,
    `Candidates:`,
    candidateLines,
  ].join("\n");

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EXPANSION_MODEL,
      temperature: 0.3,
      response_format: { type: "json_object" },
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

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in model response");
  }

  const parsed = JSON.parse(jsonMatch[0]) as { results: unknown };
  const expectedIds = candidates.map((c) => c.id);

  if (!validateResults(parsed.results, expectedIds)) {
    throw new Error("Model response failed validation");
  }

  return parsed.results;
}
