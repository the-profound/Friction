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

export async function generateSparseEmbedding(text: string): Promise<Record<string, number>> {
  const serviceUrl = process.env.EMBEDDING_SERVICE_URL ?? "http://localhost:8000";

  const response = await fetch(`${serviceUrl}/embed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Embedding service error: ${response.status} ${body}`);
  }

  const json = await response.json() as { sparse: Record<string, number> };
  return json.sparse;
}
