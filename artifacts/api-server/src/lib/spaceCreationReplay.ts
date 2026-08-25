/**
 * Resolves a create request exactly once even when a first response is lost or
 * two retries overlap. The stored key is scoped by the caller before it reaches
 * this helper.
 */
export async function createOrReuseSpace<T>({
  findExisting,
  create,
}: {
  findExisting: () => Promise<T | null | undefined>;
  create: () => Promise<T>;
}): Promise<{ space: T; replayed: boolean }> {
  const existing = await findExisting();
  if (existing) return { space: existing, replayed: true };

  try {
    return { space: await create(), replayed: false };
  } catch (error) {
    const concurrentReplay = await findExisting();
    if (concurrentReplay) return { space: concurrentReplay, replayed: true };
    throw error;
  }
}