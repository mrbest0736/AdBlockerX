(async () => {
  // This test starts a static server on port 5000 serving the repo root and loads AdBlockerX.html
  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  const puppeteer = require('puppeteer');

  const port = 5000;

  // lightweight static server serving files from `root`
  function startStaticServer(root, port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        try {
          let reqPath = decodeURIComponent(new URL(req.url, `http://localhost`).pathname);
          if (reqPath === '/') reqPath = '/AdBlockerX.html';
          const filePath = path.join(root, reqPath);
          fs.stat(filePath, (err, stat) => {
            if (err || !stat.isFile()) {
              res.statusCode = 404;
              res.end('Not found');
              return;
            }
            const ext = path.extname(filePath).toLowerCase();
            const types = {
              '.html': 'text/html',
              '.js': 'application/javascript',
              '.css': 'text/css',
              '.json': 'application/json',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.svg': 'image/svg+xml'
            };
            res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
            const stream = fs.createReadStream(filePath);
            stream.on('error', () => { res.statusCode = 500; res.end('Server error'); });
            stream.pipe(res);
          });
        } catch (e) {
          res.statusCode = 500; res.end('Server error');
        }
      });

      server.on('error', reject);
      server.listen(port, () => {
        resolve({
          stop: () => new Promise(r => server.close(r)),
          server
        });
      });
    });
  }

  const server = await startStaticServer(process.cwd(), port);
  console.log('Static server started on http://localhost:' + port);

  const url = `http://localhost:${port}/AdBlockerX.html`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => { errors.push({ type: 'pageerror', error: String(err) }); });
    page.on('console', msg => {
      try {
        const location = msg.location && typeof msg.location === 'function' ? msg.location() : msg.location || {};
        const loc = location && location.url ? ` (${location.url}:${location.lineNumber || 0}:${location.columnNumber || 0})` : '';
        const text = msg.text ? msg.text() : String(msg);
        if (msg.type && msg.type() === 'error') errors.push({ type: 'console', text: text + loc });
        else console.log('console[' + (msg.type ? msg.type() : 'log') + '] ' + text + loc);
      } catch (e) { console.log('console handler error', e); }
    });

    // capture 404 responses to locate missing resources
    page.on('response', resp => {
      try {
        if (resp.status && resp.status() === 404) {
          errors.push({ type: 'response', url: resp.url(), status: resp.status() });
        }
      } catch (e) {}
    });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  // wait a short while for scripts to initialize
    await new Promise(r => setTimeout(r, 2000));

    // Exercise a few UI controls to surface runtime wiring issues
    try {
      const clickIfExists = async (sel) => {
        const el = await page.$(sel);
        if (!el) return;
        let lastErr = null;
        for (let i = 0; i < 3; i++) {
          try {
            await el.click();
            await new Promise(r => setTimeout(r, 300));
            return;
          } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 200)); }
        }
        throw lastErr || new Error('click failed');
      };
  await clickIfExists('#toggleEnable');
      // give runtime a bit more time to react
      await new Promise(r => setTimeout(r, 800));
    } catch (e) { errors.push({ type: 'exercise', error: String(e) }); }

    if (errors.length) {
      console.error('E2E smoke test detected console/page errors:');
      for (const e of errors) console.error(e);
      process.exitCode = 2;
    } else {
      console.log('E2E smoke test passed: no console errors detected');
      process.exitCode = 0;
    }
  } catch (e) {
    console.error('E2E test failed with exception', e);
    process.exitCode = 3;
  } finally {
    try { await browser.close(); } catch (e) {}
    try { server.stop(); } catch (e) { server.server && server.server.close && server.server.close(); }
  }
})();
