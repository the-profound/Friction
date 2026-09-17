export function readingQuestionAnswerLength(answer: string): number {
  return answer.trim().length;
}

export function createReadingQuestionSessionId(
  articleId: string,
  enteredAt: number = Date.now(),
  nonce: number = Math.random(),
): string {
  return `${articleId}:${enteredAt}:${nonce.toString(36).slice(2)}`;
}

export type ReadingQuestionSaveCard = {
  questionIndex: number;
  question: string;
  answer: string;
};

type SaveEntry = {
  clientId: string;
  status: "idle" | "in_flight" | "failed" | "succeeded";
};

export type ReadingQuestionSaveState = {
  entries: Map<number, SaveEntry>;
};

export function createReadingQuestionSaveState(): ReadingQuestionSaveState {
  return { entries: new Map() };
}

export function createReadingQuestionClientId(
  sessionId: string,
  questionIndex: number,
): string {
  const input = `${sessionId}:${questionIndex}`;
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    for (let word = 0; word < words.length; word += 1) {
      words[word] = Math.imul((words[word] ?? 0) ^ (code + word * 31), 0x01000193);
    }
  }
  const hex = words
    .map((word) => (word >>> 0).toString(16).padStart(8, "0"))
    .join("")
    .split("");
  hex[12] = "4";
  hex[16] = (((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8)).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export async function saveReadingQuestionAnswers<T>(params: {
  cards: ReadingQuestionSaveCard[];
  state: ReadingQuestionSaveState;
  sessionId: string;
  create: (card: ReadingQuestionSaveCard, clientId: string) => Promise<T>;
  onSucceeded: (card: ReadingQuestionSaveCard, result: T) => void;
  onFailed: (card: ReadingQuestionSaveCard, reason: unknown) => void;
}): Promise<void> {
  const claimed = params.cards.flatMap((card) => {
    const existing = params.state.entries.get(card.questionIndex);
    if (existing?.status === "in_flight" || existing?.status === "succeeded") return [];
    const entry = existing ?? {
      clientId: createReadingQuestionClientId(params.sessionId, card.questionIndex),
      status: "idle" as const,
    };
    entry.status = "in_flight";
    params.state.entries.set(card.questionIndex, entry);
    return [{ card, entry }];
  });

  const results = await Promise.allSettled(
    claimed.map(({ card, entry }) => params.create(card, entry.clientId)),
  );
  results.forEach((result, index) => {
    const claim = claimed[index];
    if (!claim) return;
    if (result.status === "fulfilled") {
      claim.entry.status = "succeeded";
      params.onSucceeded(claim.card, result.value);
    } else {
      claim.entry.status = "failed";
      params.onFailed(claim.card, result.reason);
    }
  });
}