export type SerializedAsyncRunner = <T>(task: () => Promise<T>) => Promise<T>;

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