// Popup script for AdBlockX Chrome extension
document.addEventListener('DOMContentLoaded', function() {
  const statusEl = document.getElementById('status');
  const toggleBtn = document.getElementById('toggleEnable');
  const injectBtn = document.getElementById('injectRuntime');
  const netBlockingCb = document.getElementById('netBlocking');
  const deflectionEnableCb = document.getElementById('deflectionEnable');
  const deflectionModeSel = document.getElementById('deflectionMode');
  const redirectRow = document.getElementById('redirectRow');
  const redirectTargetInput = document.getElementById('redirectTarget');
  const spoofRulesArea = document.getElementById('spoofRules');
  const applyDeflectionBtn = document.getElementById('applyDeflection');
  const filterEditor = document.getElementById('filterEditor');
  const applyFiltersBtn = document.getElementById('applyFilters');
  const clearFiltersBtn = document.getElementById('clearFilters');
  const blockedCountEl = document.getElementById('blockedCount');

  // Load current state
  chrome.storage.local.get(['enabled', 'netBlocking', 'filters', 'blockedCount', 'deflection'], function(result) {
    statusEl.textContent = result.enabled ? 'ACTIVE' : 'DORMANT';
    netBlockingCb.checked = result.netBlocking || false;
    filterEditor.value = result.filters || '';
    blockedCountEl.textContent = result.blockedCount || 0;
    const def = result.deflection || { enabled: false, mode: 'block', redirectTarget: '', spoofRules: '' };
    deflectionEnableCb.checked = !!def.enabled;
    deflectionModeSel.value = def.mode || 'block';
    redirectTargetInput.value = def.redirectTarget || '';
    spoofRulesArea.value = def.spoofRules || '';
    redirectRow.style.display = deflectionModeSel.value === 'redirect' ? 'block' : 'none';

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

  // Deflection UI
  deflectionModeSel.addEventListener('change', function() {
    redirectRow.style.display = this.value === 'redirect' ? 'block' : 'none';
  });

  applyDeflectionBtn.addEventListener('click', function() {
    const raw = spoofRulesArea.value || '';
    const parsedSpoofs = parseSpoofRules(raw);

    const def = {
      enabled: !!deflectionEnableCb.checked,
      mode: deflectionModeSel.value,
      redirectTarget: redirectTargetInput.value.trim(),
      spoofRules: raw,
      // structured spoof entries (serializable) - pattern as string
      spoofs: parsedSpoofs
    };

    chrome.storage.local.set({ deflection: def });

    // Send to content script in active tab
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'setDeflection', deflection: def });
    });
  });

  // Parse spoof rules textarea into structured entries.
  // Syntax per line: <pattern> => <JSON>
  // Example: /youtube\.com\/api\/stats\/ads/i => {"status":200,"headers":{"Content-Type":"application/json"},"body":{"ad":false}}
  // Also allows a full JSON object per line describing { pattern, status, headers, body }
  function parseSpoofRules(text) {
    const out = [];
    if (!text) return out;
    const lines = String(text).split(/\r?\n/);
    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('#')) continue; // comment

      try {
        // If the line starts with '{' try JSON full object
        if (line.startsWith('{')) {
          const obj = JSON.parse(line);
          if (obj && obj.pattern) {
            out.push({ pattern: String(obj.pattern), status: obj.status || 200, headers: obj.headers || {}, body: obj.body != null ? obj.body : '' });
          }
          continue;
        }

        // Otherwise expect 'pattern => json'
        const parts = line.split('=>');
        if (parts.length >= 2) {
          const pat = parts.shift().trim();
          const rest = parts.join('=>').trim();
          let payload = null;
          try { payload = JSON.parse(rest); } catch (e) { payload = rest; }

          if (typeof payload === 'string') {
            out.push({ pattern: pat, status: 200, headers: {}, body: payload });
          } else if (typeof payload === 'object' && payload !== null) {
            out.push({ pattern: pat, status: payload.status || 200, headers: payload.headers || {}, body: payload.body != null ? payload.body : '' });
          }
          continue;
        }

        // If nothing matched, treat whole line as pattern that returns 204
        out.push({ pattern: line, status: 204, headers: {}, body: '' });
      } catch (e) {
        console.warn('Failed to parse spoof rule:', line, e);
      }
    }
    return out;
  }

  // Open stats port for live updates
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    try {
      const port = chrome.tabs.connect(tabs[0].id, { name: 'content-bridge-stats' });
      port.onMessage.addListener(msg => {
        if (!msg) return;
        if (msg.type === 'stats' && msg.stats) {
          const s = msg.stats;
          blockedCountEl.textContent = s.requestsBlocked || 0;
          // show deflected count if present
          const defEl = document.getElementById('deflectedCount');
          if (defEl) defEl.textContent = s.requestsDeflected || 0;
          statusEl.textContent = (result && result.enabled && s.requestsBlocked > 0) ? 'ACTIVE (ConX)' : statusEl.textContent;
        }
      });
    } catch (e) {}
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