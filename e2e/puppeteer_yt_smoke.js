(async () => {
  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  const puppeteer = require('puppeteer');

  const port = 5100;

  // Serve a synthetic page that mimics a small YouTube player with overlay and a fake ad XHR
  function startSyntheticServer(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        try {
          if (req.url === '/yt-stub') {
            res.setHeader('Content-Type', 'text/html');
            res.end(`<!doctype html><html><head><meta charset="utf-8"><title>YT Stub</title></head><body>
              <div id="player" style="width:640px;height:360px;background:#000;position:relative;color:#fff">
                <div id="overlay" class="ytp-ad ad-overlay ad-showing" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff">AD OVERLAY<button id="skip" class="ad-skip-button">Skip</button></div>
              </div>
              <script>
                // fake ad beacon
                fetch('/ad-endpoint').then(r=>r.text()).then(t=>console.log('ad response', t)).catch(e=>console.log('ad fetch failed', e));
              </script>
            </body></html>`);
            return;
          }
          if (req.url === '/ad-endpoint') {
            // mimic a YouTube ad endpoint response
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: 'ADS_PRESENT', ad: true }));
            return;
          }
          // default 404
          res.statusCode = 404; res.end('Not found');
        } catch (e) { res.statusCode = 500; res.end('Err'); }
      });
      server.listen(port, () => resolve({ stop: () => new Promise(r => server.close(r)), url: `http://localhost:${port}` }));
      server.on('error', reject);
    });
  }

  const srv = await startSyntheticServer(port);
  console.log('Synthetic YT server:', srv.url);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', msg => {
      try { const txt = msg.text(); if (/ad fetch failed|E2E/.test(txt)) errors.push({ type: 'console', text: txt }); } catch(e){}
    });

    const network = [];
    page.on('requestfinished', req => {
      try { network.push({ url: req.url(), status: req.response() && req.response().status() }); } catch(e){}
    });
    await page.goto(srv.url + '/yt-stub', { waitUntil: 'networkidle2' });
    // wait for the overlay and ad fetch to run
    await new Promise(r => setTimeout(r, 1500));

    // check overlay removed
    const overlayExists = await page.$('.ytp-ad.ad-overlay.ad-showing');
    if (overlayExists) errors.push({ type: 'overlay', message: 'Overlay still present' });

    // check whether ad-endpoint was requested and what response status
    const adRequests = network.filter(n => n.url.includes('/ad-endpoint'));
    if (!adRequests.length) errors.push({ type: 'network', message: 'No ad-endpoint request observed' });
    else {
      const st = adRequests[0].status;
      // we expect blocked (204) or spoofed (200) - treat 200 as spoof OK
      if (st !== 200 && st !== 204) errors.push({ type: 'network', message: 'Unexpected status for ad-endpoint: ' + st });
    }

    if (errors.length) {
      console.error('YT smoke detected issues:', errors);
      process.exitCode = 2;
    } else { console.log('YT smoke passed'); process.exitCode = 0; }
  } catch (e) { console.error('YT smoke failed', e); process.exitCode = 3; }
  finally { try { await browser.close(); } catch(e){}; try { await srv.stop(); } catch(e){} }
})();
