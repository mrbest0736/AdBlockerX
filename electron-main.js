const { app, BrowserWindow, ipcMain } = require('electron');
console.log('script start');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Aho } = require('./lib/aho');
const { parse: parseABP } = require('./lib/abp');

let contentWindow;
let controlWindow;
let serverProc = null;
let agentProc = null;
let AUTO_INJECT = true; // default on
let CONFIG = {};
let CONFIG_PATH = null; // will be set when app is ready
// Simple in-memory filter store and stats
let NETWORK_BLOCKING_ENABLED = false;
let FILTERS = []; // array of {raw: string, type: 'simple'|'regex', pattern: string}
let STATS = { blockedRequests: 0 };
let _aho = null;
let ABP_RULES = { blocks: [], exceptions: [], cosmetics: [] };
let SUBSCRIPTIONS = []; // array of {url, lastUpdated}
let LOGS = [];

function compileFilters(filters){
  // parse ABP style rules and flatten into FILTERS and cosmetics
  const parsed = parseABP(filters || []);
  ABP_RULES = { blocks: parsed.filter(p=>p.type==='block'), exceptions: parsed.filter(p=>p.type==='exception'), cosmetics: parsed.filter(p=>p.type==='cosmetic') };
  // cosmetics -> forward selectors to content preload
  try{ const selectors = ABP_RULES.cosmetics.map(c=>c.selector).filter(Boolean); if(contentWindow && !contentWindow.isDestroyed()) contentWindow.webContents.send('abx-cosmetic-filters', selectors); }catch(e){}
  // convert parsed blocks to FILTERS: regex blocks keep regex, simple blocks become simple patterns
  FILTERS = ABP_RULES.blocks.map(b=>{
    if(b.isRegex) return { raw: b.raw, type: 'regex', pattern: b.re };
    return { raw: b.raw, type: 'simple', pattern: b.pattern };
  }).filter(Boolean);
  // build aho for simple patterns
  try{
    _aho = new Aho();
    let id = 0;
    for(const f of FILTERS){ if(f.type === 'simple'){ _aho.add(f.pattern, id++); } }
    _aho.build();
    // also load rules into worker if present
    try{ if(matcherWorker){ matcherWorker.postMessage({ type: 'loadRules', rules: ABP_RULES }); } }catch(e){}
  }catch(e){ _aho = null; }
}

// Spawn the matcher worker (worker_threads) — offloads heavy substring/regex matching
const { Worker } = require('worker_threads');
let matcherWorker = null;
let matcherBusy = false;
let matcherNextId = 1;
const matcherPending = new Map();
const matcherCache = new Map(); // simple LRU-like cache could be added; for now simple Map
function startMatcherWorker(){
  try{
    if(matcherWorker) return;
    matcherWorker = new Worker(path.join(__dirname, 'lib', 'matcher-worker.js'));
    matcherWorker.on('message', (m)=>{
      try{
        if(!m || !m.type) return;
        if(m.type === 'loaded'){
          // loaded rules
        } else if(m.type === 'matchResult'){
          const id = m.id; const p = matcherPending.get(id);
          if(p){ try{ p.resolve(m.result); }catch(e){} matcherPending.delete(id); }
        }
      }catch(e){}
    });
    matcherWorker.on('error', (e)=>{ console.warn('matcherWorker error', e); matcherWorker = null; });
    matcherWorker.on('exit', (c)=>{ matcherWorker = null; });
    // if we already have filters loaded, send them
    try{ if(ABP_RULES && matcherWorker) matcherWorker.postMessage({ type: 'loadRules', rules: ABP_RULES }); }catch(e){}
  }catch(e){ console.warn('startMatcherWorker failed', e); matcherWorker = null; }
}

