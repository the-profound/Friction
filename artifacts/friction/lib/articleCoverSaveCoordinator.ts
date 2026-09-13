import {
  createLatestAsyncRunner,
  type LatestAsyncRunner,
} from "./serializedAsyncRunner";

type CoverSaveOperation<T> = {
  value: T;
  save: () => Promise<void>;
  onLatestSaved: () => void;
  onLatestError: (error: unknown, retry: () => void) => void;
  status: "pending" | "saved" | "failed";
};

type CoverSaveEntry<T> = {
  latest: CoverSaveOperation<T> | null;
  runner: LatestAsyncRunner<CoverSaveOperation<T>>;
};

const entries = new Map<string, CoverSaveEntry<unknown>>();

const getEntry = <T>(articleId: string): CoverSaveEntry<T> => {
  const existing = entries.get(articleId) as CoverSaveEntry<T> | undefined;
  if (existing) return existing;

  const entry = {} as CoverSaveEntry<T>;
  entry.latest = null;
  entry.runner = createLatestAsyncRunner<CoverSaveOperation<T>>({
    run: async (operation) => {
      await operation.save();
      operation.status = "saved";
      if (entry.latest === operation) {
        operation.onLatestSaved();
      }
    },
    onError: (error, operation) => {
      operation.status = "failed";
      if (entry.latest !== operation) return;
      operation.onLatestError(error, () => {
        if (entry.latest !== operation) return;
        operation.status = "pending";
        entry.runner.enqueue(operation);
      });
    },
  });
  entries.set(articleId, entry as CoverSaveEntry<unknown>);
  return entry;
};

export function queueLatestArticleCoverSave<T>(
  articleId: string,
  options: Omit<CoverSaveOperation<T>, "status">,
): void {
  const entry = getEntry<T>(articleId);
  const operation: CoverSaveOperation<T> = {
    ...options,
    status: "pending",
  };
  entry.latest = operation;
  entry.runner.enqueue(operation);
}

export async function waitForLatestArticleCoverSave(articleId: string): Promise<boolean> {
  const entry = entries.get(articleId);
  if (!entry) return true;
  await entry.runner.waitForIdle();
  return entry.latest?.status !== "failed";
}

/**
 * A verified photo commit already persisted its cover in a server-owned
 * transaction. Waiting callers may proceed, and retry actions from an older
 * regular cover save become no-ops.
 */
export function markArticleCoverSaveCommitted<T>(articleId: string, value: T): void {
  const entry = getEntry<T>(articleId);
  entry.latest = {
    value,
    save: async () => undefined,
    onLatestSaved: () => undefined,
    onLatestError: () => undefined,
    status: "saved",
  };
}

export function resetArticleCoverSaveCoordinatorForTests(): void {
  entries.clear();
}