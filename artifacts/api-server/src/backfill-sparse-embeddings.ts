import { and, isNotNull, isNull, eq } from "drizzle-orm";
import { db, thoughtsTable } from "@workspace/db";
import { generateSparseEmbedding } from "./lib/embeddings.js";

const BATCH_SIZE = 20;
const DELAY_MS = 500;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateSparseWithRetry(
  text: string,
  thoughtId: string
): Promise<Record<string, number> | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await generateSparseEmbedding(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `  [시도 ${attempt}/${MAX_RETRIES}] 단상 ${thoughtId} Sparse 임베딩 실패: ${msg}`
      );
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        console.log(`  ${delay}ms 후 재시도...`);
        await sleep(delay);
      }
    }
  }
  return null;
}

async function main() {
  console.log("=== 단상 Sparse 임베딩 백필 시작 ===");
  console.log(
    `배치 크기: ${BATCH_SIZE}, 배치 간 딜레이: ${DELAY_MS}ms, 최대 재시도: ${MAX_RETRIES}회`
  );
  console.log("");

  const allThoughts = await db
    .select({ id: thoughtsTable.id, content: thoughtsTable.content })
    .from(thoughtsTable)
    .where(
      and(
        isNull(thoughtsTable.textEmbeddingSparse),
        isNotNull(thoughtsTable.content)
      )
    );

  const withContent = allThoughts.filter(
    (t: { id: string; content: string | null }) => t.content && t.content.trim().length > 0
  ) as Array<{ id: string; content: string }>;
  const skipped = allThoughts.length - withContent.length;

  console.log(`text_embedding_sparse가 NULL인 단상: ${allThoughts.length}개`);
  console.log(`content가 있는 단상 (처리 대상): ${withContent.length}개`);
  console.log(`content가 없는 단상 (건너뜀): ${skipped}개`);
  console.log("");

  if (withContent.length === 0) {
    console.log("처리할 단상이 없습니다.");
    process.exit(0);
  }

  let processed = 0;
  let failed = 0;
  const failedIds: string[] = [];

  for (let i = 0; i < withContent.length; i += BATCH_SIZE) {
    const batch = withContent.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(withContent.length / BATCH_SIZE);

    console.log(`배치 ${batchNum}/${totalBatches} 처리 중... (${batch.length}개)`);

    for (const thought of batch) {
      const content = thought.content!;
      const sparse = await generateSparseWithRetry(content, thought.id);

      if (sparse !== null) {
        await db
          .update(thoughtsTable)
          .set({ textEmbeddingSparse: sparse })
          .where(eq(thoughtsTable.id, thought.id));

        processed++;
        console.log(`  ✓ ${thought.id} (${content.length}자, ${Object.keys(sparse).length}개 토큰)`);
      } else {
        failed++;
        failedIds.push(thought.id);
        console.log(`  ✗ ${thought.id} — 최대 재시도 초과, 건너뜀`);
      }
    }

    if (i + BATCH_SIZE < withContent.length) {
      console.log(`  ${DELAY_MS}ms 대기 중...`);
      await sleep(DELAY_MS);
    }
  }

  console.log("");
  console.log("=== Sparse 백필 완료 ===");
  console.log(`성공: ${processed}개`);
  console.log(`실패: ${failed}개`);
  if (failedIds.length > 0) {
    console.log("실패한 단상 ID:");
    for (const id of failedIds) {
      console.log(`  - ${id}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
