// Content script to bridge between popup and AdBlockerX runtime
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggleBlocking') {
    // Toggle AdBlockerX blocking
    if (window.AdBlockX) {
      if (message.enabled) {
        window.AdBlockX.earlyAttach && window.AdBlockX.earlyAttach({ installHooks: true });
      } else {
        // Disable - this would need to be implemented in AdBlockerX.js
        window.AdBlockX.disable && window.AdBlockX.disable();
      }
    }
    sendResponse({ success: true });
  } else if (message.action === 'applyFilters') {
    // Apply custom filters
    if (window.AdBlockX && window.AdBlockX.applyFilters) {
      window.AdBlockX.applyFilters(message.filters);
    }
    sendResponse({ success: true });
  } else if (message.action === 'clearFilters') {
    // Clear filters
    if (window.AdBlockX && window.AdBlockX.clearFilters) {
      window.AdBlockX.clearFilters();
    }
    sendResponse({ success: true });
  }
  return true;
});

// Initialize AdBlockerX when content script loads
if (window.AdBlockX && window.AdBlockX.earlyAttach) {
  window.AdBlockX.earlyAttach({ installHooks: true });
}