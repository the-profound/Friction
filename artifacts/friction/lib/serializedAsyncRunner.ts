export type SerializedAsyncRunner = <T>(task: () => Promise<T>) => Promise<T>;

export type LatestAsyncRunner<T> = {
  enqueue: (value: T) => void;
  retryLatest: () => void;
  getLatest: () => T | undefined;
  waitForIdle: () => Promise<void>;
};

type LatestAsyncRunnerOptions<T> = {
  run: (value: T) => Promise<void>;
  onError?: (error: unknown, value: T) => void;
};

export function createSerializedAsyncRunner(): SerializedAsyncRunner {
  let tail: Promise<void> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

/**
 * Runs at most one request at a time and collapses every waiting request into
 * the latest value. A failed latest value remains available for an explicit
 * retry; a newer value automatically supersedes it.
 */
export function createLatestAsyncRunner<T>({
  run,
  onError,
}: LatestAsyncRunnerOptions<T>): LatestAsyncRunner<T> {
  let latest: T | undefined;
  let pending: T | undefined;
  let running = false;
  let idlePromise = Promise.resolve();
  let resolveIdle: (() => void) | undefined;

  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (pending !== undefined) {
        const value = pending;
        pending = undefined;
        try {
          await run(value);
        } catch (error) {
          onError?.(error, value);
        }
      }
    } finally {
      running = false;
      if (pending !== undefined) {
        void drain();
      } else {
        resolveIdle?.();
        resolveIdle = undefined;
      }
    }
  };

  const enqueue = (value: T) => {
    latest = value;
    pending = value;
    if (!running && !resolveIdle) {
      idlePromise = new Promise<void>((resolve) => {
        resolveIdle = resolve;
      });
    }
    void drain();
  };

  return {
    enqueue,
    retryLatest: () => {
      if (latest !== undefined) enqueue(latest);
    },
    getLatest: () => latest,
    waitForIdle: () => idlePromise,
  };
}