export const RECORD_CONTROLS_INACTIVITY_MS = 5000;

export type RecordControlsTimer = ReturnType<typeof setTimeout> | null;

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