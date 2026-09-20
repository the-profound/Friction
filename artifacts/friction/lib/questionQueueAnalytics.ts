import AsyncStorage from "@react-native-async-storage/async-storage";
import { posthog } from "./posthog";
import {
  questionOpportunityProperties,
  type QuestionOutcome,
} from "./questionAnswerMetrics";

export type QuestionQueueEvent =
  | "question_queue_card_viewed"
  | "question_queue_activated"
  | "question_queue_activation_failed"
  | "question_queue_answer_started"
  | "question_queue_answer_save_succeeded"
  | "question_queue_answer_save_failed";

const STORAGE_PREFIX = "question_queue_analytics:v1";
const inFlight = new Map<string, Promise<boolean>>();
const capturedThisRuntime = new Set<string>();

type PendingQuestionQueueEvent = {
  event: QuestionQueueEvent;
  questionId: string;
  answerLength?: number;
};

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

export function getQuestionAnswerLength(
  initialQuestionMarkdown: string,
  savedMarkdown: string,
): number {
  const normalizedInitial = normalizeMarkdown(initialQuestionMarkdown);
  const normalizedSaved = normalizeMarkdown(savedMarkdown);
  if (normalizedSaved.startsWith(normalizedInitial)) {
    return Array.from(normalizedSaved.slice(normalizedInitial.length).trim()).length;
  }
  const initial = Array.from(normalizedInitial);
  const saved = Array.from(normalizedSaved);
  if (initial.length === 0) return saved.length;

  // Align the immutable prompt against the saved document. The first saved
  // position that reaches the best alignment is the prompt boundary; only
  // text after that boundary is user answer text.
  let previous = new Uint32Array(saved.length + 1);
  for (const baselineCharacter of initial) {
    const current = new Uint32Array(saved.length + 1);
    for (let savedIndex = 1; savedIndex <= saved.length; savedIndex += 1) {
      current[savedIndex] = baselineCharacter === saved[savedIndex - 1]
        ? previous[savedIndex - 1] + 1
        : Math.max(previous[savedIndex], current[savedIndex - 1]);
    }
    previous = current;
  }
  const bestAlignment = previous[saved.length];
  let promptEnd = 0;
  while (promptEnd < saved.length && previous[promptEnd] < bestAlignment) {
    promptEnd += 1;
  }
  return Array.from(saved.slice(promptEnd).join("").trim()).length;
}

async function deliverQuestionQueueEvent(
  params: PendingQuestionQueueEvent,
  storageKey: string,
): Promise<boolean> {
  if (!posthog) return false;
  const eventKey = `${params.event}:${params.questionId}`;
  const insertId = `question-queue:${eventKey}`;
  capturedThisRuntime.add(eventKey);
  try {
    posthog.capture(params.event, {
      $insert_id: insertId,
      question_id: params.questionId,
      question_session_key: params.questionId,
      ...questionOpportunityProperties({
        surface: "question_queue",
        opportunityKey: params.questionId,
        sessionKey: params.questionId,
        outcome: questionQueueOutcome(params.event),
      }),
      ...(params.answerLength === undefined
        ? {}
        : { answer_length: Math.max(0, Math.trunc(params.answerLength)) }),
    });
    await AsyncStorage.setItem(storageKey, "delivered");
  } catch (error) {
    capturedThisRuntime.delete(eventKey);
    throw error;
  }
  return true;
}

function questionQueueOutcome(event: QuestionQueueEvent): QuestionOutcome {
  switch (event) {
    case "question_queue_card_viewed":
      return "exposed";
    case "question_queue_answer_started":
      return "answer_started";
    case "question_queue_answer_save_succeeded":
      return "save_succeeded";
    case "question_queue_answer_save_failed":
      return "save_failed";
    case "question_queue_activated":
      return "activated";
    case "question_queue_activation_failed":
      return "activation_failed";
  }
}

export async function trackQuestionQueueEventOnce(
  params: PendingQuestionQueueEvent,
): Promise<boolean> {
  const eventKey = `${params.event}:${params.questionId}`;
  if (capturedThisRuntime.has(eventKey)) return false;
  const existing = inFlight.get(eventKey);
  if (existing) return existing;

  const operation = (async () => {
    const storageKey = `${STORAGE_PREFIX}:${eventKey}`;
    if (await AsyncStorage.getItem(storageKey) === "delivered") {
      capturedThisRuntime.add(eventKey);
      return false;
    }
    await AsyncStorage.setItem(storageKey, JSON.stringify(params));
    return deliverQuestionQueueEvent(params, storageKey);
  })().finally(() => {
    inFlight.delete(eventKey);
  });
  inFlight.set(eventKey, operation);
  return operation;
}

export async function flushPendingQuestionQueueEvents(): Promise<void> {
  if (!posthog) return;
  const keys = await AsyncStorage.getAllKeys();
  const pendingKeys = keys.filter((key) => key.startsWith(`${STORAGE_PREFIX}:`));
  for (const storageKey of pendingKeys) {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw || raw === "delivered") continue;
    try {
      const params = JSON.parse(raw) as PendingQuestionQueueEvent;
      if (
        typeof params.questionId !== "string"
        || !params.event?.startsWith("question_queue_")
        || (
          params.answerLength !== undefined
          && !Number.isFinite(params.answerLength)
        )
      ) {
        continue;
      }
      await deliverQuestionQueueEvent(params, storageKey);
    } catch {
      // Keep the privacy-safe payload pending for the next app launch.
    }
  }
}