function matchWithWorker(url, rtype, hostname, timeout = 50){
  // quick cache key
  try{
    const key = `${rtype}::${hostname}::${url}`;
    if(matcherCache.has(key)) return Promise.resolve(matcherCache.get(key));
    if(!matcherWorker) return Promise.resolve(null);
    const id = matcherNextId++;
    return new Promise((resolve)=>{
      matcherPending.set(id, { resolve });
      try{ matcherWorker.postMessage({ type: 'match', id, payload: { url, rtype, hostname } }); }catch(e){ matcherPending.delete(id); resolve(null); }
      // timeout fallback
      setTimeout(()=>{ if(matcherPending.has(id)){ matcherPending.delete(id); resolve(null); } }, timeout);
    }).then(res=>{ try{ if(res && res.matched) matcherCache.set(key, res); }catch(e){} return res; });
  }catch(e){ return Promise.resolve(null); }
}

function matchUrlAgainstFilters(url){
  try{
    // naive: handled at higher level with ABP_RULES; leave for legacy FILTERS
    for(const f of FILTERS){ if(f.type === 'regex' && f.pattern.test(url)) return f; }
    // then use aho for substring matches if available
    if(_aho){ const matches = _aho.match(url); if(matches && matches.length){ const idx = matches[0]; // map to FILTERS simple by index
        // find corresponding simple filter by index order
        let si = -1; let count=0; for(let i=0;i<FILTERS.length;i++){ if(FILTERS[i].type==='simple'){ if(count===idx){ si=i; break; } count++; } }
        if(si>=0) return FILTERS[si];
      } }
    // fallback (shouldn't be necessary)
    for(const f of FILTERS){ if(f.type==='simple' && url.indexOf(f.pattern)!==-1) return f; }
  }catch(e){}
  return null;
}

function domainMatches(domainRules, hostname){
  try{
    if(!domainRules) return true; // no domain restriction means match
    hostname = (hostname||'').toLowerCase();
    let allow = false;
    for(const d of domainRules){
      const name = (d.name||'').toLowerCase();
      if(d.neg){ if(hostname.endsWith(name)) return false; } else { if(hostname.endsWith(name)) allow = true; }
    }
    return allow;
  }catch(e){ return false; }
}

function resourceTypeMatches(ruleOpt, rtype){
  try{
    if(!ruleOpt || !ruleOpt.resourceTypes || !ruleOpt.resourceTypes.length) return true;
    // simple check: if any resourceType string equals rtype or matches known tokens
    return ruleOpt.resourceTypes.some(t=> t === rtype || t === '*' );
  }catch(e){ return true; }
}

// Simple subscription handlers (no network fetch yet)
ipcMain.handle('abx-subscriptions-list', async ()=>{ try{ return SUBSCRIPTIONS.slice(); }catch(e){ return []; } });
ipcMain.handle('abx-subscriptions-add', async (event, sub) => { try{ const item = Object.assign({url:sub||'', lastUpdated:0, state: 'idle', backoff: 0}); SUBSCRIPTIONS.push(item); // kick off immediate fetch
  fetchSubscription(item).catch(()=>{}); saveConfig(); return true; }catch(e){ return false; } });
ipcMain.handle('abx-subscriptions-remove', async (event, url) => { try{ SUBSCRIPTIONS = SUBSCRIPTIONS.filter(s=>s.url!==url); saveConfig(); return true; }catch(e){ return false; } });
ipcMain.handle('abx-subscriptions-update-now', async (event) => { try{ await Promise.all((SUBSCRIPTIONS||[]).map(s=>fetchSubscription(s).catch(()=>{}))); return true; }catch(e){ return false; } });

