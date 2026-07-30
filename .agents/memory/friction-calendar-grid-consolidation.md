---
name: Friction calendar grid consolidation
description: Root cause of the recurring garbled date-grid bug in of-space-start.tsx and the shared component that fixes it.
---

# Calendar grid: mass Reanimated-cell mount caused garbled first paint

A month grid can have up to ~42 date cells. Rendering each cell as a
`ScalePressable` (which owns its own `useSharedValue`/`useAnimatedStyle`)
means ~42 independent Reanimated worklets mount simultaneously the instant
the screen appears — this produced the blank/garbled first paint bug that
kept resurfacing in `artifacts/friction/app/of-space-start.tsx`.

**Why:** the same bug recurred because the screen had 3 hand-duplicated
calendar implementations; fixing one never reached the others.

**How to apply:** date/calendar grids in this app must render through
`artifacts/friction/components/shared/CalendarGrid.tsx` (`CalendarGrid` +
`CollapsibleDatePicker`), which uses plain `Pressable` per cell (no per-cell
Reanimated shared values) and centralizes month-nav/grid/weekday logic. Full
writeup and checklist: `.agents/skills/calendar-date-picker/SKILL.md`.
`artifacts/friction/app/of-space-rounds.tsx` still has its own unmigrated
date pickers (tracked as a follow-up task) — treat as a screen to migrate,
not a pattern to copy.
