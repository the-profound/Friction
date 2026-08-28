---
name: Durable create idempotency
description: Ordering and recovery rules for offline queues that protect first-create requests from ambiguous responses.
---

An idempotency key must be written to durable local storage before the first create request is allowed to reach the server. Starting an asynchronous write is not enough. A committed server response can be lost at the same moment the process exits, so recovery must already have the exact key used by that request.

**Why:** If the network response is lost after the server commits but before the client persists the returned server ID, retrying with a newly generated key creates a duplicate. The same gap reappears if an empty-draft discard removes the stable key and the user starts typing again in the same composer.

**How to apply:** Await the serialized queue write before POST. Upgrade legacy queued payloads with a stable key and persist the upgrade before retry. Keep that key when clearing meaningless content. When a local queue becomes a server-ID queue, persist entity-scoped aliases and clear every matching alias together after success.