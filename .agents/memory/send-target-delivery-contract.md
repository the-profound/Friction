---
name: Send target and delivery contract
description: Constraints for extending Friction sends without breaking legacy records or date handling.
---

New send targets are person, reply, and space; the historical group target remains readable but must not be produced by the new send flow. Reply sends should retain the exact selected inbox as the authoritative link, while accepting an article-ID selector only as a compatibility alias. Space sends must create the space letter and scheduled send in the same transaction as the send record.

**Why:** The send-record table is also a history of older collection sends, and the generated Zod client represents OpenAPI date fields as Date values even though JSON clients send YYYY-MM-DD strings.

**How to apply:** Normalize incoming calendar-date strings only for generated-schema validation, then apply the shared KST 06:00 policy to the original calendar date. Keep legacy person calls senderId/recipientId-compatible and resolve reply recipients from the verified read inbox row.