ipcMain.handle('abx-logs-get', async (event, limit) =>{ try{ const l = typeof limit === 'number' && limit>0 ? Math.min(limit, 5000) : 500; return LOGS.slice(-l).reverse(); }catch(e){ return []; } });
// server-side paginated log query: { limit, offset, q, type }
ipcMain.handle('abx-logs-query', async (event, opts) => {
  try{
    opts = opts || {};
    const limit = Math.max(1, Math.min(typeof opts.limit === 'number' ? opts.limit : (parseInt(opts.limit) || 100), 5000));
    const offset = Math.max(0, parseInt(opts.offset) || 0);
    const q = opts.q ? String(opts.q).toLowerCase() : '';
    const type = opts.type || 'all';
    // iterate logs from newest to oldest and apply filtering
    const filtered = [];
    for(let i = LOGS.length - 1; i >= 0; --i){
      const item = LOGS[i];
      try{
        if(type && type !== 'all' && item.type !== type) continue;
        if(q){
          const s = q;
          const url = (item.url||'').toLowerCase();
          const rule = (item.rule||'').toLowerCase();
          const typ = (item.type||'').toLowerCase();
          if(!(url.includes(s) || rule.includes(s) || typ.includes(s))) continue;
        }
        filtered.push(item);
      }catch(e){ continue; }
    }
    const total = filtered.length;
    const entries = filtered.slice(offset, offset + limit);
    return { total, entries };
  }catch(e){ return { total: 0, entries: [] }; }
});
function addLog(entry){ try{ LOGS.push(Object.assign({ t: new Date().toISOString() }, entry)); if(LOGS.length>5000) LOGS.shift(); }catch(e){} }

ipcMain.handle('abx-filters-export', async ()=>{ try{ return CONFIG.filters || []; }catch(e){ return []; } });
ipcMain.handle('abx-filters-import', async (event, filters)=>{ try{ CONFIG.filters = Array.isArray(filters) ? filters.slice() : []; compileFilters(CONFIG.filters); saveConfig(); return true; }catch(e){ return false; } });

// light-weight inspector summary for UI
ipcMain.handle('abx-inspector-summary', async ()=>{ try{ return { stats: STATS, recentBlocked: LOGS.slice(-100).reverse() }; }catch(e){ return {}; } });

ipcMain.handle('abx-log-get', async (event, id) => { try{ return LOGS.find(l=>l.id === id) || null; }catch(e){ return null; } });

function saveConfig() {
  try {
    if (!CONFIG_PATH) return;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(CONFIG, null, 2), 'utf8');
  } catch (e) { console.warn('saveConfig failed', e); }
}
function loadConfig() {
  try {
    if (!CONFIG_PATH) return;
    if (fs.existsSync(CONFIG_PATH)) {
      const s = fs.readFileSync(CONFIG_PATH, 'utf8');
      CONFIG = JSON.parse(s || '{}') || {};
      if (typeof CONFIG.autoInject !== 'undefined') AUTO_INJECT = !!CONFIG.autoInject;
      if (typeof CONFIG.networkBlocking !== 'undefined') NETWORK_BLOCKING_ENABLED = !!CONFIG.networkBlocking;
      if (Array.isArray(CONFIG.filters)) compileFilters(CONFIG.filters);
    }
  } catch (e) { console.warn('loadConfig failed', e); }
}

