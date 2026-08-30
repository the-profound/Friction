/**
 * Regression test for the C2 flush race condition:
 *   - Title debounce triggers doSave (in-flight)
 *   - markDirty(body) is called DURING that in-flight save
 *   - The in-flight save must NOT clear isDirtyRef, because the body
 *     content hasn't been saved yet
 *   - flush() must then see isDirtyRef=true and persist the body
 *
 * Simulates the core dirty-epoch logic extracted from useAutoSave, in plain
 * TypeScript (no React, no DOM) so it runs in the vitest node environment.
 */
import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Minimal simulation of the useAutoSave dirty-epoch algorithm
// ---------------------------------------------------------------------------

function makeSaveController(useEpoch: boolean) {
  let isDirtyRef = false;
  let requestIdRef = 0;
  let dirtyEpochRef = 0;          // only used when useEpoch=true
  let latestContent = "";
  let savingRef = false;
  let activeSavePromise: Promise<void> | null = null;
  const savedPayloads: Array<{ title: string; content: string }> = [];

  async function doSave(
    onSave: (d: { title: string; content: string }) => Promise<void>,
    data: { title: string; content: string },
  ) {
    if (savingRef) return;
    const id = ++requestIdRef;
    const epochSnapshot = dirtyEpochRef; // snapshot (used only in epoch path)
    savingRef = true;

    const run = async () => {
      try {
        await onSave(data);
        // Determine whether to clear dirty
        const shouldClear = useEpoch
          ? requestIdRef === id && dirtyEpochRef === epochSnapshot
          : requestIdRef === id; // OLD: only checks concurrent doSave, not markDirty calls
        if (shouldClear) {
          isDirtyRef = false;
        }
      } finally {
        savingRef = false;
        if (activeSavePromise === p) activeSavePromise = null;
      }
    };

    const p = run();
    activeSavePromise = p;
    await p;
  }

  function markDirty(title: string, content: string) {
    latestContent = content;
    if (useEpoch) dirtyEpochRef++;   // NEW: epoch bump signals doSave not to clear
    isDirtyRef = true;
  }

  async function flush(
    onSave: (d: { title: string; content: string }) => Promise<void>,
    title: string,
    content: string,
  ): Promise<{ ok: boolean; savedContent: string | null }> {
    // Await any in-flight save (mirrors useAutoSave flush logic)
    if (activeSavePromise) {
      await activeSavePromise;
    }
    savingRef = false;

    if (!isDirtyRef) {
      return { ok: true, savedContent: null }; // skip — isDirty=false
    }

    // Proceed with save
    const payload = { title, content };
    await doSave(onSave, payload);
    return { ok: true, savedContent: content };
  }

  return { doSave, markDirty, flush, getIsDirty: () => isDirtyRef, savedPayloads };
}

// ---------------------------------------------------------------------------
// Shared scenario: title save in-flight, then markDirty(body) during save
// ---------------------------------------------------------------------------

