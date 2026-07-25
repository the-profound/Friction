const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/embeddings";
const EMBEDDING_MODEL = "baai/bge-m3";
const EMBEDDING_DIMENSIONS = 1024;

export async function generateDenseEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenRouter embedding API error: ${response.status} ${body}`);
  }

  const json = await response.json() as { data: Array<{ embedding: number[] }> };
  const embedding = json.data?.[0]?.embedding;

  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Unexpected embedding shape: expected ${EMBEDDING_DIMENSIONS} dimensions, got ${embedding?.length ?? "none"}`
    );
  }

  return embedding;
}

const KO_STOPWORDS = new Set([
  "이", "가", "을", "를", "은", "는", "의", "에", "에서", "으로", "로",
  "와", "과", "도", "만", "까지", "부터", "에게", "한테", "께", "이라",
  "이고", "이며", "이나", "이든", "하고", "이면", "이면서", "이지만",
  "그", "그리고", "그래서", "그러나", "그런데", "그러면", "하지만",
  "또", "또한", "즉", "즉", "따라서", "왜냐하면", "때문에", "위해",
  "있다", "없다", "하다", "되다", "이다", "아니다", "같다", "그렇다",
  "수", "것", "때", "등", "및", "대한", "관한", "대해", "통해",
  "더", "매우", "너무", "정말", "아주", "많이", "좀", "잘", "다",
]);

const EN_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "it", "its", "this", "that", "these", "those",
  "i", "you", "he", "she", "we", "they", "my", "your", "his", "her",
  "not", "no", "so", "as", "if", "then", "than", "about", "up", "out",
]);

const MAX_TOKENS = 256;

export function generateSparseEmbedding(text: string): Record<string, number> {
  const freq: Record<string, number> = {};

  const tokens = text
    .toLowerCase()
    .split(/[\s\n\r\t.,!?;:()[\]{}"'<>|/\\~@#$%^&*+=`]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, "").trim())
    .filter((t) => t.length >= 2);

  for (const token of tokens) {
    if (KO_STOPWORDS.has(token) || EN_STOPWORDS.has(token)) continue;
    freq[token] = (freq[token] ?? 0) + 1;
  }

  const total = tokens.length || 1;

  const sorted = Object.entries(freq)
    .map(([word, count]) => [word, count / total] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOKENS);

  return Object.fromEntries(sorted);
}
