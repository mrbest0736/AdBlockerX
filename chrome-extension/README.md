# AdBlockX Chrome Extension

A complete Chrome extension that integrates the AdBlockerX runtime for advanced ad blocking.

## Files

- `manifest.json` - Manifest V3 configuration with content scripts and permissions
- `extension-background.js` - Service worker handling network rules and messaging
- `popup.html` - Extension popup interface
- `popup.js` - Popup script for user controls
- `AdBlockerX.js` - Main ad blocking runtime
- `content-bridge.js` - Bridge between popup and AdBlockerX runtime

## Features

- **Network-level blocking** via declarativeNetRequest (blocks ad URLs before they load)
- **Runtime injection** with fetch/XMLHttpRequest hooks for comprehensive blocking
- **Custom filter rules** with regex support
- **Popup control interface** for enabling/disabling and configuration

## Installation

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this folder
4. The extension will install with a toolbar icon

## Usage

- Click the extension icon to open the popup
- Toggle ad blocking on/off
- Enable network decimation for URL-based blocking
- Add custom filters in the textarea (one per line, use `/pattern/` for regex)
- Use "Inject into Current Page" to manually inject blocking on any page

## Permissions

- `declarativeNetRequest` - Network-level ad blocking
- `storage` - Save settings and filters
- `scripting` - Inject AdBlockerX runtime
- `tabs` - Access current tab for injection
- `host_permissions: <all_urls>` - Block ads on all websites
