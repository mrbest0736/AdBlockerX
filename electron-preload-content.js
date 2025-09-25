const { contextBridge, ipcRenderer } = require('electron');

// Minimal API exposed to content pages; keeps main control APIs out of untrusted pages.
contextBridge.exposeInMainWorld('adblockxContentBridge', {
  // allow the page to request the current content URL from main (read-only)
  getContentUrl: () => ipcRenderer.invoke('get-content-url')
});

// Listen for settings updates from main and apply them to the page's localStorage
ipcRenderer.on('abx-settings-update', (event, settings) => {
  try {
    const s = settings || {};
    for (const k of Object.keys(s)) {
      try { localStorage.setItem(k, JSON.stringify(s[k])); } catch(e) {}
      try { window.dispatchEvent(new CustomEvent('AdBlockX:event', { detail: { type: 'settings-updated', key: k } })); } catch(e) {}
    }
  } catch(e) {}
});

// Allow main to ask the content preload to inject runtime by executing script in page context
ipcRenderer.on('abx-inject-runtime', (event, code) => {
  try {
    if (!code) return;
    try { (0, eval)(code); } catch(e) { try { const fn = new Function(code); fn(); } catch(e) {} }
    try { window.dispatchEvent(new CustomEvent('AdBlockX:event', { detail: { type: 'runtime-injected' } })); } catch(e) {}
  } catch(e) {}
});

// Cosmetic filters: accept an array of selectors and procedural rules. We'll support:
// - static selectors (e.g. .ad-banner)
// - :-abp-contains("text") -> remove elements whose textContent includes text
// - :has(selector) -> remove elements that have a child matching selector
// - cosmetic exceptions are represented by selectors prefixed with "!EX:" (main sends exceptions separately)

let _abx_cosmetic_selectors = []; // array of { raw, selector, type: 'static'|'contains'|'has', text?, exception:bool }
let _abx_cosmetic_exceptions = new Set();
let _abx_style_sheets = null; // used if adoptedStyleSheets available
let _abx_style_el = null;

function createStyle() {
  try{
    // prefer Constructable Stylesheets where available (less flicker)
    if (document.adoptedStyleSheets && typeof CSSStyleSheet === 'function') {
      _abx_style_sheets = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, _abx_style_sheets];
      return _abx_style_sheets;
    }
  }catch(e){}
  // fallback to <style>
  if(!_abx_style_el){ _abx_style_el = document.createElement('style'); _abx_style_el.id = 'abx-cosmetic-style'; (document.head || document.documentElement).appendChild(_abx_style_el); }
  return _abx_style_el;
}

function buildStylesheetRules(){
  try{
    const staticSelectors = _abx_cosmetic_selectors.filter(s=>s.type==='static' && !s.exception).map(s=>s.selector).filter(Boolean).slice(0,500);
    const rules = staticSelectors.map(sel => `${sel} { display: none !important; visibility: hidden !important; }`).join('\n');
    const sheet = createStyle();
    try{
      if(_abx_style_sheets && _abx_style_sheets.replace) _abx_style_sheets.replace(rules);
      else if(_abx_style_el) _abx_style_el.textContent = rules;
    }catch(e){ if(_abx_style_el) _abx_style_el.textContent = rules; }
  }catch(e){}
}

function applyProceduralCosmeticsOnce(){
  try{
    for(const s of _abx_cosmetic_selectors){
      if(!s || s.exception) continue;
      if(s.type === 'contains' && s.text){
        try{ document.querySelectorAll(s.selector).forEach(el=>{ if(el && el.textContent && el.textContent.indexOf(s.text) !== -1) el.remove(); }); }catch(e){}
      } else if(s.type === 'has'){
        try{ document.querySelectorAll(s.selector).forEach(el=>{ try{ if(el.querySelector(s.subselector)) el.remove(); }catch(e){} }); }catch(e){}
      }
    }
  }catch(e){}
}

// Debounced re-apply to avoid repeated heavy DOM queries
let _abx_reapply_timer = null;
function scheduleReapply(delay = 80){ if(_abx_reapply_timer) clearTimeout(_abx_reapply_timer); _abx_reapply_timer = setTimeout(()=>{ buildStylesheetRules(); applyProceduralCosmeticsOnce(); _abx_reapply_timer = null; }, delay); }

ipcRenderer.on('abx-cosmetic-filters', (event, selectors) => {
  try{
    const incoming = Array.isArray(selectors) ? selectors.slice(0,2000) : [];
    _abx_cosmetic_selectors = [];
    _abx_cosmetic_exceptions.clear();
    for(const raw of incoming){
      if(!raw) continue;
      // handle a special exception hint prefix '!EX:' to mark exceptions (main could send exceptions list separately)
      if(String(raw).startsWith('!EX:')){ _abx_cosmetic_exceptions.add(String(raw).slice(4)); continue; }
      const s = String(raw).trim();
      // procedural :contains and :has
      const mContains = s.match(/(.+):-?abp-contains\((?:\"([^)]+)\"|\'([^)]+)\')\)$/);
      if(mContains){ const base = mContains[1].trim(); const text = mContains[2] || mContains[3] || ''; _abx_cosmetic_selectors.push({ raw: s, selector: base, type: 'contains', text, exception: false }); continue; }
      const mHas = s.match(/(.+):has\((.+)\)$/);
      if(mHas){ const base = mHas[1].trim(); const sub = mHas[2].trim(); _abx_cosmetic_selectors.push({ raw: s, selector: base, type: 'has', subselector: sub, exception: false }); continue; }
      // default static selector
      _abx_cosmetic_selectors.push({ raw: s, selector: s, type: 'static', exception: false });
    }
    // mark exceptions
    if(_abx_cosmetic_exceptions.size){ for(const s of _abx_cosmetic_selectors){ if(_abx_cosmetic_exceptions.has(s.selector)) s.exception = true; } }
    scheduleReapply(30);
  }catch(e){}
});

// observe DOM mutations and re-apply cosmetic rules (debounced)
const observer = new MutationObserver((muts)=>{ if(!_abx_cosmetic_selectors || !_abx_cosmetic_selectors.length) return; try{ scheduleReapply(60); }catch(e){} });
try{ observer.observe(document.documentElement || document, { childList: true, subtree: true, attributes: false }); }catch(e){}

// periodic fallback for dynamic content that MutationObserver misses
setInterval(()=>{ try{ applyProceduralCosmeticsOnce(); }catch(e){} }, 1500);
