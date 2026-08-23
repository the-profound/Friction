---
name: Editor hydration autosave
description: Preventing server-to-WebView hydration events from becoming autosave writes
---

Server content injection into the Friction editor can cause the WebView to emit a dirty change and an export even though the user did not edit anything. Track the injection and ignore only the next exact export match; if the exported content differs, treat it as a real edit.

**Why:** Treating every export after an editor change as user input updates `updatedAt` when a saved thought is merely opened or refreshed.

**How to apply:** Keep the injection marker adjacent to the screen's export request tracking, set it immediately before programmatic `setMarkdown`, and clear it when the matching export is handled. Do not globally ignore exports equal to the server value, because a user may edit and then revert before saving.