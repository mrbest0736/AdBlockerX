// content-bridge.js
// A small, robust content script that bridges messages from the popup to
// the page runtime (ConX and AdBlockX). It safely queues actions until the
// runtimes are available and calls public APIs when present.

(function () {
  'use strict';

  // Configuration
  const DEBUG = (function() {
    try {
      const m = chrome && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest();
      return (m && m.name && /dev|local/i.test(m.name)) || location.hostname === 'localhost';
    } catch (e) { return false; }
  })();

  function dbg(...args) { if (DEBUG) console.log.apply(console, ['%c[content-bridge]', 'color:#2a9df4;font-weight:600;'].concat(args)); }
  function warn(...args) { console.warn.apply(console, ['%c[content-bridge]', 'color:#ff9900;font-weight:600;'].concat(args)); }
  function err(...args) { console.error.apply(console, ['%c[content-bridge]', 'color:#ff4444;font-weight:600;'].concat(args)); }

  // Wait helper: resolves when predicate() is true or rejects after timeout
  function waitFor(predicate, opts = {}) {
    const interval = opts.interval || 100;
    const timeout = opts.timeout || 3000;
    return new Promise((resolve, reject) => {
      if (predicate()) return resolve();
      const started = Date.now();
      const id = setInterval(() => {
        try {
          if (predicate()) {
            clearInterval(id);
            return resolve();
          }
          if (Date.now() - started > timeout) {
            clearInterval(id);
            return reject(new Error('waitFor: timeout'));
          }
        } catch (e) {}
      }, interval);
    });
  }

  // Small queue so messages received before runtime init are not lost.
  const pendingQueue = [];
  let processingQueue = false;

  function enqueueMessage(fn) {
    pendingQueue.push(fn);
    processQueueSoon();
  }

  function processQueueSoon() {
    if (processingQueue) return;
    processingQueue = true;
    // process asynchronously to avoid blocking message handler
    setTimeout(async () => {
      try {
        while (pendingQueue.length) {
          const fn = pendingQueue.shift();
          try { await fn(); } catch (e) { warn('queued handler error', e); }
        }
      } finally { processingQueue = false; }
    }, 0);
  }

  // Safe accessor helpers
  function hasConX() { return typeof window !== 'undefined' && !!window.ConX; }
  function hasAdBlockX() { return typeof window !== 'undefined' && !!window.AdBlockX; }

  // Apply toggle to ConX and AdBlockX (best-effort)
  function applyToggle(enabled) {
    try {
      if (hasConX()) {
        try {
          window.ConX.PROTOCOLS = window.ConX.PROTOCOLS || {};
          if (window.ConX.PROTOCOLS.NETWORK_LEVEL) window.ConX.PROTOCOLS.NETWORK_LEVEL.enabled = !!enabled;
          if (window.ConX.PROTOCOLS.RUNTIME_LEVEL) window.ConX.PROTOCOLS.RUNTIME_LEVEL.enabled = !!enabled;
          if (typeof window.ConX.forceRevalidation === 'function') window.ConX.forceRevalidation();
          console.log('%c[content-bridge] ConX protocols ' + (enabled ? 'enabled' : 'disabled'), 'color:#2288ff');
        } catch (e) { console.warn('[content-bridge] failed to toggle ConX', e); }
      }

      if (hasAdBlockX()) {
        try {
          // Prefer public API if available
          if (typeof window.AdBlockX.setEnabled === 'function') {
            window.AdBlockX.setEnabled(!!enabled);
          } else {
            // Best-effort: expose a flag and enqueue a callback if AdBlockX has a queue
            window.AdBlockX.__externalEnabled = !!enabled;
            if (typeof window.AdBlockX._enqueue === 'function') {
              window.AdBlockX._enqueue(() => {
                try {
                  // try a sanitized API again inside runtime
                  if (typeof window.AdBlockX.setEnabled === 'function') window.AdBlockX.setEnabled(!!enabled);
                } catch (e) {}
              });
            }
          }
          console.log('%c[content-bridge] AdBlockX toggled (best-effort): ' + !!enabled, 'color:#22aa88');
        } catch (e) { console.warn('[content-bridge] failed to toggle AdBlockX', e); }
      }
    } catch (e) { console.warn('[content-bridge] applyToggle error', e); }
  }

  // Apply filters: expects filters as a string (newline separated) or array
  function applyFilters(filters) {
    try {
      let arr = [];
      if (Array.isArray(filters)) arr = filters;
      else if (typeof filters === 'string') arr = filters.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      else if (filters == null) arr = [];

      // Validate and sanitize filters
      arr = validateFilters(arr);

      // Persist to localStorage under a reasonable key used by runtime (debounced)
      scheduleSaveFilters(arr);

      if (hasAdBlockX()) {
        try {
          if (typeof window.AdBlockX.applyFilters === 'function') {
            window.AdBlockX.applyFilters(arr);
          } else if (typeof window.AdBlockX._enqueue === 'function') {
            window.AdBlockX._enqueue(() => { try { if (typeof window.AdBlockX.applyFilters === 'function') window.AdBlockX.applyFilters(arr); } catch(e){} });
          }
        } catch (e) { console.warn('[content-bridge] applyFilters runtime call failed', e); }
      }

      // Ask ConX to revalidate blocking decisions
      if (hasConX() && typeof window.ConX.forceRevalidation === 'function') window.ConX.forceRevalidation();
      console.log('%c[content-bridge] applied filters count=' + arr.length, 'color:#6666ff');
    } catch (e) { console.warn('[content-bridge] applyFilters error', e); }
  }

  // Validate filter lines: keep simple host/path rules and sensible regexes
  function validateFilters(arr) {
    const out = [];
    const max = 1000;
    for (let i = 0; i < arr.length && out.length < max; i++) {
      const line = String(arr[i] || '').trim();
      if (!line) continue;
      // Reject obviously malicious or unsafe lines
      if (/\b(Constructor|prototype|__proto__)\b/i.test(line)) continue;
      // Limit length
      if (line.length > 500) continue;
      out.push(line);
    }
    return out;
  }

  // Debounced save to localStorage to avoid thrashing
  let _saveTimer = null;
  function scheduleSaveFilters(arr) {
    try {
      if (_saveTimer) clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => {
        try { localStorage.setItem('AdBlockX.REGEX_RULES', JSON.stringify(arr)); dbg('saved filters count=' + arr.length); } catch (e) { warn('saveFilters failed', e); }
        _saveTimer = null;
      }, 250);
    } catch (e) { warn('scheduleSaveFilters error', e); }
  }

  function clearFilters() { applyFilters([]); }

  // Gather stats from ConX and AdBlockX
  function gatherStats() {
    const out = { conx: null, adblock: null, timestamp: Date.now() };
    try {
      if (hasConX() && typeof window.ConX.getStats === 'function') out.conx = window.ConX.getStats();
      else if (hasConX() && window.ConX.stats) out.conx = Object.assign({}, window.ConX.stats);
    } catch (e) { console.warn('[content-bridge] gatherStats ConX error', e); }

    try {
      if (hasAdBlockX() && typeof window.AdBlockX.getStats === 'function') out.adblock = window.AdBlockX.getStats();
      else if (hasAdBlockX() && window.AdBlockX.__stats) out.adblock = Object.assign({}, window.AdBlockX.__stats);
    } catch (e) { console.warn('[content-bridge] gatherStats AdBlockX error', e); }

    return out;
  }

  // Message handler from popup (or other extension pages)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (!message || !message.action) return; // ignore

      switch (message.action) {
        case 'toggleBlocking': {
          const enabled = !!message.enabled;
          const respond = () => sendResponse({ ok: true });

          // If runtime isn't present, queue the toggle so it runs once runtime appears
          waitFor(() => hasConX() || hasAdBlockX(), { timeout: 2000 }).then(() => {
            applyToggle(enabled);
            emitRuntimeReady();
            respond();
          }).catch(() => {
            enqueueMessage(async () => applyToggle(enabled));
            respond();
          });
          break;
        }

        case 'applyFilters': {
          const filters = message.filters;
          const respond = () => sendResponse({ ok: true });
          waitFor(() => hasAdBlockX(), { timeout: 2000 }).then(() => {
            applyFilters(filters);
            emitRuntimeReady();
            respond();
          }).catch(() => { enqueueMessage(async () => applyFilters(filters)); respond(); });
          break;
        }

        case 'clearFilters': {
          const respond = () => sendResponse({ ok: true });
          waitFor(() => hasAdBlockX(), { timeout: 1500 }).then(() => { clearFilters(); emitRuntimeReady(); respond(); }).catch(() => { enqueueMessage(async () => clearFilters()); respond(); });
          break;
        }

        case 'getStats': {
          // gather synchronously and respond
          const stats = gatherStats();
          sendResponse(stats);
          break;
        }

        case 'ping': {
          sendResponse({ ok: true, conx: hasConX(), adblock: hasAdBlockX() });
          break;
        }

        default:
          // Unknown action: ignore
          break;
      }
    } catch (e) {
      err('message handler error', e);
    }
    // return true when respondAsync is needed. We use sendResponse synchronously.
    return true;
  });

  // Optionally: expose a small debug API on window for manual control
  try {
    if (typeof window !== 'undefined') {
      window.__AdBlockXContentBridge = {
        applyToggle,
        applyFilters,
        clearFilters,
        gatherStats
      };
    }
  } catch (e) {}

  // Emit a DOM event when runtime is detected so other page scripts can react
  function emitRuntimeReady() {
    try {
      const ev = new CustomEvent('AdBlockX:runtimeReady', { detail: { conx: hasConX(), adblock: hasAdBlockX() } });
      window.dispatchEvent(ev);
      dbg('runtimeReady emitted', ev.detail);
    } catch (e) {}
  }

  // Expose a stats push channel via port: popup can connect with name 'content-bridge-stats'
  const activePorts = new Map();
  chrome.runtime.onConnect.addListener(port => {
    try {
      if (!port || port.name !== 'content-bridge-stats') return;
      dbg('stats port connected');
      let closed = false;
      const sendStats = () => {
        try {
          if (closed) return;
          const s = gatherStats();
          port.postMessage({ type: 'stats', stats: s });
        } catch (e) { warn('sendStats failed', e); }
      };

      // send immediate and then periodic updates
      sendStats();
      const timer = setInterval(sendStats, 2000);
      activePorts.set(port, timer);

      port.onDisconnect.addListener(() => {
        closed = true;
        const t = activePorts.get(port);
        if (t) clearInterval(t);
        activePorts.delete(port);
        dbg('stats port disconnected');
      });
    } catch (e) { warn('onConnect handler error', e); }
  });

})();

