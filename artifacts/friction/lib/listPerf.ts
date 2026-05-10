import { Platform } from "react-native";

/**
 * Standard FlatList performance preset applied across the app.
 *
 * Tuned for medium-sized lists of cards/rows (e.g. 수신함, 기록함, 보관함,
 * 단체모음). Caps initial work at ~10 rows, batches incremental work in the
 * same size, and keeps a small (5-window) virtualization radius. Clipping is
 * only enabled on Android — on iOS it can interact poorly with sticky
 * headers and inputs, and on Web it has no effect.
 *
 * Apply by spreading: `<FlatList {...LIST_PERF_PRESET} ... />`.
 *
 * Very small bottom-sheet pickers (a handful of rows) skip this preset since
 * the defaults already render the entire list in one batch.
 */
export const LIST_PERF_PRESET = {
  initialNumToRender: 10,
  maxToRenderPerBatch: 10,
  windowSize: 5,
  removeClippedSubviews: Platform.OS === "android",
} as const;
