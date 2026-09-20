---
name: Virtualized list focus intents
description: One-shot navigation focus must wait for nested virtualized list acknowledgement.
---

A one-shot focus intent for a virtualized list must remain pending until the target is actually visible. For nested lists, require acknowledgement from both the outer group and inner item before consuming it. Starting the focus must also be idempotent by intent token plus resolved target identity; do not clear that start guard until the intent itself is gone.

**Why:** Issuing a scroll command is not proof that a virtualized row mounted, and a scheduled anchor restoration can run afterward and undo it. Frame-count delays also fail for distant groups. Unstable arrays or callbacks can rerun the initiating effect, while clearing the guard at completion can restart the same intent before Context consumption reaches the child.

**How to apply:** Cancel or coordinate pending anchor restoration, qualify starts and acknowledgements by token, filter, and entity identity, handle targets already in the current visible set, retry failed virtualized index scrolls, and consume only after visibility is confirmed. Make visibility-state updates no-op when their flag is already set.