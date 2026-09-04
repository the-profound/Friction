---
name: Atomic account deletion
description: Rules for keeping Friction account erasure atomic without deleting other users' derived content.
---

Delete the application user graph and the matching Supabase `auth.users` row in the same PostgreSQL transaction. Delete only rows owned by the departing user; when another user's content references the departing user's article or saved sentence as provenance, detach that nullable provenance instead of deleting the other user's content.

**Why:** Separate auth-admin and application-data operations can leave an orphaned identity or orphaned data after partial failure. Ownership and provenance are different: treating provenance as ownership causes destructive cross-user data loss.

**How to apply:** Any new user foreign key or user-owned table must be added to the account-erasure integration fixture and ordered cleanup. Keep a real disposable auth identity in rollback/concurrency tests. If a DELETE response is lost and a retry can no longer authenticate, clear local session/cache and route to login rather than offering an impossible retry.