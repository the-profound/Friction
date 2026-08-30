---
name: Signed upload verification
description: Security rule for validating and publishing objects written through reusable signed upload URLs.
---

Treat a staged object as mutable for the full lifetime of its signed PUT URL. Pin the generation observed during metadata validation, download that exact generation, enforce limits again on the downloaded bytes, inspect their signature, and publish only those verified bytes to a create-only destination. Do not publish by moving the unversioned staging key.

**Why:** A still-valid upload URL can replace the staging key between metadata inspection, download, and move. Without generation pinning and exact-byte checks, an attacker can bypass size or file-signature validation.

**How to apply:** Use this for every direct-to-object-storage upload that requires server validation before becoming readable. Keep staging namespaces inaccessible through application download routes.