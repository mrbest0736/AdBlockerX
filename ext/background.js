// Minimal background script for WebExtension scaffold - not yet wired to UI or filter store
console.log('AdBlockerX extension background loaded (scaffold)');

// Placeholder: future work will port matcher and ABP parser here and use webRequest blocking.

chrome.runtime.onInstalled.addListener(()=>{ console.log('AdBlockerX extension installed (scaffold)'); });

// Extension sync API for cross-tab blocking
let extensionLists = {
  blackList: [],
  spoofList: [],
  extBlock: [],
  alwaysBlock: [],
  whiteList: [],
  regexRules: []
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'sync_lists') {
    // update extension's lists from content script
    extensionLists = {
      blackList: message.blackList || [],
      spoofList: message.spoofList || [],
      extBlock: message.extBlock || [],
      alwaysBlock: message.alwaysBlock || [],
      whiteList: message.whiteList || [],
      regexRules: message.regexRules || []
    };
    console.log('Extension received sync from tab');
    sendResponse({ success: true, injectContentScript: true });
    // broadcast to other tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id !== sender.tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'update_lists', ...extensionLists });
        }
      });
    });
  }
});
