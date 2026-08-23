---
name: Friction record card gesture handoff
description: Prevent record-card presses from firing after a vertical web scroll gesture.
---

When a record card sits inside a React Native Web scroll list, do not rely on Pressable cancellation alone after a drag. Guard both normal and long presses with local movement tracking, and briefly suppress presses when the parent list reports scrolling.

**Why:** React Native Web can emit a trailing Pressable click after a vertical gesture has been handed off to the parent scroll view, which otherwise opens a record or its delete action.

**How to apply:** Keep the stationary-tap path available after the short parent-scroll guard expires. Retest center-card vertical drags as well as intentional long-press and normal-tap behavior whenever changing carousel or list gesture ownership.