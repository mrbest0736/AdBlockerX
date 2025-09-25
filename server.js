/*
  Minimal Node.js proxy that demonstrates server-side enforcement of AdBlockX lists.
  - Applies BLACKLIST, SPOOF_LIST, WHITELIST from a local JSON file (lists.json)
  - Proxies requests and either blocks (204), spoofs (200 with fake body), or forwards
  - Management endpoints to GET/POST lists protected by API key via HTTP header X-API-KEY

  Usage:
    set X_API_KEY=yourkey; node server.js

  Note: This is a demo/harness. For production use, secure properly and harden.
*/

const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 4000;
const API_KEY = process.env.X_API_KEY || process.env.ADAPTER_API_KEY || '';
const LISTS_FILE = path.join(__dirname, 'lists.json');

function loadLists() {
  try {
    if (!fs.existsSync(LISTS_FILE)) return { BLACKLIST: [], SPOOF_LIST: [], WHITELIST: [], REGEX_RULES: [], ALWAYS_BLOCK: [] };
    return JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8') || '{}');
  } catch (e) { return { BLACKLIST: [], SPOOF_LIST: [], WHITELIST: [], REGEX_RULES: [], ALWAYS_BLOCK: [] }; }
}

function saveLists(obj) {
  try { fs.writeFileSync(LISTS_FILE, JSON.stringify(obj, null, 2), 'utf8'); return true; } catch (e) { return false; }
}

let LISTS = loadLists();

const SPOOF_JSON = JSON.stringify({ status: 'NO_ADS', message: 'Spoofed by AdBlockX Server' });

const app = express();
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(__dirname));

