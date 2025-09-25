# AdBlockerX (Electron Control UI)

This repository contains a small demo Electron app that controls an in-page ad-blocking runtime (`AdBlockerX.js`). The project includes:

- `electron-main.js` — Electron main process that launches two BrowserWindows: a browsing `contentWindow` and a management `controlWindow`.
- `electron-preload-control.js` / `electron-preload-content.js` — preload scripts exposing limited IPC bridges.
- `AdBlockerX.html` — the control UI SPA used by the control window.
- `AdBlockerX.js` — the in-page runtime injected into pages.
- `server.js`, `node_agent.js` — bundled Node processes used as a local proxy/agent for enforcement (started by the app).

## Quick start (development)

1. Install dependencies (recommended to use Node 18+):

```powershell
npm install
```

1. Run the Electron app:

```powershell
npm run app
```

1. Useful scripts:

- `npm start` — run the demo proxy server (`server.js`).
- `npm run agent` — run the node agent (`node_agent.js`).
- `npm test` — run the small unit tests (Mocha).

## CLI flags

The Electron main process accepts a simple CLI override for the auto-inject behavior:

```powershell
# Force auto-inject on startup
electron . --auto-inject=true

# Force auto-inject off
electron . --auto-inject=false
```

This overrides the persisted `adblockx-config.json` setting.

## Tests

A minimal unit test was added to validate helper JSON (used in the control UI). Run:

```powershell
npm test
```

## Notes, security, and next steps

- The content preload is intentionally minimal to reduce the surface area exposed to remote pages; the control preload exposes richer APIs only to the local `AdBlockerX.html` UI.
- Auto-injection uses the content preload to evaluate the runtime inside the page context. Some sites may have CSP or other measures that complicate injection.
- Improvements to consider: persist all toggles centrally, add accessibility improvements to the control UI (ARIALive toast), package the app (electron-builder), and add E2E tests for injection flows.
