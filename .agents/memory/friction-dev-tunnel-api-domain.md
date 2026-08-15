---
name: Friction dev-tunnel API domain split
description: Why EXPO_PUBLIC_DOMAIN must point at the deployed API, not the ngrok domain, in dev:tunnel mode.
---

The `dev:tunnel` script starts Metro on a fixed port and exposes it via ngrok.
`EXPO_PUBLIC_DOMAIN` is used as the API base URL inside the JS bundle (via
`setBaseUrl` in `_layout.tsx`). If `EXPO_PUBLIC_DOMAIN` is set to the ngrok
domain, all `/api/*` calls hit Metro (which only serves JS bundles), Metro
responds with `HTTP 200 text/html`, `customFetch` auto-mode returns the HTML as
a plain string, and any `.filter()` / `.map()` call on that string crashes with
"undefined is not a function".

**Why:** ngrok only tunnels one port (Metro). API server runs on a different
port and is never reachable through the same ngrok URL.

**How to apply:**
- `REACT_NATIVE_PACKAGER_HOSTNAME` + `EXPO_PACKAGER_PROXY_URL` = ngrok domain
  (controls Metro bundle URL — correct).
- `EXPO_PUBLIC_DOMAIN` = `friction-1.replit.app` (the deployed API) — never the
  ngrok domain.
- The constant `API_DOMAIN = "friction-1.replit.app"` is defined near the top
  of `dev-tunnel.js` for easy updating when the deployment URL changes.
