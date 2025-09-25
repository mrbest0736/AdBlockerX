/*
  Minimal Puppeteer E2E test for AdBlockerX demo.
  - Serves current directory with `serve` on port 5000
  - Opens `http://127.0.0.1:5000/demo.html`
  - Waits for AdBlockX:event logs and asserts that detection/neutralize events occur when controls are used

  This is a lightweight smoke test for CI; for robust tests, expand selectors/timeouts and assertions.
*/

const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const http = require('http');

const STATIC_PORT = process.env.E2E_STATIC_PORT || 5000;
const DEMO_URL = `http://127.0.0.1:${STATIC_PORT}/demo.html`;

function startStaticServer() {
  // Use the npm 'serve' package binary via npx if available
  return spawn('npx', ['serve', '-s', '.', '-l', String(STATIC_PORT)], { stdio: 'inherit' });
}

(async () => {
  console.log('Starting static server...');
  const serverProc = startStaticServer();

  // wait a moment for server to be up
  await new Promise(r => setTimeout(r, 800));

  console.log('Launching browser...');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);

  let events = [];
  // Listen for console messages that contain AdBlockX events (demo logs them)
  page.on('console', msg => {
    try {
      const text = msg.text();
      if (text && text.includes('AdBlockX:event')) {
        events.push(text);
        console.log('[e2e] event:', text);
      }
    } catch (e) {}
  });

  console.log('Navigating to demo:', DEMO_URL);
  await page.goto(DEMO_URL, { waitUntil: 'networkidle2' });

  // Interact with demo controls: insert bait and trigger inline anti-adblock simulation
  try {
    // click 'Insert bait' button
    const insertBtn = await page.$('button[data-action="insert-bait"]');
    if (insertBtn) { await insertBtn.click(); console.log('[e2e] clicked insert-bait'); }

    // click 'Simulate inline anti-adblock' button
    const inlineBtn = await page.$('button[data-action="simulate-inline-ab"]');
    if (inlineBtn) { await inlineBtn.click(); console.log('[e2e] clicked simulate-inline-ab'); }

    // Wait for AdBlockX events to appear in the page log area
    await page.waitForFunction(() => {
      const log = document.querySelector('#event-log');
      if (!log) return false;
      return Array.from(log.querySelectorAll('.log-entry')).some(e => /detect|neutralize|monitor/i.test(e.textContent || ''));
    }, { timeout: 8000 });

    console.log('[e2e] detected AdBlockX event in UI log');
  } catch (e) {
    console.error('[e2e] error during interaction', e);
    await browser.close();
    serverProc.kill();
    process.exit(2);
  }

  await browser.close();
  serverProc.kill();
  console.log('[e2e] completed successfully');
  process.exit(0);
})();
