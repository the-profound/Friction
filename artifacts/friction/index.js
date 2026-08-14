// Custom entry point (Task #1454: startup crash diagnostics).
//
// This runs before `expo-router/entry` requires ANY app code, so the fatal
// JS error handler is installed as early as possible — able to capture
// crashes that happen while `app/_layout.tsx` (or its imports) are first
// evaluated, not just crashes that happen after React has mounted.
//
// See lib/crashDiagnostics.ts for what this actually does.
import "./lib/crashDiagnostics";

import "expo-router/entry";
