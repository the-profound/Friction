---
name: iOS writing suspension dedupe
description: Non-obvious event ordering when editor blur and AppState suspension both trigger persistence.
---

Treat the editor blur caused by iOS suspension and the following AppState transition as one persistence boundary, including when blur fires a full event-loop turn before `inactive`.

**Why:** Canceling only a pending blur timer is insufficient. WKWebView blur can already start a flush before the AppState callback arrives, so `inactive` can otherwise enqueue a second export and network save for the same interruption.

**How to apply:** Track whether an already-emitted blur flush covers the next suspension as well as canceling pending blur work. Clear that coverage only when the editor genuinely focuses again or the app resumes, so later active keyboard dismissals still save normally.