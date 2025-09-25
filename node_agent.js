/*
  Standalone Node enforcement agent for AdBlockerX.
  - Periodically syncs lists from an upstream URL (if configured via NODE_AGENT_UPSTREAM_URL)
  - Exposes /health and /status
  - Exposes same /proxy/* enforcement API and management endpoints (GET/POST /lists) protected by X-API-KEY

  Usage:
    set X_API_KEY=yourkey; set NODE_AGENT_UPSTREAM_URL=https://example.com/lists.json; node node_agent.js

  Note: This is a demo agent. For production, add TLS, auth, isolation, and error handling.
*/

const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 4100;
const API_KEY = process.env.X_API_KEY || '';
const LISTS_FILE = path.join(__dirname, 'lists.json');
const UPSTREAM = process.env.NODE_AGENT_UPSTREAM_URL || null;
const SYNC_INTERVAL = parseInt(process.env.NODE_AGENT_SYNC_SECONDS || '300', 10); // default 5 minutes

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

const SPOOF_JSON = JSON.stringify({ status: 'NO_ADS', message: 'Spoofed by AdBlockX Node Agent' });

const app = express();
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '1mb' }));

function requireApiKey(req, res, next) {
  const k = req.header('x-api-key') || req.query.api_key || '';
  if (!API_KEY) return res.status(500).json({ error: 'Server missing API key (set X_API_KEY)' });
  if (!k || k !== API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  next();
}

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

// Proxy
app.all('/proxy/*', async (req, res) => {
  try {
    const target = req.url.replace(/^\/proxy\//, '');
    if (!target) return res.status(400).send('No target');
    const url = decodeURIComponent(target);

    if (!/^https?:\/\//i.test(url)) return res.status(400).send('Only http/https supported');

    if (matchesList(url, LISTS.WHITELIST)) {
      // forward
    } else {
      if (matchesList(url, LISTS.BLACKLIST)) {
        console.log('[agent-proxy] blocked', url);
        return res.status(204).end();
      }
      if (matchesList(url, LISTS.SPOOF_LIST)) {
        console.log('[agent-proxy] spoofed', url);
        res.set('Content-Type', 'application/json');
        return res.status(200).send(SPOOF_JSON);
      }
    }

    const method = req.method || 'GET';
    const headers = Object.assign({}, req.headers || {});
    delete headers.host;

    const fetchOpts = { method, headers, redirect: 'follow' };
    if (method !== 'GET' && method !== 'HEAD') fetchOpts.body = req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : undefined;

    const remote = await fetch(url, fetchOpts);
    res.status(remote.status);
    remote.headers.forEach((v,k) => { try { res.set(k, v); } catch(e){} });
    const buf = await remote.buffer();
    res.send(buf);
  } catch (e) {
    console.error('[agent-proxy] error', e);
    res.status(502).json({ error: 'proxy_error', detail: String(e) });
  }
});

app.get('/status', (req, res) => {
  const stats = {
    uptime_seconds: process.uptime(),
    lists_loaded: {
      blacklist: (LISTS.BLACKLIST||[]).length,
      spoof: (LISTS.SPOOF_LIST||[]).length,
      whitelist: (LISTS.WHITELIST||[]).length
    },
    upstream: UPSTREAM || null,
    last_sync_seconds_ago: nodeAgentState.lastSync ? Math.floor((Date.now() - nodeAgentState.lastSync)/1000) : null
  };
  res.json(stats);
});

app.get('/health', (req, res) => res.json({ status: 'ok', port: PORT }));

const nodeAgentState = { lastSync: null };

async function syncFromUpstream() {
  if (!UPSTREAM) return;
  try {
    console.log('[agent] syncing lists from', UPSTREAM);
    const r = await fetch(UPSTREAM, { redirect: 'follow' });
    if (!r.ok) { console.warn('[agent] upstream returned', r.status); return; }
    const data = await r.json();
    if (data && typeof data === 'object') {
      LISTS = Object.assign({}, LISTS, data);
      saveLists(LISTS);
      nodeAgentState.lastSync = Date.now();
      console.log('[agent] lists updated from upstream');
    }
  } catch (e) { console.error('[agent] sync error', e); }
}

// initial sync
syncFromUpstream();
if (UPSTREAM && SYNC_INTERVAL > 5) setInterval(syncFromUpstream, SYNC_INTERVAL * 1000);

app.listen(PORT, () => console.log(`AdBlockX node agent listening on port ${PORT} (upstream=${UPSTREAM || 'none'})`));
