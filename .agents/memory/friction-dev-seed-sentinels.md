---
name: Friction dev-seed sentinel safety
description: Versioned development seed blocks need transaction-safe, deterministic sentinels.
---

# Friction dev-seed sentinel safety

Use a deterministic row ID as the sentinel only when it is exactly the same ID
used by the insert block. Keep the whole versioned block in one transaction so
a crash cannot commit the sentinel before the remaining rows are present.

**Why:** Versioned seed data is routinely executed more than once. A sentinel
that cannot identify the completed version repeats writes, while a
non-transactional block can leave a partial version behind.

**How to apply:** Define the sentinel from the same ID format or shared
constant used for the first inserted row, and commit it only after all related
space, membership, round, and content rows have succeeded.