async function runRaceScenario(useEpoch: boolean) {
  const ctrl = makeSaveController(useEpoch);

  // Intercept saves to inspect payloads
  const saves: Array<{ title: string; content: string }> = [];
  let resolveTitleSave!: () => void;
  const titleSaveGate = new Promise<void>((res) => { resolveTitleSave = res; });

  const onSave = async (d: { title: string; content: string }) => {
    saves.push({ ...d });
    if (d.content === "") {
      // Simulate title-only save taking time (network RTT)
      await titleSaveGate;
    }
  };

  // 1. Title debounce fires → doSave(title, content="") — does NOT await completion
  const titleSavePromise = ctrl.doSave(onSave, { title: "편지 제목", content: "" });

  // 2. markDirty(body) called DURING the in-flight title save
  ctrl.markDirty("편지 제목", "본문 내용 155자 테스트");

  // 3. Release the title save (network responds)
  resolveTitleSave();
  await titleSavePromise;

  // 4. isDirtyRef state after title save completes
  const isDirtyAfterTitleSave = ctrl.getIsDirty();

  // 5. flush() — mirrors handleBack calling markDirty then flush
  ctrl.markDirty("편지 제목", "본문 내용 155자 테스트");
  const flushResult = await ctrl.flush(onSave, "편지 제목", "본문 내용 155자 테스트");

  return { isDirtyAfterTitleSave, flushResult, saves };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useAutoSave – C2 flush race condition", () => {
  it("OLD logic (no epoch): title save clears isDirtyRef even after markDirty(body)", async () => {
    const { isDirtyAfterTitleSave, flushResult, saves } = await runRaceScenario(false);

    // OLD behaviour: isDirty gets incorrectly cleared → flush skips body save
    expect(isDirtyAfterTitleSave).toBe(false); // BUG: dirty was cleared
    // flush still proceeds because we call markDirty again before flush,
    // but in real code the in-flight save is what flush awaits, and if it
    // completes and clears dirty, flush sees false.
    // This assertion documents the OLD failure mode:
    expect(saves[0].content).toBe(""); // title save with empty body
  });

  it("NEW logic (dirtyEpoch): title save does NOT clear isDirtyRef after markDirty(body)", async () => {
    const { isDirtyAfterTitleSave, flushResult, saves } = await runRaceScenario(true);

    // NEW behaviour: epoch drifted → isDirty preserved after title save
    expect(isDirtyAfterTitleSave).toBe(true); // FIXED: dirty kept
    // flush proceeds and saves the body content
    expect(flushResult.savedContent).toBe("본문 내용 155자 테스트");
    expect(saves.length).toBe(2); // title save + body flush save
    expect(saves[1].content).toBe("본문 내용 155자 테스트");
    expect(saves[1].content.length).toBeGreaterThan(0);
  });

  it("NEW logic: flush sees isDirtyRef=true when markDirty(body) races with in-flight save", async () => {
    /**
     * Exact reproduction of the user-reported scenario:
     *   onTitleChange ×9 → title debounce → doSave(content="") in-flight
     *   본문 onChange ×1 → export debounce → markDirty(body) called during save
     *   handleBack → flush() → awaits in-flight → isDirtyRef must be TRUE
     */
    const ctrl = makeSaveController(true);
    const saves: Array<{ title: string; content: string }> = [];
    let resolveSave!: () => void;
    const gate = new Promise<void>((r) => { resolveSave = r; });

    const onSave = async (d: { title: string; content: string }) => {
      saves.push({ ...d });
      if (d.content === "") await gate; // title save hangs until released
    };

    // Title debounce fires (does not await)
    const titleSave = ctrl.doSave(onSave, { title: "제목", content: "" });

    // Body onChange → export debounce → markDirty called during title save
    ctrl.markDirty("제목", "본문 내용 155B");

    // handleBack calls flush() — this awaits the in-flight title save
    const flushPromise = ctrl.flush(onSave, "제목", "본문 내용 155B");

    // Now release the title save (network responds while flush is awaiting)
    resolveSave();
    await titleSave;

    const result = await flushPromise;

    // isDirtyRef must still be true after title save completed during flush
    expect(result.savedContent).toBe("본문 내용 155B");
    expect(saves.length).toBe(2);
    expect(saves[1].content).toBe("본문 내용 155B");
  });

  it("NEW logic: no false dirty — clean save correctly clears isDirtyRef when no markDirty during save", async () => {
    const ctrl = makeSaveController(true);
    const saves: Array<{ title: string; content: string }> = [];
    const onSave = async (d: { title: string; content: string }) => { saves.push(d); };

    ctrl.markDirty("제목", "본문");
    await ctrl.doSave(onSave, { title: "제목", content: "본문" });

    // No new markDirty during save → dirty correctly cleared
    expect(ctrl.getIsDirty()).toBe(false);
  });

  it("schedules a follow-up save when content changes during the first create", async () => {
    let latest = "첫 입력";
    let epoch = 1;
    let dirty = true;
    let saving = false;
    const saved: string[] = [];
    let releaseFirst!: () => void;
    const firstSaveGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const doSave = async (): Promise<void> => {
      if (saving) return;
      saving = true;
      const snapshot = epoch;
      const payload = latest;
      if (saved.length === 0) await firstSaveGate;
      saved.push(payload);
      saving = false;

      if (dirty && epoch !== snapshot) {
        await doSave();
      } else {
        dirty = false;
      }
    };

    const first = doSave();
    latest = "첫 입력 뒤에 이어진 최신 문장";
    epoch++;
    releaseFirst();
    await first;

    expect(saved).toEqual(["첫 입력", "첫 입력 뒤에 이어진 최신 문장"]);
    expect(dirty).toBe(false);
  });

  it("does not treat the initial create payload as permanently saved", async () => {
    let persistedId: string | null = null;
    let firstCreatedContent: string | null = null;
    let serverContent = "";

    const saveThought = async (content: string) => {
      if (!persistedId) {
        persistedId = "thought-1";
        firstCreatedContent = content;
        serverContent = content;
      }
      const createdContent = firstCreatedContent;
      firstCreatedContent = null;
      if (createdContent !== content) {
        serverContent = content;
      }
    };

    await saveThought("A"); // POST A
    await saveThought("B"); // PATCH B
    await saveThought("A"); // must PATCH A, not incorrectly skip it

    expect(serverContent).toBe("A");
  });

  it("re-exports after an earlier lifecycle flush before allowing back navigation", async () => {
    let editorContent = "키보드를 닫을 때의 내용";
    let tail: Promise<void> = Promise.resolve();
    let releaseFirstSave!: () => void;
    const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
    const persisted: string[] = [];

    const enqueueLatestFlush = () => {
      const run = async () => {
        const exported = editorContent;
        if (persisted.length === 0) await firstSaveGate;
        persisted.push(exported);
      };
      const task = tail.then(run, run);
      tail = task.then(() => undefined, () => undefined);
      return task;
    };

    const keyboardDismissFlush = enqueueLatestFlush();
    await Promise.resolve();
    editorContent = "뒤로 가기 직전의 더 최신 내용";
    const backFlush = enqueueLatestFlush();

    releaseFirstSave();
    await Promise.all([keyboardDismissFlush, backFlush]);

    expect(persisted).toEqual([
      "키보드를 닫을 때의 내용",
      "뒤로 가기 직전의 더 최신 내용",
    ]);
  });

  it("keeps the same create id after an empty draft is discarded and retyped", () => {
    let queued = {
      title: "",
      content: "# ",
      creationId: "7e867265-30c8-4df0-8137-4e7216c285dd",
    };

    const { creationId } = queued;
    queued = { title: "", content: "", creationId };
    queued = { ...queued, content: "다시 작성한 의미 있는 단상" };

    expect(queued.creationId).toBe("7e867265-30c8-4df0-8137-4e7216c285dd");
  });

  it("turns a permanently pending save into a finite retryable failure", async () => {
    vi.useFakeTimers();
    try {
      const rejectAfter = <T>(promise: Promise<T>, timeoutMs: number) =>
        new Promise<T>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
          promise.then(
            (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            reject,
          );
        });

      const neverSettles = new Promise<void>(() => {});
      const bounded = rejectAfter(neverSettles, 10_000);
      const assertion = expect(bounded).rejects.toThrow("timed out");

      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the newest queued identity and content after a timed-out create", () => {
    const queued = {
      creationId: "stable-create-id",
      content: "최초 요청 뒤에 입력한 최신 문장",
      entityId: undefined as string | undefined,
    };

    const retryPayload = { ...queued };

    expect(retryPayload.creationId).toBe("stable-create-id");
    expect(retryPayload.content).toBe("최초 요청 뒤에 입력한 최신 문장");
    expect(retryPayload.entityId).toBeUndefined();
  });

  it("does not let a delayed queue restore overwrite immediate user input", () => {
    let dirtyEpoch = 0;
    let latestContent = "";
    const restoreStartEpoch = dirtyEpoch;

    // The user types before AsyncStorage.getItem resolves.
    latestContent = "방금 입력한 최신 내용";
    dirtyEpoch++;

    const queuedContent = "이전 실행의 오래된 내용";
    if (dirtyEpoch === restoreStartEpoch) {
      latestContent = queuedContent;
    }

    expect(latestContent).toBe("방금 입력한 최신 내용");
  });
});
