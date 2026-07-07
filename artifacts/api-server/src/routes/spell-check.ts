import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const SPELL_CHECK_MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT = `역할: 너는 한국어 맞춤법·띄어쓰기 교정 엔진이다. 마크다운/리치텍스트가 섞일 수 있는 원문을 입력으로 받아, 오탈자와 띄어쓰기 오류만 찾아 교정 목록을 만든다.

[절대 원칙]
- 내용·의미·어휘·문장 구조·문장 순서·말투(높임/반말)·문장부호는 절대 바꾸지 않는다.
- 윤문·동의어 치환·요약/확장·가독성 개선 금지. 오직 (1) 철자 오류, (2) 띄어쓰기 오류만 교정한다.
- 100% 확신할 때만 교정한다. 조금이라도 애매하면 건너뛴다. (미교정이 오교정보다 낫다)

[건드리지 말 것]
- URL, 이메일, 숫자, 날짜·시간, 해시태그(#…), 멘션(@…), 고유명사.
- 마크다운/서식 기호(*, _, #, -, >, [], (), \`, |)와 이미지·링크·첨부 구문 자체. 단, 서식 기호 안의 '본문 글자'는 검사한다. (예: **단어** 의 "단어"는 검사하되 ** 는 그대로 둔다)
- 줄바꿈·빈 줄·들여쓰기 구조. 단어 사이 띄어쓰기 교정만 허용된다.

[교정 대상 — 한국어 빈출 오류(예시일 뿐, 없는 항목도 명백하면 교정)]
- 철자: 되/돼(됬다→됐다), 안/않, 낫다/낳다, -율/-률, 왠/웬, 든지/던지, 로서/로써.
- 띄어쓰기: 의존명사(수·것·때·데·뿐·만큼) 띄움, 보조용언, "안된다→안 된다", "할수있다→할 수 있다".

[변경 단위]
- original/replacement는 오류가 든 '최소 구간'만 잡는다. 멀쩡한 앞뒤 글자는 포함하지 않는다.
- replacement는 original을 그대로 치환하면 자연스럽게 이어지는 드롭인 교체본이어야 한다.
- 변경 구간끼리 겹치지 않는다.

[위치 식별 — 중복 대비]
- original은 원문에 그대로 존재하는 문자열이어야 한다. (위치 인덱스 금지)
- 같은 오류 문자열이 여러 번 나오면 각 발생을 개별 항목으로 만들고, context에 그 부분을 유일하게 찾을 수 있을 만큼의 앞뒤 원문(5~15자)을 담는다.
- 동일 오류가 반복돼도 합치지 말고 등장 순서대로 각각 보고한다.

[출력 형식]
- 오직 아래 JSON 객체 하나만 출력한다. 코드펜스, 주석, 설명, 인사말을 절대 붙이지 않는다.
- changes는 원문에 처음 등장하는 위치 순서대로 정렬한다.
- type은 정확히 "맞춤법" 또는 "띄어쓰기" 중 하나만 쓴다.
- reason은 40자 이내 한 줄, 규칙 근거만.
- 교정할 것이 없으면 {"changes": []} 를 반환한다.
- 한 번에 최대 20개까지만 반환한다.

{
  "changes": [
    {
      "id": "c1",
      "original": "원문에 그대로 있는 최소 오류 구간",
      "replacement": "교정된 구간",
      "type": "맞춤법",
      "context": "오류를 유일하게 찾을 수 있는 앞뒤 원문",
      "reason": "규칙 근거 한 줄"
    }
  ]
}

[예시]
입력: "오늘 일이 잘 됬다. 그러니 너무 걱정 안된다."
출력: {"changes":[{"id":"c1","original":"됬다","replacement":"됐다","type":"맞춤법","context":"일이 잘 됬다.","reason":"'되었다'의 준말은 '됐다'"},{"id":"c2","original":"안된다","replacement":"안 된다","type":"띄어쓰기","context":"걱정 안된다.","reason":"부정 부사 '안'은 띄어 씀"}]}

입력: "정확한 문장입니다."
출력: {"changes":[]}`;

