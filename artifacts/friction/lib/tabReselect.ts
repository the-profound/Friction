import type { RecordKindIntent } from "@/types/navigation";

export type ArchiveFilter = "personal" | "sentence";

const RECORD_KIND_ORDER: readonly RecordKindIntent[] = [
  "thought",
  "editing",
  "letter",
];

export function advanceRecordKind(
  current: RecordKindIntent,
  steps = 1,
): RecordKindIntent {
  const currentIndex = RECORD_KIND_ORDER.indexOf(current);
  return RECORD_KIND_ORDER[(currentIndex + steps) % RECORD_KIND_ORDER.length];
}

export function advanceArchiveFilter(
  current: ArchiveFilter,
  steps = 1,
): ArchiveFilter {
  if (steps % 2 === 0) return current;
  return current === "personal" ? "sentence" : "personal";
}