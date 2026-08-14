---
name: Friction startup crash diagnostics
description: How to fetch real TestFlight crash text via App Store Connect API, and how to capture a fatal JS error message before RCTFatal aborts the process.
---

## App Store Connect crash log API (when exported .ips lacks the JS message)
- TestFlight beta-tester crash feedback is queryable via the App Store Connect REST API, even when the user only shared a plain `.txt`/`.ips` export that lacks a JS exception reason.
- Auth: build an ES256 JWT yourself from `APP_STORE_CONNECT_KEY_ID` / `_ISSUER_ID` / `_P8_KEY` (`aud: appstoreconnect-v1`). The `_P8_KEY` secret in this env stores the PEM with spaces instead of newlines — strip whitespace from the body and re-wrap at 64 chars before `crypto.createSign` will parse it.
- Endpoint: `GET /v1/apps/{appId}/betaFeedbackCrashSubmissions` (the top-level `/v1/betaFeedbackCrashSubmissions` returns 403 — must go through the app relationship). Each submission has a `crashLog` relationship: `GET /v1/betaFeedbackCrashSubmissions/{id}/crashLog` returns `data.attributes.logText`, the full crash report text.
- Caveat: for a React Native fatal-JS-error crash (`RCTFatal`/`abort`), this `logText` can be the *exact same* native-only unwind as the `.ips` — Apple's crash symbolication does not add the original JS exception message/reason. Don't assume this API will reveal what the exported file didn't; it round-trips to the same source.
- Response bodies here are large (30-40KB+) — write them to a file via an impure CodeExecution block rather than `console.log`, which truncates.

## Capturing the actual JS message when ASC can't provide it
- RN's `global.ErrorUtils.setGlobalHandler` fires for every uncaught JS error, fatal or not, and runs *before* the default handler calls `RCTFatal`/aborts. Wrap it (call the previous handler after your own logic) to intercept the message+stack right before a fatal crash.
- The write must be **synchronous** — an async write frequently loses the race against the imminent abort. `expo-file-system`'s new `File` class (`new File(Paths.document, name).write(str)` / `.textSync()` / `.exists`) is JSI-backed and synchronous, unlike `expo-file-system/legacy`'s promise-based API. Read the persisted file and upload it on the *next* launch, then delete it so it's never retried.
- Install the handler from the app's `index.js` entry (`main` in package.json, wrapping `import "expo-router/entry"`), not from `app/_layout.tsx` — the latter is app code that Metro/expo-router requires *after* index.js runs, so installing there misses crashes during that require.
