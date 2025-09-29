// Popup script for AdBlockX Chrome extension
document.addEventListener('DOMContentLoaded', function() {
  const statusEl = document.getElementById('status');
  const toggleBtn = document.getElementById('toggleEnable');
  const injectBtn = document.getElementById('injectRuntime');
  const netBlockingCb = document.getElementById('netBlocking');
  const filterEditor = document.getElementById('filterEditor');
  const applyFiltersBtn = document.getElementById('applyFilters');
  const clearFiltersBtn = document.getElementById('clearFilters');
  const blockedCountEl = document.getElementById('blockedCount');

  // Load current state
  chrome.storage.local.get(['enabled', 'netBlocking', 'filters', 'blockedCount'], function(result) {
    statusEl.textContent = result.enabled ? 'ACTIVE' : 'DORMANT';
    netBlockingCb.checked = result.netBlocking || false;
    filterEditor.value = result.filters || '';
    blockedCountEl.textContent = result.blockedCount || 0;

    // Get ConX stats
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getStats' }, function(response) {
        if (response && response.conx) {
          const conxStats = response.conx;
          blockedCountEl.textContent = conxStats.requestsBlocked || 0;
          statusEl.textContent = (result.enabled && conxStats.requestsBlocked > 0) ? 'ACTIVE (ConX)' : 'DORMANT';
        }
      });
    });
  });

  // Toggle ad blocking
  toggleBtn.addEventListener('click', function() {
    chrome.storage.local.get(['enabled'], function(result) {
      const newState = !result.enabled;
      chrome.storage.local.set({ enabled: newState });
      statusEl.textContent = newState ? 'ACTIVE' : 'DORMANT';

      // Send message to content script
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleBlocking', enabled: newState });
      });
    });
  });

  // Inject runtime into current page
  injectBtn.addEventListener('click', function() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['AdBlockerX.js']
      });
    });
  });

  // Network blocking toggle
  netBlockingCb.addEventListener('change', function() {
    chrome.storage.local.set({ netBlocking: this.checked });
    // Update declarativeNetRequest rules
    updateNetworkRules(this.checked);
  });

  // Apply filters
  applyFiltersBtn.addEventListener('click', function() {
    const filters = filterEditor.value;
    chrome.storage.local.set({ filters: filters });

    // Send filters to content script
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'applyFilters', filters: filters });
    });
  });

  // Clear filters
  clearFiltersBtn.addEventListener('click', function() {
    filterEditor.value = '';
    chrome.storage.local.set({ filters: '' });
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'clearFilters' });
    });
  });

  function updateNetworkRules(enabled) {
    if (enabled) {
      // Re-enable default rules
      chrome.runtime.sendMessage({ action: 'enableNetworkRules' });
    } else {
      // Disable network rules
      chrome.runtime.sendMessage({ action: 'disableNetworkRules' });
    }
  }
});