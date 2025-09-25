# AdBlockX - Server-side enforcement proxy (demo)

This repository includes a minimal Node.js proxy server (`server.js`) that demonstrates how to enforce AdBlockX rules on the server side.

Features

- Enforces `BLACKLIST`, `SPOOF_LIST`, and `WHITELIST` from `lists.json`.
- Blocks matched URLs with HTTP 204.
- Returns a spoofed JSON payload for matched spoof URLs.
- Forwards other requests to the target server and returns the response.
- Management API to `GET`/`POST` lists protected by an API key via `X-API-KEY` header.

Quick start (Windows PowerShell)

1. Install dependencies:

```powershell
cd "c:\Users\abest\OneDrive\Documents\GitHub\AdBlockerX"
npm install
```

1. Create or set an API key environment variable and start the server:

```powershell
$env:X_API_KEY = 'change-me'
node server.js
```

1. Use the proxy: encode the target URL and hit `/proxy/{encoded-url}`.

Example:

`GET http://localhost:4000/proxy/https%3A%2F%2Fexample.com%2Fpath`

Management API examples (use header `x-api-key: change-me`):

- GET `/lists` — returns current lists
- POST `/lists` — JSON body with `BLACKLIST`, `SPOOF_LIST`, `WHITELIST` arrays to replace lists

Extended lists and management

- The server supports `REGEX_RULES` (array of regex strings) and `ALWAYS_BLOCK` (hostnames) in `lists.json`.
- `POST /lists` accepts `REGEX_RULES` and `ALWAYS_BLOCK` arrays as well.

Client integration

- The client-side `AdBlockX.js` supports an optional server proxy configuration via `window.AdBlockX.setServerProxy(url, apiKey, mode)`.
  - `mode` can be `off` (default), or `enforce`.
    In `enforce` mode the client will forward matched requests to the server proxy endpoint (for example, `http://localhost:4000/proxy/`) so the server can apply strong blocking/spoofing.

Smoke tests

- A test script `test_proxy.js` is included to validate block/spoof/forward behavior. Run it after starting the server:

```powershell
$env:X_API_KEY='change-me'
node test_proxy.js
```

Notes & Safety

- This demo is not production-ready: it lacks rate-limiting, authentication beyond a simple API key, TLS, input validation, and logging hardening.
- Use in a trusted environment only. For production, deploy behind HTTPS, add robust auth, rate limits, and strict header sanitization.

## Docker

You can run the server and demo via Docker / Docker Compose.

Build and run the server image:

```powershell
docker build -t adblockx-server .
docker run -e X_API_KEY=change-me -p 8080:8080 adblockx-server
```

Or use the included `docker-compose.yml` to run both the server and a static demo server on ports `8080` and `5000`:

```powershell
docker-compose up --build
```

## GitHub Actions (CI)

A simple GitHub Actions workflow (not included) should:

- Install Node.js
- Run `npm ci`
- Run `node test_proxy.js` against a started server

If you want, I can scaffold a `.github/workflows/ci.yml` that starts the server, waits for it to be ready, and runs the smoke tests.
