// Minimal background service worker for the AdBlockerX scaffold.
// This worker demonstrates a place to port the matcher and parser logic.

self.addEventListener('install', (ev)=>{
  self.skipWaiting();
});

self.addEventListener('activate', (ev)=>{
  console.log('AdBlockerX webext background active');
  // lazy require of parser (if available)
  try{
    if(typeof importScripts === 'function'){ try{ importScripts('abp.js'); }catch(e){} }
  }catch(e){}
});

// Placeholder simple message handler from popup/devtools
self.addEventListener('message', (ev)=>{
  console.log('background message', ev.data);
  try{
    if(ev.data && ev.data.type === 'applyFilters'){
      // Basic demonstration: parse the filters sent and log the parsed count
      if(typeof importScripts === 'function'){ try{ importScripts('abp.js'); }catch(e){} }
      try{ if(typeof parse === 'function'){ const rules = parse(Array.isArray(ev.data.filters)?ev.data.filters:[]); console.log('Parsed rules', rules.length); } }
      catch(e){ console.error('parse failed', e); }
    }
  }catch(e){}
});

// Basic webRequest block example (no rules loaded — sample only)
// Matcher state
let MATCHER = {
  aho: null,
  simplePatterns: [], // array of strings
  regexRules: [], // { re: RegExp, raw }
  exceptions: [] // similar structure
};

function buildMatcherFromRules(rules){
  try{
    // rules: array of parsed ABP rule objects from webext/abp.js
    const aho = new self.Aho();
    const simple = [];
    const regexRules = [];
    const exceptions = [];
    let id = 0;
    for(const r of (rules||[])){
      if(r.type === 'cosmetic') continue;
      if(r.type === 'exception'){
        // exceptions: store both regex and substring
        if(r.isRegex && r.re) exceptions.push({ isRegex:true, re: r.re, raw: r.raw }); else exceptions.push({ isRegex:false, pattern: r.pattern || r.raw, raw: r.raw });
        continue;
      }
      // blocks
      if(r.isRegex && r.re){ regexRules.push({ re: r.re, raw: r.raw }); continue; }
      const pat = r.pattern || r.raw;
      simple.push(pat);
      try{ aho.add(pat, id++); }catch(e){}
    }
    try{ aho.build(); }catch(e){}
    MATCHER.aho = aho; MATCHER.simplePatterns = simple; MATCHER.regexRules = regexRules; MATCHER.exceptions = exceptions;
    return true;
  }catch(e){ console.error('buildMatcherFromRules failed', e); return false; }
}

// WebRequest handler that uses MATCHER
function webRequestHandler(details){
  try{
    const url = details.url || '';
    const hostname = (()=>{ try{ return new URL(url).hostname || ''; }catch(e){ return ''; }})();
    const rtype = details.type || details.resourceType || '';
    // check exceptions first
    for(const ex of MATCHER.exceptions){
      if(ex.isRegex && ex.re){ if(ex.re.test(url)) return {}; }
      else { if(url.indexOf(ex.pattern)!==-1) return {}; }
    }
    // check regex rules
    for(const rr of MATCHER.regexRules){ if(rr.re && rr.re.test(url)){ return { cancel: true }; } }
    // check aho
    if(MATCHER.aho){ const m = MATCHER.aho.match(url); if(m && m.length) return { cancel: true }; }
    // fallback substring checks
    for(const p of MATCHER.simplePatterns){ if(url.indexOf(p)!==-1) return { cancel: true }; }
  }catch(e){ console.error('webRequestHandler error', e); }
  return {};
}

// attach handler
try{
  chrome.webRequest.onBeforeRequest.removeListener(webRequestHandler);
}catch(e){}
chrome.webRequest.onBeforeRequest.addListener(webRequestHandler, { urls: ["<all_urls>"] }, ["blocking"]);

// Allow loading rules via message
self.addEventListener('message', (ev)=>{
  console.log('background message', ev.data);
  try{
    if(ev.data && ev.data.type === 'applyFilters'){
      if(typeof importScripts === 'function'){ try{ importScripts('abp.js'); importScripts('aho.js'); }catch(e){} }
      try{
        if(typeof parse === 'function'){
          const rules = parse(Array.isArray(ev.data.filters)?ev.data.filters:[]);
          const ok = buildMatcherFromRules(rules);
          console.log('Matcher loaded', { ok, rules: (rules||[]).length });
        }
      }catch(e){ console.error('parse failed', e); }
    }
    if(ev.data && ev.data.type === 'clearFilters'){
      MATCHER = { aho: null, simplePatterns: [], regexRules: [], exceptions: [] };
      console.log('Matcher cleared');
    }
  }catch(e){}
});

// Listen for tab updates to detect YouTube
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (tab.url.includes('youtube.com') || tab.url.includes('youtu.be')) {
      // Show notification when YouTube is loaded
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png', // Add an icon if available
        title: 'AdBlockerX Active',
        message: 'YouTube detected! AdBlockerX is blocking ads.'
      });
    }
  }
});
