---
name: Friction KST date SSOT
description: KST 기준 날짜/06:00 발송 시각 계산 규칙 — lib/kstDate.ts가 SSOT
---

Rule: any "오늘" comparison, 06:00 cutoff, or scheduled-send timestamp in the Friction app must go through `artifacts/friction/lib/kstDate.ts` (`kstToday`, `kstTomorrow`, `minOpeningSendDate`, `kstDateAt6`, `toKstCalendarDate`).

**Why:** the app's calendar UI represents dates as *local-midnight* Dates, but users may be on non-KST devices (web especially). Raw `new Date()` / `setHours(6,0,0,0)` produced wrong "today" judgments and scheduled sends at local 06:00 instead of KST 06:00; a completion review rejected a task for exactly this drift.

**How to apply:**
- Compare calendar cells against `kstToday()` (returns a local-midnight Date carrying the KST calendar date).
- Build server `scheduledAt` payloads with `kstDateAt6(calendarDate).toISOString()`.
- Display stored instants via `toKstCalendarDate(instant)` before formatting.
- Timezone-variance unit tests live in `lib/__tests__/kstDate.test.ts` (run with a fixed `now` instant; also passes under TZ=America/New_York).

Related: `CollapsibleDatePicker` supports an `onOpen?: () => Date | void` hook to snap an invalid/past selection (e.g. to tomorrow) when the grid opens.
