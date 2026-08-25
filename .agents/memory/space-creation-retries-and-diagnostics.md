---
name: Space creation retries and diagnostics
description: Rules for safe multi-step space creation, response-loss retries, and privacy-preserving diagnostics.
---

# Space creation retries and diagnostics

Parent creation and follow-up round creation are separate failure stages. A
parent create request needs a durable opaque key scoped to its creator, while
child creation is idempotent on the space-and-round-number key. Once a space
exists, retries must resume only its remaining rounds.

**Why:** Mobile requests can commit in Postgres just before the client loses the
response. Treating that retry as a fresh failure either creates duplicate parent
records or leaves the user unable to resume after a uniqueness conflict.

**How to apply:** Persist the parent key locally before sending, enforce a
creator-and-key unique index server-side, and return the committed parent on a
replay or concurrent unique conflict. Keep the key out of URLs and all API
responses. Require an approved operator for round creation and return the
already-created matching round on its insert conflict. Creation diagnostics may
include stage, anonymity, nickname presence/length, platform, and release
fingerprint—never the nickname, complete request body, tokens, IDs, opaque
creation keys, or raw database errors.