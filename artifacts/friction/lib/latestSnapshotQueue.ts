export type LatestSnapshotQueueStats = {
  active: boolean;
  pendingLatest: boolean;
  barriers: number;
};

type LatestEntry<T> = {
  kind: "latest";
  value: T;
};

type BarrierEntry<T> = {
  kind: "barrier";
  value: T;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type Entry<T> = LatestEntry<T> | BarrierEntry<T>;

/**
 * Serializes physical writes while retaining at most one not-yet-started
 * coalescible snapshot. Barriers are never merged and therefore preserve
 * delete, bind, and transition ordering.
 */
export class LatestSnapshotQueue<T> {
  private active = false;
  private entries: Entry<T>[] = [];
  private idlePromise: Promise<void> = Promise.resolve();
  private resolveIdle: (() => void) | null = null;
  private terminalError: unknown = null;

  constructor(
    private readonly write: (value: T) => Promise<void>,
    private readonly onStats?: (stats: LatestSnapshotQueueStats) => void,
    private readonly onError?: (error: unknown) => void,
  ) {}

  enqueueLatest(value: T): void {
    const tail = this.entries[this.entries.length - 1];
    if (tail?.kind === "latest") {
      tail.value = value;
    } else {
      this.entries.push({ kind: "latest", value });
    }
    this.start();
  }

  enqueueBarrier(value: T): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => {
      this.entries.push({ kind: "barrier", value, resolve, reject });
    });
    this.start();
    return promise;
  }

  whenIdle(): Promise<void> {
    return this.idlePromise.then(() => {
      if (this.terminalError) throw this.terminalError;
    });
  }

  getStats(): LatestSnapshotQueueStats {
    return {
      active: this.active,
      pendingLatest: this.entries.some((entry) => entry.kind === "latest"),
      barriers: this.entries.filter((entry) => entry.kind === "barrier").length,
    };
  }

  private start(): void {
    if (this.active) {
      this.emitStats();
      return;
    }
    this.active = true;
    this.terminalError = null;
    this.idlePromise = new Promise<void>((resolve) => {
      this.resolveIdle = resolve;
    });
    this.emitStats();
    void this.drain();
  }

  private async drain(): Promise<void> {
    while (this.entries.length > 0) {
      const entry = this.entries.shift()!;
      try {
        await this.write(entry.value);
        this.terminalError = null;
        if (entry.kind === "barrier") entry.resolve();
      } catch (error) {
        this.terminalError = error;
        if (entry.kind === "barrier") entry.reject(error);
        else this.onError?.(error);
      }
      this.emitStats();
    }
    this.active = false;
    this.resolveIdle?.();
    this.resolveIdle = null;
    this.emitStats();
  }

  private emitStats(): void {
    this.onStats?.(this.getStats());
  }
}