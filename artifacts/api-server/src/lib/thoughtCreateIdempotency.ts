export type ThoughtCreateRetryAction = "return-existing" | "update" | "conflict";

export function getThoughtCreateRetryAction(input: {
  existingGeneration: number;
  incomingGeneration: number;
  contentMatches: boolean;
}): ThoughtCreateRetryAction {
  if (input.incomingGeneration < input.existingGeneration) {
    return "return-existing";
  }
  if (input.incomingGeneration === input.existingGeneration) {
    return input.contentMatches ? "return-existing" : "conflict";
  }
  return "update";
}