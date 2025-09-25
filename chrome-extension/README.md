# AdBlockX Chrome Extension Prototype

This folder contains a minimal Chrome extension sketch showing how Service Worker / in-page blocking can be moved to a browser extension for stronger, network-level enforcement.

Files:

- manifest.json - MV3 manifest requesting webRequest + declarativeNetRequest permissions and a background service worker.
- extension-background.js - Minimal background service worker that installs simple blocking rules via declarativeNetRequest and listens for messages from the page.

How to load for testing (Chrome/Edge):

1. Open chrome://extensions
2. Enable "Developer mode"
3. Click "Load unpacked" and select this `chrome-extension/` folder
4. The extension will install and the background worker should log to the extension's service worker console.

Notes & next steps:

- declarativeNetRequest has limits (rule counts) and differs by browser; for production consider using native webRequest/blocking APIs where permitted or multiple rule sets.
- This is a sketch. To integrate fully, you'll want to implement:
  - sync rules from your app (e.g., via chrome.storage)
  - UI popup or options page for control
  - messaging bridge securely authenticated between page and extension
  - packaging and release flows for Chrome Web Store / Edge Add-ons
