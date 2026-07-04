import { eq } from "drizzle-orm";
import { db, articleQuestionsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";

const QUESTION_MODEL = "gpt-5-mini";
const QUESTION_COUNT = 5;
const MAX_ATTEMPTS = 2;
const MIN_QUESTION_LENGTH = 5;
const MAX_QUESTION_LENGTH = 100;

/**
 * 고정 3개 질문 폴백 — 기존 QuestionCardCurl / read.tsx 하드코딩과 동일한 문구.
 * AI 질문 생성이 아직 끝나지 않았거나 실패한 경우 클라이언트가 이 배열을 대신 사용한다.
 */
export const FALLBACK_QUESTIONS = [
  "작성자가 하고자 하는 말은 무엇이었나요?",
  "이 글을 읽고 떠오르는 다른 글이나 경험이 있다면 무엇인가요?",
  "이 글을 읽기 전과 읽은 후, 당신의 생각이 가장 크게 바뀐 지점은 어디인가요?",
];

const SYSTEM_PROMPT = `Role
너는 독자가 글을 읽고 자신의 삶과 내면을 깊이 성찰하도록 돕는 '사유 유도 도우미'이다.

Context
주어진 텍스트는 방금 독자가 읽은 글이다. 독자는 읽은 글을 바탕으로 단순 지식 습득이 아닌, '나에게 주는 의미'와 '내 삶을 투영한 새로운 생각'을 찾고자 한다.

Task
사용자가 제공하는 글을 분석하여, 독자가 글을 덮은 후 진지하게 스스로에게 던져볼 만한 [독자 본인을 향한 가장 날카롭고 매력적인 질문 5개]를 생성한다. 5개는 서로 다른 각도(감정, 경험 연결, 관점 전환, 세부 장면, 확장적 상상 등)에서 접근해 중복되지 않게 한다.

Question Guide Lines
1. 질문의 타겟 (절대 원칙): 모든 질문은 반드시 '글을 읽는 독자'를 향해야 한다. 글의 작성자인 저자에게 던지는 질문이 아닌, 독자를 위한 질문을 생성한다.
2. 추상화 원칙 (매우 중요): 글 속의 사건은 오직 '저자'에게만 실제로 일어난 일이다. "당신은"이라는 대명사만 붙이고 저자의 구체적 사건·소재·고유명사(예: 특정 직업, 특정 장소, 특정 사건명)를 그대로 되묻지 마라. 반드시 그 사건 뒤에 숨은 보편적 주제·감정·가치(예: 가면, 역할과 본모습의 괴리, 소속감, 전환점, 남은 시간에 대한 압박감)를 먼저 추출한 뒤, 그 주제를 독자 자신의 삶 속 유사하지만 다른 맥락에 적용해 묻는다.
   - 나쁜 예 (저자의 사건을 인칭만 바꿔 되묻음): "초기에 만든 '에이스' 가면을 벗은 뒤, 지금의 당신은 어떤 본모습을 더 자주 드러내고 싶으신가요?" → 이 사건은 저자만 겪은 것이라 독자에게 그대로 물으면 답할 수 없다.
   - 좋은 예 (주제만 가져와 독자의 삶으로 치환): "당신도 누군가에게 맞추기 위해 쓰고 있는 가면이 있다면, 그 가면을 벗었을 때 가장 먼저 드러날 모습은 무엇인가요?"
3. 맥락의 활용: 글에 등장하는 구체적인 소재나 가치관은 자유롭게 인용하되, 이를 독자의 현재 삶에 대입하는 매개체로만 사용한다.
4. 질문의 성격: 단순 사실 확인, 요약, 예/아니오 답변이 나오는 질문은 배제한다. 독자가 자신의 가치관이나 행동을 스스로 검열하게 만드는 '열린 질문'이어야 한다.
5. 어조: 친절하고 명료하며, 반드시 "~인가요?", "~어떠한가요?"와 같은 존댓말 어미로 끝맺음한다.
6. 각 질문은 최대 2문장(공백 포함 100자 내외)을 절대 넘지 않는다.
7. 최종 점검: 질문을 출력하기 전, 각 질문이 "저자만 답할 수 있는 질문"인지 "독자 누구나 자신의 경험에 비추어 답할 수 있는 질문"인지 스스로 검토하고, 전자에 해당하면 후자로 다시 고쳐 쓴다.

[출력 형식]
- 오직 아래 JSON 객체 하나만 출력한다. 코드펜스, 주석, 설명, 인사말을 절대 붙이지 않는다.
- questions 배열은 정확히 5개의 문자열을 담는다.

{
  "questions": ["질문1", "질문2", "질문3", "질문4", "질문5"]
}`;

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[.*?\]\(.*?\)/g, "")
    .replace(/[*_`>#]/g, "")
    .trim();
}

function validateQuestions(questions: unknown): questions is string[] {
  if (!Array.isArray(questions) || questions.length !== QUESTION_COUNT) return false;
  return questions.every(
    (q) =>
      typeof q === "string" &&
      q.trim().length >= MIN_QUESTION_LENGTH &&
      q.trim().length <= MAX_QUESTION_LENGTH &&
      q.trim().endsWith("?"),
  );
}

async function callModel(content: string): Promise<string[] | null> {
  const completion = await openai.chat.completions.create({
    model: QUESTION_MODEL,
    max_completion_tokens: 2048,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const questions = parsed?.questions;
    if (!validateQuestions(questions)) return null;
    return questions.map((q: string) => q.trim());
  } catch {
    return null;
  }
}

/**
 * 글 본문 기반 AI 질문 5개를 생성해 article_questions 테이블에 저장한다.
 * finalize 라우트에서 응답을 기다리지 않고 fire-and-forget으로 호출된다.
 * 실패해도 사용자에게 노출되지 않으며, 조회 시 FALLBACK_QUESTIONS로 대체된다.
 */
export async function generateArticleQuestions(articleId: string, content: string): Promise<void> {
  const cleanedContent = stripMarkdown(content).slice(0, 6000);

  if (!cleanedContent) {
    await db
      .insert(articleQuestionsTable)
      .values({ articleId, status: "FAILED" })
      .onConflictDoUpdate({
        target: articleQuestionsTable.articleId,
        set: { status: "FAILED", updatedAt: new Date() },
      });
    return;
  }

  await db
    .insert(articleQuestionsTable)
    .values({ articleId, status: "PENDING" })
    .onConflictDoUpdate({
      target: articleQuestionsTable.articleId,
      set: { status: "PENDING", updatedAt: new Date() },
    });

  let questions: string[] | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && !questions; attempt++) {
    try {
      questions = await callModel(cleanedContent);
    } catch (err) {
      lastError = err;
    }
  }

  try {
    if (questions) {
      await db
        .insert(articleQuestionsTable)
        .values({ articleId, questions, status: "COMPLETED" })
        .onConflictDoUpdate({
          target: articleQuestionsTable.articleId,
          set: { questions, status: "COMPLETED", updatedAt: new Date() },
        });
    } else {
      await db
        .insert(articleQuestionsTable)
        .values({ articleId, status: "FAILED" })
        .onConflictDoUpdate({
          target: articleQuestionsTable.articleId,
          set: { status: "FAILED", updatedAt: new Date() },
        });
      if (lastError) {
        // eslint-disable-next-line no-console
        console.error("generateArticleQuestions failed", { articleId, error: lastError });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("generateArticleQuestions: failed to persist result", { articleId, error: err });
  }
}

/**
 * 특정 글의 질문 카드용 질문 목록을 반환한다. 완료된 AI 질문이 있으면 그것을,
 * 없거나(대기/실패) 아직 생성 요청조차 없었던 경우엔 고정 3개 질문을 반환한다.
 */
export async function getArticleQuestionsOrFallback(articleId: string): Promise<string[]> {
  const [row] = await db
    .select()
    .from(articleQuestionsTable)
    .where(eq(articleQuestionsTable.articleId, articleId));

  if (row?.status === "COMPLETED" && Array.isArray(row.questions) && row.questions.length > 0) {
    return row.questions;
  }

  return FALLBACK_QUESTIONS;
}
