export const RECORD_CONTROLS_INACTIVITY_MS = 5000;
export const RECORD_CONTROLS_SCROLL_THRESHOLD = 6;

export type RecordControlsTimer = ReturnType<typeof setTimeout> | null;
export type RecordControlsScrollVisibility = "show" | "hide" | "unchanged";
export type RecordControlsVisibilityAction = "activity" | "show" | "hide" | "inactive";

export function getNextRecordControlsVisibility(
  currentVisible: boolean,
  action: RecordControlsVisibilityAction,
  searchActive: boolean,
): boolean {
  if (searchActive) return false;
  if (action === "show") return true;
  if (action === "hide" || action === "inactive") return false;
  return currentVisible;
}

export function getRecordControlsScrollVisibility(
  previousOffset: number,
  nextOffset: number,
  threshold = RECORD_CONTROLS_SCROLL_THRESHOLD,
): RecordControlsScrollVisibility {
  const safeNextOffset = Math.max(0, nextOffset);
  if (safeNextOffset <= 0) return "show";

  const delta = safeNextOffset - Math.max(0, previousOffset);
  if (Math.abs(delta) < threshold) return "unchanged";
  return delta > 0 ? "hide" : "show";
}

export function clearRecordControlsTimer(timer: RecordControlsTimer): null {
  if (timer !== null) clearTimeout(timer);
  return null;
}

export function restartRecordControlsTimer(
  timer: RecordControlsTimer,
  onInactive: () => void,
  delay = RECORD_CONTROLS_INACTIVITY_MS,
): RecordControlsTimer {
  clearRecordControlsTimer(timer);
  return setTimeout(onInactive, delay);
}