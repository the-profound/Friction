---
name: EAS publish concurrency
description: Friction's iOS and Android EAS publish workflows intentionally remain independently runnable.
---

Do not add a local lock that serializes the iOS and Android publish scripts. Once a project archive is uploaded, EAS builds run in the cloud and the user may intentionally overlap publish workflows.

**Why:** The user explicitly chose independent publish workflows after a local compression failure; a lock would block legitimate parallel Cloud builds and would not address the oversized archive itself.

**How to apply:** Keep concurrency control out of publish-ios.sh, publish-dev.sh, and publish-android.sh. Address archive-size or local compression problems separately.