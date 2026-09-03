/** CENTER slots expire at their immutable delivery time and cannot be retried. */
export function canResendSpaceScheduledSend(
  status: string,
  letterType: string | null | undefined,
  schedulingBlocked: boolean,
): boolean {
  return (
    !schedulingBlocked &&
    letterType !== "CENTER" &&
    (status === "SENT" || status === "CANCELLED" || status === "FAILED")
  );
}