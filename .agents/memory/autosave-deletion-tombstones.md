---
name: Autosave deletion tombstones
description: Durable cleanup rules for records created or deleted while an editor exits without waiting for the network.
---

Represent deferred deletion as an explicit persisted operation, not as an empty save snapshot. Give it a definitive record identity; when creation uses a durable client-generated ID, that ID is the process-death fallback before a create response binds the server entity.

**Why:** A network create may commit after the editor exits or the app dies. An empty snapshot cannot tell restore logic to delete that record, and a response-bound ID may never reach local storage.

**How to apply:** Persist the delete tombstone before navigation, resume it on restore, and remove it only after DELETE succeeds. Associate cleanup with an immutable generation and clear storage only if that generation is still current, because a user can start a newer draft while old cleanup is in flight.