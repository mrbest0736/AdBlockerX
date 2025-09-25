const fetch = require('node-fetch');
const assert = require('assert');

const PROXY = process.env.PROXY || 'http://localhost:4000';
const API_KEY = process.env.X_API_KEY || 'change-me';

async function run() {
  console.log('Running proxy smoke tests against', PROXY);
  // load lists
  const listsRes = await fetch(PROXY + '/lists', { headers: { 'x-api-key': API_KEY } });
  if (!listsRes.ok) { console.error('Failed to fetch lists', await listsRes.text()); process.exit(2); }
  const lists = await listsRes.json(); console.log('Lists loaded:', Object.keys(lists));

  // test blocked URL (one from default list)
  const blockedUrl = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
  const enc = encodeURIComponent(blockedUrl);
  const r1 = await fetch(PROXY + '/proxy/' + enc);
  console.log('blocked status', r1.status);
  assert(r1.status === 204, 'expected 204 for blocked URL');

  // test spoofed URL
  const spoofUrl = 'https://doubleclick.net/some/api/stats/ads';
  const r2 = await fetch(PROXY + '/proxy/' + encodeURIComponent(spoofUrl));
  console.log('spoof status', r2.status);
  assert(r2.status === 200, 'expected 200 for spoofed URL');
  const txt = await r2.text();
  assert(txt.indexOf('NO_ADS') >= 0, 'expected spoof body');

  // test forward (example.com)
  const fwd = await fetch(PROXY + '/proxy/' + encodeURIComponent('https://example.com/'));
  console.log('forward status', fwd.status);
  assert(fwd.status === 200, 'expected 200 for forward');

  console.log('All smoke tests passed');
}

run().catch(e=>{ console.error('Test failed', e); process.exit(2); });
