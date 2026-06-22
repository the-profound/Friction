import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const SPELL_CHECK_MODEL = "gpt-5.1";

const SYSTEM_PROMPT = `당신은 한국어 맞춤법·띄어쓰기 교정 전문가입니다.
아래 마크다운 본문에서 맞춤법 오류, 띄어쓰기 오류를 찾아 JSON으로 반환하세요.

출력 형식(순수 JSON만, 추가 설명 없음):
{
  "changes": [
    {
      "context": "오류가 포함된 문장 전체(30자 이내의 주변 문맥)",
      "original": "틀린 원문 부분 문자열",
      "replacement": "교정본",
      "type": "맞춤법" 또는 "띄어쓰기",
      "reason": "교정 이유 한 줄 (30자 이내)"
    }
  ]
}

규칙:
- 교정이 필요 없으면 changes를 빈 배열로 반환
- original과 replacement는 문장 전체가 아닌 틀린 부분만 포함
- [IMG], URL, 이메일, 숫자, 날짜, 해시태그, 멘션은 절대 변경하지 말 것
- 마크다운 서식 기호(#, *, -, >, ---)는 절대 변경하지 말 것
- 고유명사, 외래어는 변경하지 말 것
- 한 번에 최대 20개까지만 반환`;

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