function createWindow() {
  console.log('creating windows');
  // Content window: used to browse pages (e.g., YouTube). Start on about:blank to avoid forcing a site.
  contentWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      // use a minimal preload for the content window to avoid exposing control APIs to remote pages
      preload: path.join(__dirname, 'electron-preload-content.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Control popup window: small UI that will appear when YouTube is detected.
  controlWindow = new BrowserWindow({
    // Make the control UI a normal, full/resizable window instead of a small popup.
    width: 1000,
    height: 800,
    show: true, // temporarily show to debug
    resizable: true,
    center: true,
    alwaysOnTop: false,
    fullscreenable: true,
    webPreferences: {
      // control window gets the richer preload exposing bridge APIs
      preload: path.join(__dirname, 'electron-preload-control.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load the UI into the control window (our demo UI)
  controlWindow.loadFile('AdBlockerX.html');
  controlWindow.webContents.on('did-finish-load', () => {
    try { controlWindow.webContents.send('abx-initial-config', { autoInject: AUTO_INJECT, config: CONFIG }); } catch(e) {}
  });

  // Load a neutral start page into the content window. Users can navigate to pages.
  contentWindow.loadURL('about:blank');

  // install or update webRequest filter when session becomes available
  try{
    const sess = contentWindow.webContents.session;
    // handler reference so we can remove it later if needed
    let beforeHandler = null;
    function installHandler(){
      try{
        if(beforeHandler) sess.webRequest.onBeforeRequest(null, beforeHandler);
        if(!NETWORK_BLOCKING_ENABLED) return;
        startMatcherWorker();
        beforeHandler = (details, callback) => {
          const url = details.url || '';
          const rtype = details.resourceType || '';
          let hostname = '';
          try{ hostname = new URL(url).hostname || ''; }catch(e){}
          // Try worker first with a short timeout; if no response, fall back to inline matching
          const startTs = Date.now();
          matchWithWorker(url, rtype, hostname, 40).then(res=>{
            try{
                if(res && res.matched){
                  STATS.blockedRequests++;
                  const id = 'log_' + Math.random().toString(36).slice(2,9);
                  const matchedRuleText = res.rule || res.ruleText || (res.ruleObj && res.ruleObj.raw) || '';
                  const entry = { id, t: new Date().toISOString(), type:'blocked', url, rule: matchedRuleText, ruleId: res.ruleId || null, ruleObj: res.ruleObj || null, resourceType: rtype, matchedBy: 'worker', matchedByDetails: res, durationMs: Date.now() - startTs };
                  try{ controlWindow && controlWindow.webContents && controlWindow.webContents.send('abx-blocked', { url, rule: matchedRuleText, resourceType: rtype, id }); }catch(e){}
                  try{ addLog(entry); }catch(e){}
                  return callback({ cancel: true });
                }
            }catch(e){}
            // if worker returned exception explicitly, allow
            if(res && res.exception){ return callback({}); }
            // fallback to inline matching using ABP_RULES in case worker is unavailable or timed out
            try{
              // check exceptions first
              for(const ex of ABP_RULES.exceptions){
                if(ex.isRegex){ if(ex.re && ex.re.test(url) && domainMatches(ex.options && ex.options.domains, hostname) && resourceTypeMatches(ex.options, rtype)) return callback({}); }
                else { if(ex.pattern && url.indexOf(ex.pattern)!==-1 && domainMatches(ex.options && ex.options.domains, hostname) && resourceTypeMatches(ex.options, rtype)) return callback({}); }
              }
              // then check blocks
              for(const b of ABP_RULES.blocks){
                const match = b.isRegex ? (b.re && b.re.test(url)) : (b.pattern && url.indexOf(b.pattern)!==-1);
                if(match && domainMatches(b.options && b.options.domains, hostname) && resourceTypeMatches(b.options, rtype)){
                  STATS.blockedRequests++;
                  const id = 'log_' + Math.random().toString(36).slice(2,9);
                  const entry = { id, t: new Date().toISOString(), type:'blocked', url, rule: b.raw, ruleObj: b, resourceType: rtype, matchedBy: 'inline', durationMs: Date.now() - startTs };
                  try{ controlWindow && controlWindow.webContents && controlWindow.webContents.send('abx-blocked', { url, rule: b.raw, resourceType: rtype, id }); }catch(e){}
                  try{ addLog(entry); }catch(e){}
                  return callback({ cancel: true });
                }
              }
            }catch(e){}
            return callback({});
          }).catch(()=>{
            // on error, do fallback inline check
            try{
              for(const ex of ABP_RULES.exceptions){
                if(ex.isRegex){ if(ex.re && ex.re.test(url) && domainMatches(ex.options && ex.options.domains, hostname) && resourceTypeMatches(ex.options, rtype)) return callback({}); }
                else { if(ex.pattern && url.indexOf(ex.pattern)!==-1 && domainMatches(ex.options && ex.options.domains, hostname) && resourceTypeMatches(ex.options, rtype)) return callback({}); }
              }
              for(const b of ABP_RULES.blocks){
                const match = b.isRegex ? (b.re && b.re.test(url)) : (b.pattern && url.indexOf(b.pattern)!==-1);
                if(match && domainMatches(b.options && b.options.domains, hostname) && resourceTypeMatches(b.options, rtype)){
                  STATS.blockedRequests++;
                  try{ controlWindow && controlWindow.webContents && controlWindow.webContents.send('abx-blocked', { url, rule: b.raw, resourceType: rtype }); }catch(e){}
                  try{ addLog({ type:'blocked', url, rule: b.raw, resourceType: rtype }); }catch(e){}
                  return callback({ cancel: true });
                }
              }
            }catch(e){}
            return callback({});
          });
        };
        sess.webRequest.onBeforeRequest(beforeHandler);
      }catch(e){ console.warn('installHandler failed', e); }
    }
    installHandler();
    // expose for toggles via ipc handlers below using NETWORK_BLOCKING_ENABLED change
  }catch(e){ console.warn('session wiring failed', e); }

  // Listen for navigation in the content window and show/hide the control popup when YouTube is opened
  const checkForYouTube = (url) => {
    try {
      if (!url) return;
      const u = new URL(url, 'http://example');
      const host = (u.hostname || '').toLowerCase();
      if (host.includes('youtube.com') || host.includes('youtu.be')) {
        // Show and focus the (now full) control window when YouTube is opened.
        try {
          if (!controlWindow.isVisible()) {
            // restore if minimized, then show and focus
            if (controlWindow.isMinimized && controlWindow.isMinimized()) controlWindow.restore();
            controlWindow.show();
          }
          controlWindow.focus();
        } catch (e) { /* ignore focus/show errors */ }
        // Auto-inject runtime into the content preload for robustness if enabled
        try {
          if (AUTO_INJECT) {
            const file = path.join(__dirname, 'AdBlockerX.js');
            if (fs.existsSync(file)) {
              const code = fs.readFileSync(file, 'utf8');
              // send code to content preload to evaluate inside page context
              contentWindow.webContents.send('abx-inject-runtime', code);
            }
          }
        } catch (e) { console.warn('auto-inject failed', e); }
      } else {
        // Removed: hide control window when not on YouTube
        // if (controlWindow.isVisible()) controlWindow.hide();
      }
    } catch (e) { }
  };

  contentWindow.webContents.on('did-navigate', (event, url) => { checkForYouTube(url); });
  contentWindow.webContents.on('did-navigate-in-page', (event, url) => { checkForYouTube(url); });
  contentWindow.webContents.on('will-redirect', (event, url) => { checkForYouTube(url); });

  // Check for external YouTube app/browser tabs
  const checkExternalYouTube = async () => {
    try {
      const puppeteer = require('puppeteer');
      const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
      const pages = await browser.pages();
      const hasYouTube = pages.some(page => {
        const url = page.url();
        return url.includes('youtube.com') || url.includes('youtu.be');
      });
      console.log('Puppeteer connected, YouTube detected:', hasYouTube);
      if (hasYouTube) {
        // YouTube detected in browser
        if (!controlWindow.isVisible()) {
          if (controlWindow.isMinimized && controlWindow.isMinimized()) controlWindow.restore();
          controlWindow.show();
        }
        controlWindow.focus();
      }
      await browser.disconnect();
    } catch (e) {
      // Puppeteer not connected or error, skip
      console.log('Puppeteer not connected');
    }
  };

  // Check every 1 second for external YouTube
  setInterval(checkExternalYouTube, 1000);
}

function startServer() {
  if (serverProc) return;
  console.log('Starting server.js');
  serverProc = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: process.env, stdio: 'inherit' });
}

function startAgent() {
  if (agentProc) return;
  console.log('Starting node_agent.js');
  agentProc = spawn(process.execPath, [path.join(__dirname, 'node_agent.js')], { env: process.env, stdio: 'inherit' });
}

// Subscription fetching with atomic replace and exponential backoff
async function fetchSubscription(sub){
  if(!sub || !sub.url) return;
  try{
    sub.state = 'fetching'; saveConfig();
    const url = sub.url;
    const data = await new Promise((res, rej)=>{
      const lib = url.startsWith('https') ? require('https') : require('http');
      lib.get(url, (r)=>{
        let buf = ''; r.on('data', c=>buf+=c); r.on('end', ()=>res(buf)); r.on('error', rej);
      }).on('error', rej);
    });
    const lines = String(data||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    // atomic replace: merge into a newFilters set to dedupe
    const existing = new Set(CONFIG.filters || []);
    for(const ln of lines) existing.add(ln);
    CONFIG.filters = Array.from(existing);
    compileFilters(CONFIG.filters);
    sub.lastUpdated = Date.now(); sub.state = 'ok'; sub.backoff = 0; saveConfig();
  }catch(e){
    sub.state = 'error'; sub.backoff = Math.min((sub.backoff||1)*2 || 2, 3600); saveConfig();
    console.warn('fetchSubscription error for', sub.url, e);
    throw e;
  }
}

async function fetchSubscriptions(){
  try{
    for(const s of SUBSCRIPTIONS){ try{ await fetchSubscription(s).catch(()=>{}); }catch(e){} }
  }catch(e){}
}

// schedule periodic fetch every 6 hours
setInterval(()=>{ try{ fetchSubscriptions(); }catch(e){} }, 1000 * 60 * 60 * 6);

function stopChild(p) {
  if (!p) return;
  try { p.kill(); } catch (e) { console.warn('kill failed', e); }
}

app.whenReady().then(() => {
  // prepare config path in userData and load persisted config
  try { CONFIG_PATH = path.join(app.getPath('userData'), 'adblockx-config.json'); } catch(e) { CONFIG_PATH = path.join(__dirname, 'adblockx-config.json'); }
  loadConfig();

  // parse simple CLI overrides (e.g. --auto-inject=true or --auto-inject=false)
  try{
    for(const a of process.argv.slice(1)){
      if(typeof a === 'string' && a.startsWith('--auto-inject=')){
        const v = a.split('=')[1];
        if(v === 'true' || v === 'false'){
          AUTO_INJECT = (v === 'true');
          CONFIG.autoInject = AUTO_INJECT;
          // persist override immediately
          try{ saveConfig(); }catch(e){}
        }
      }
    }
  }catch(e){}

  createWindow();
  startServer();
  startAgent();

  app.on('activate', function () {
    // focus existing windows if present
    if (contentWindow && !contentWindow.isDestroyed()) return contentWindow.show();
    createWindow();
  });
});

app.on('before-quit', () => {
  stopChild(serverProc);
  stopChild(agentProc);
  try { if (controlWindow && !controlWindow.isDestroyed()) controlWindow.close(); } catch(e) {}
  try { if (contentWindow && !contentWindow.isDestroyed()) contentWindow.close(); } catch(e) {}
});

ipcMain.handle('start-services', () => { startServer(); startAgent(); return true; });
ipcMain.handle('stop-services', () => { stopChild(serverProc); stopChild(agentProc); serverProc = agentProc = null; return true; });
ipcMain.handle('navigate-content', async (event, url) => {
  try {
    if (contentWindow && !contentWindow.isDestroyed()) {
      await contentWindow.loadURL(url);
      return true;
    }
  } catch (e) { return false; }
  return false;
});
ipcMain.handle('get-content-url', () => {
  try { return (contentWindow && !contentWindow.isDestroyed()) ? contentWindow.webContents.getURL() : null; } catch(e) { return null; }
});

// Propagate settings from the control window into the content window's page context.
ipcMain.handle('propagate-settings', async (event, settings) => {
  // settings: { '<localStorage.key>': <serializable value>, ... }
  if (!contentWindow || contentWindow.isDestroyed()) return false;
  try {
    // send settings to the content preload which will write them into page localStorage
    contentWindow.webContents.send('abx-settings-update', settings || {});
    return true;
  } catch (e) {
    console.warn('propagate-settings failed', e);
    return false;
  }
});

// Network control handlers
ipcMain.handle('abx-toggle-network-blocking', async (event, flag) => {
  try{ NETWORK_BLOCKING_ENABLED = !!flag; CONFIG.networkBlocking = NETWORK_BLOCKING_ENABLED; saveConfig(); return true; }catch(e){ return false; }
});

ipcMain.handle('abx-set-filters', async (event, filters) => {
  try{ compileFilters(filters || []); CONFIG.filters = filters || []; saveConfig(); return true; }catch(e){ return false; }
});

ipcMain.handle('abx-get-stats', async () => { try{ return STATS || {}; }catch(e){ return {}; } });

// Inject the AdBlockerX runtime into the content window by reading the local file and executing it in page context.
ipcMain.handle('inject-runtime', async () => {
  if (!contentWindow || contentWindow.isDestroyed()) return false;
  try {
    const file = path.join(__dirname, 'AdBlockerX.js');
    if (!fs.existsSync(file)) {
      console.warn('AdBlockerX.js not found for injection');
      return false;
    }
    const code = fs.readFileSync(file, 'utf8');
    // execute the runtime inside the page
    await contentWindow.webContents.executeJavaScript(code, true);
    // optionally notify the page that runtime was injected
    await contentWindow.webContents.executeJavaScript("try{window.dispatchEvent(new CustomEvent('AdBlockX:event',{detail:{type:'runtime-injected'}}));}catch(e){}");
    return true;
  } catch (e) {
    console.warn('inject-runtime failed', e);
    return false;
  }
});

ipcMain.handle('set-auto-inject', async (event, flag) => {
  try { AUTO_INJECT = !!flag; CONFIG.autoInject = !!flag; saveConfig(); return true; } catch(e){ return false; }
});

// send current config to control window when it is ready
ipcMain.handle('request-config', async () => {
  try { return CONFIG || {}; } catch(e) { return {}; }
});

// Licensing proxy helpers - calls local licensing server
const axios = require('axios').default || require('axios');
const LIC_BASE = process.env.LICENSING_URL || 'http://127.0.0.1:5001';
ipcMain.handle('licensing-checkout', async (event, provider) => {
  try{ const r = await axios.get(`${LIC_BASE}/checkout/${provider}`); return r.data; }catch(e){ return { ok:false }; }
});
ipcMain.handle('licensing-restore', async (event, proof) => {
  try{ const r = await axios.post(`${LIC_BASE}/entitlement/restore`, { proof }); return r.data; }catch(e){ return { ok:false }; }
});
ipcMain.handle('licensing-entitlement', async (event, userId) => {
  try{ const r = await axios.get(`${LIC_BASE}/entitlement/${encodeURIComponent(userId)}`); return r.data; }catch(e){ return { ok:false }; }
});

// client asks main to check entitlement and cache token; main will emit 'abx-entitlement' events to control UI
const ENT_CACHE = new Map();
ipcMain.handle('licensing-check-and-cache', async (event, userId) => {
  try{
    const r = await axios.get(`${LIC_BASE}/entitlement/${encodeURIComponent(userId)}`);
    if(r && r.data){ const d = r.data; ENT_CACHE.set(userId, { token: d.token, expiresAt: Date.now() + 1000*60*60 });
      try{ controlWindow && controlWindow.webContents && controlWindow.webContents.send('abx-entitlement', d); }catch(e){}
      return d;
    }
    return { ok:false };
  }catch(e){ return { ok:false }; }
});

ipcMain.handle('licensing-get-cached', async (event, userId) => { try{ const v = ENT_CACHE.get(userId) || null; return v; }catch(e){ return null; } });

// App ready
app.on('ready', () => {
  console.log('app ready');
  try {
    createWindow();
  } catch (e) {
    console.log('createWindow error', e);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
