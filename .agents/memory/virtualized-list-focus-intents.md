---
name: Virtualized list focus intents
description: One-shot navigation focus must wait for nested virtualized list acknowledgement.
---

A one-shot focus intent for a virtualized list must remain pending until the target is actually visible. For nested lists, require acknowledgement from both the outer group and inner item before consuming it.

**Why:** Issuing a scroll command is not proof that a virtualized row mounted, and a scheduled anchor restoration can run afterward and undo it. Frame-count delays also fail for distant groups.

**How to apply:** Cancel or coordinate pending anchor restoration, qualify acknowledgements by filter and entity identity, handle targets already in the current visible set, retry failed virtualized index scrolls, and consume only after visibility is confirmed.