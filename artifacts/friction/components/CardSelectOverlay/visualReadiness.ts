export interface VisualGate {
  key: string;
  token: number;
  session: number;
  slotIndex: number;
  imageUrl: string | null;
}

export interface VisualReadySignal {
  token: number;
  session: number;
  slotIndex: number;
  imageUrl: string;
}

export function advanceVisualGate(
  previous: VisualGate,
  next: Omit<VisualGate, "token">,
): VisualGate {
  return { ...next, token: previous.token + 1 };
}

export function isCurrentVisualReady(
  gate: VisualGate,
  signal: VisualReadySignal,
): boolean {
  return (
    gate.token === signal.token &&
    gate.session === signal.session &&
    gate.slotIndex === signal.slotIndex &&
    gate.imageUrl === signal.imageUrl
  );
}