function protectSpecialTokens(text: string): string {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, "[IMG]")
    .replace(/\[.*?\]\(.*?\)/g, (m) => `[LINK:${encodeURIComponent(m)}]`);
}

function countChangedChars(original: string, changes: SpellChange[]): number {
  return changes.reduce((sum, c) => sum + Math.abs(c.replacement.length - c.original.length) + 1, 0);
}

interface SpellChange {
  context: string;
  original: string;
  replacement: string;
  type: string;
  reason: string;
}

// Protected: IMG placeholders, URLs, emails, dates (YYYY-MM-DD etc.), standalone numbers,
// hashtags, mentions. Standalone numbers are protected because the LLM must not
// convert digits to Korean numerals or vice versa.
const PROTECTED_PATTERN =
  /(\[IMG\]|https?:\/\/\S+|[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}|\d{4}[-./]\d{1,2}[-./]\d{1,2}|\b\d+\b|#\S+|@\S+)/g;

// Simulate applying changes sequentially and verify each original still exists
// in the accumulated text before that change is applied.
function simulateApply(text: string, changes: SpellChange[]): { valid: boolean; reason?: string } {
  let cur = text;
  for (const change of changes) {
    if (change.original === change.replacement) continue;
    if (!cur.includes(change.original)) {
      return { valid: false, reason: "교정 적용 후 원문 누락" };
    }
    // Apply first occurrence only (same as editor behaviour)
    cur = cur.replace(change.original, change.replacement);
  }
  return { valid: true };
}

function validateChanges(text: string, changes: SpellChange[]): { valid: boolean; reason?: string } {
  const totalChars = text.replace(/\s/g, "").length || 1;
  const changedChars = countChangedChars(text, changes);
  if (changedChars / totalChars > 0.2) {
    return { valid: false, reason: "변경률 초과" };
  }

  for (const change of changes) {
    if (change.original === change.replacement) continue;

    // Protected-token gate: neither original nor replacement may touch a protected token
    const protectedMatches = text.match(PROTECTED_PATTERN) ?? [];
    for (const token of protectedMatches) {
      if (change.original.includes(token) || change.replacement.includes(token)) {
        return { valid: false, reason: "보호 구간 변경 감지" };
      }
    }

    // Markdown symbol gate: catches leading symbols AND mid-string markdown mutations
    const markdownSymbols = /^(#{1,6} |\*\*|__|\*|_|~~|`|>|- |\d+\. |---|---)/;
    const markdownChars = /[#*_`>~\-|]/;
    if (
      markdownSymbols.test(change.original) ||
      markdownSymbols.test(change.replacement) ||
      (markdownChars.test(change.original) && !markdownChars.test(change.replacement)) ||
      (!markdownChars.test(change.original) && markdownChars.test(change.replacement))
    ) {
      return { valid: false, reason: "마크다운 서식 변경 감지" };
    }

    // Existence gate (raw check)
    if (!text.includes(change.original)) {
      return { valid: false, reason: "원문 문자열 누락" };
    }
  }

  // Post-apply sequential loss detection
  return simulateApply(text, changes);
}

router.post("/spell-check", async (req, res) => {
  const { text } = req.body ?? {};
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text 필드가 필요합니다" });
    return;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    res.json({ changes: [] });
    return;
  }

  const protected_text = protectSpecialTokens(trimmed);

  try {
    const completion = await openai.chat.completions.create({
      model: SPELL_CHECK_MODEL,
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: protected_text },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    let parsed: { changes: SpellChange[] };
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("JSON not found");
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      res.json({ error: "검사 결과를 만들지 못했어요" });
      return;
    }

    if (!Array.isArray(parsed.changes)) {
      res.json({ error: "검사 결과를 만들지 못했어요" });
      return;
    }

    const validation = validateChanges(trimmed, parsed.changes);
    if (!validation.valid) {
      req.log?.warn({ reason: validation.reason }, "spell-check validation failed");
      res.json({ error: "검사 결과를 만들지 못했어요" });
      return;
    }

    res.json({ changes: parsed.changes });
  } catch (err) {
    req.log?.error({ err }, "spell-check LLM error");
    res.status(500).json({ error: "검사 중 오류가 발생했어요" });
  }
});

export default router;
