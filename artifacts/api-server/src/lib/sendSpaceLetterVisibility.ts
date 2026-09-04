export type SendSpaceLetterVisibility = "PUBLIC" | "RECIPIENT_ONLY";

export function resolveSendSpaceLetterVisibility(
  isAnonymous: boolean,
  requested?: SendSpaceLetterVisibility,
): SendSpaceLetterVisibility {
  return isAnonymous ? "RECIPIENT_ONLY" : (requested ?? "PUBLIC");
}

export function validateSendSpaceLetterVisibilityTarget(
  targetType: "person" | "reply" | "space",
  requested?: SendSpaceLetterVisibility,
): string | null {
  return targetType !== "space" && requested
    ? "spaceLetterVisibility is only valid for space sends"
    : null;
}
