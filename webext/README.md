# AdBlockerX WebExtension scaffold

This directory contains a minimal WebExtension scaffold to start porting AdBlockerX's runtime and matching logic into a browser extension.

Files:

- `manifest.json` - MV3 manifest with permissions for `webRequest`/`webRequestBlocking` and `scripting`.
- `background.js` - Background service worker where parser and matcher should live.
- `content-script.js` - Minimal content script scaffold to inject runtime into pages.

How to test locally (Chrome/Edge):

1. Open `chrome://extensions/` (or `edge://extensions/`).
2. Enable "Developer mode".
3. Click "Load unpacked" and point to this `webext/` folder.
4. Inspect the background service worker and content script logs in DevTools.

Next steps to port:

- Move `lib/abp.js` logic into the background worker (or bundle it) and use it to build rules.
- Port `lib/aho.js` or a JS Aho implementation into the background worker for substring matching.
- Use `chrome.webRequest.onBeforeRequest` with the built rules to block/allow requests.
- Persist settings to `chrome.storage.local` and add a popup or options page for UI.
