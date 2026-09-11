---
name: Friction cover-photo commit
description: Atomic persistence and retry rules for verified article cover photos.
---

Treat cover-image verification/publication and the article’s saved cover as one
user-visible commit. The client must not treat an upload as successful, update
the preview, or export the letter until the server has persisted the
server-derived image path on the editable article.

**Why:** Publishing immutable storage bytes and later saving the cover in a
separate client request creates a failure window where the user selected a
photo but no saved article can display it. A lost response can also cause
retries to publish duplicate objects or pair already-uploaded bytes with
changed presentation settings.

**How to apply:** Bind persistence to the verification endpoint, derive the
image URL only from inspected bytes, and preserve the immutable staged-object
identity and the first cover presentation snapshot across retries. Flush
ordinary cover saves before starting this commit, then reconcile editor and
query-cache state from the server-returned cover. Stored API-relative image
paths must be made absolute at native render boundaries without changing
already absolute URLs.