// simple API key middleware
function requireApiKey(req, res, next) {
  const k = req.header('x-api-key') || req.query.api_key || '';
  if (!API_KEY) return res.status(500).json({ error: 'Server missing API key (set X_API_KEY)' });
  if (!k || k !== API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  next();
}

// management endpoints
app.get('/lists', requireApiKey, (req, res) => {
  LISTS = loadLists();
  res.json(LISTS);
});
app.post('/lists', requireApiKey, (req, res) => {
  const body = req.body || {};
  LISTS.BLACKLIST = Array.isArray(body.BLACKLIST) ? body.BLACKLIST : (LISTS.BLACKLIST||[]);
  LISTS.SPOOF_LIST = Array.isArray(body.SPOOF_LIST) ? body.SPOOF_LIST : (LISTS.SPOOF_LIST||[]);
  LISTS.WHITELIST = Array.isArray(body.WHITELIST) ? body.WHITELIST : (LISTS.WHITELIST||[]);
  LISTS.REGEX_RULES = Array.isArray(body.REGEX_RULES) ? body.REGEX_RULES : (LISTS.REGEX_RULES||[]);
  LISTS.ALWAYS_BLOCK = Array.isArray(body.ALWAYS_BLOCK) ? body.ALWAYS_BLOCK : (LISTS.ALWAYS_BLOCK||[]);
  const ok = saveLists(LISTS);
  res.json({ ok, lists: LISTS });
});

// helper: simple substring match
function matchesList(url, list) {
  if (!url) return false;
  try {
    const s = String(url || '');
    for (const f of (list||[])) if (f && s.includes(f)) return true;
  } catch (e) {}
  return false;
}

function matchesRegex(url, regexList) {
  if (!url) return false;
  try {
    for (const r of (regexList||[])) {
      try { const re = new RegExp(r); if (re.test(url)) return true; } catch (e) {}
    }
  } catch (e) {}
  return false;
}

// Proxy endpoint: forwards requests (GET/POST) and applies enforcement
app.all('/proxy/*', async (req, res) => {
  try {
    const target = req.url.replace(/^\/proxy\//, '');
    if (!target) return res.status(400).send('No target');
    const url = decodeURIComponent(target);

    // Skip non-http(s)
    if (!/^https?:\/\//i.test(url)) return res.status(400).send('Only http/https supported');

    // Whitelist check
    if (matchesList(url, LISTS.WHITELIST)) {
      // forward
    } else {
      // Always-block like lists: if exactly matches blacklist then block
      if (matchesList(url, LISTS.BLACKLIST)) {
        console.log('[proxy] blocked', url);
        return res.status(204).end();
      }
      if (matchesList(url, LISTS.SPOOF_LIST)) {
        console.log('[proxy] spoofed', url);
        res.set('Content-Type', 'application/json');
        return res.status(200).send(SPOOF_JSON);
      }
    }

    // forward request
    const method = req.method || 'GET';
    const headers = Object.assign({}, req.headers || {});
    // remove host to avoid conflicts
    delete headers.host;

    const fetchOpts = { method, headers, redirect: 'follow' };
    if (method !== 'GET' && method !== 'HEAD') fetchOpts.body = req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : undefined;

    const remote = await fetch(url, fetchOpts);
    // copy status and headers
    res.status(remote.status);
    remote.headers.forEach((v,k) => { try { res.set(k, v); } catch(e){} });
    const buf = await remote.buffer();
    res.send(buf);
  } catch (e) {
    console.error('[proxy] error', e);
    res.status(502).json({ error: 'proxy_error', detail: String(e) });
  }
});

// Serve the control UI as a website with server-side theme-color injection for
// Chromium-based clients to avoid client-side UA sniffing in the HTML.
// Capability endpoint: client can POST detected capabilities so server can set a cookie
app.post('/api/capabilities', (req, res) => {
  try {
    const body = req.body || {};
    const themeSupport = !!body.themeSupport; // boolean
    const value = themeSupport ? 'chromium' : 'other';
    // set cookie for 30 days; HttpOnly not set so client JS can read if needed
    res.setHeader('Set-Cookie', `abx_theme=${value}; Path=/; Max-Age=${60*60*24*30}; SameSite=Lax`);
    return res.json({ ok: true, value });
  } catch (e) { console.error('/api/capabilities error', e); return res.status(500).json({ ok: false }); }
});

// Serve the control UI as a website. Prefer cookie-based capability marker when present.
app.get('/', (req, res) => {
  try {
    let html = fs.readFileSync(path.join(__dirname, 'AdBlockerX.html'), 'utf8');
    const cookieHeader = req.get('Cookie') || '';
    const m = cookieHeader.match(/(?:^|;\s*)abx_theme=([^;]+)/);
    const themeCookie = m && m[1];
    if (themeCookie === 'chromium') {
      if (!/meta[^>]+name=["']theme-color["']/i.test(html)) {
        html = html.replace(/<head>/i, `<head>\n  <meta name="theme-color" content="#ff0000">`);
      }
    } else if (themeCookie === 'other') {
      if (!/meta[^>]+name=["']msapplication-TileColor["']/i.test(html)) {
        html = html.replace(/<head>/i, `<head>\n  <meta name="msapplication-TileColor" content="#ff0000">`);
      }
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (e) {
    console.error('Failed to serve HTML with injection', e);
    return res.status(500).send('Server error');
  }
});

// health endpoint for CI / readiness checks
app.get('/health', (req, res) => {
  try {
    return res.json({ status: 'ok', port: PORT, uptime_seconds: process.uptime() });
  } catch (e) {
    return res.status(500).json({ status: 'error', error: String(e) });
  }
});

// API endpoints for the web UI (similar to IPC handlers)
app.get('/api/config', (req, res) => {
  res.json({ autoInject: false, config: {} }); // placeholder
});

app.get('/api/stats', (req, res) => {
  res.json({ blockedRequests: 0 }); // placeholder
});

app.get('/api/logs', (req, res) => {
  res.json([]); // placeholder
});

app.listen(PORT, () => console.log(`AdBlockX proxy listening on port ${PORT}`));
