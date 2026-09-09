---
name: Generated API Zod default initialization
description: A generated Zod schema can throw a web-only TDZ ReferenceError before the Expo router renders.
---

The generated API Zod barrel can contain a schema that calls a default constant before that constant is initialized. This is a runtime module-load failure, so the web preview may show a blank screen with only a ContextNavigator error even though Metro bundled successfully.

**Why:** TypeScript reports the same use-before-declaration error, but native-focused checks and bundling can still appear healthy until the web module is evaluated.

**How to apply:** When the web preview is blank after a frontend change, inspect the first browser/Metro ReferenceError before attributing it to the changed screen; regenerate or fix the generated API source of truth as a separate task.