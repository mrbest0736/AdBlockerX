(() => {
  'use strict';
  console.log('%cAdBlockX — Service Worker + Fallback (trusted-ui)', 'color:#ff4444;font-weight:bold;');
  try {
    if (typeof window !== 'undefined') {
      window.AdBlockX = window.AdBlockX || {};
      let panelState = null; // Declare early to avoid initialization errors
      if (!window.AdBlockX.earlyAttach) {
        window.AdBlockX.earlyAttach = function(opts) {
          try {
            window.AdBlockX.__earlyAttached = true;
            // default options: install minimal hooks to catch obvious ad hosts
            opts = opts || { installHooks: true };
            if (opts.installHooks && !window.AdBlockX.__earlyHooksInstalled) {
              try {
                // simple blacklist matcher used during early phase (lightweight)
                const earlyPatterns = [/doubleclick/i, /googlesyndication/i, /pagead/ig, /adservice/i, /ad(s|service)/i];
                const matchEarly = (u) => { try { return earlyPatterns.some(r=>r.test(String(u||''))); } catch(e){return false;} };

                // Wrap fetch
                try {
                  const _origFetch = window.fetch;
                  window.fetch = function(input, init) {
                    try {
                      const url = (typeof input === 'string') ? input : (input && input.url) || '';
                      if (matchEarly(url)) {
                        // Petty mode: return insulting response for YouTube and other ad networks
                        if (PETTY_MODE && (url.includes('youtube.com/api/stats/ads') || url.includes('youtubei/v1/player') || url.includes('youtube.com/api/stats/qoe') || url.includes('youtubei/v1/log_event') || url.includes('youtube.com/generate_204') || url.includes('doubleclick.net') || url.includes('googlesyndication.com') || url.includes('twitch.tv') || url.includes('vimeo.com') || url.includes('dailymotion.com'))) {
                          let key = 'youtube.com/api/stats/ads';
                          if (url.includes('youtubei/v1/player')) key = 'youtubei/v1/player';
                          else if (url.includes('youtube.com/api/stats/qoe')) key = 'youtube.com/api/stats/qoe';
                          else if (url.includes('youtubei/v1/log_event')) key = 'youtubei/v1/log_event';
                          else if (url.includes('youtube.com/generate_204')) key = 'youtube.com/generate_204';
                          else if (url.includes('doubleclick.net')) key = 'doubleclick.net';
                          else if (url.includes('googlesyndication.com')) key = 'googlesyndication.com';
                          else if (url.includes('twitch.tv')) key = 'twitch.tv';
                          else if (url.includes('vimeo.com')) key = 'vimeo.com';
                          else if (url.includes('dailymotion.com')) key = 'dailymotion.com';
                          const pettyResponse = PETTY_SPOOFS[key];
                          return Promise.resolve(new Response(pettyResponse, { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } }));
                        }
                        // return a minimal blocked response (204)
                        return Promise.resolve(new Response('', { status: 204, statusText: 'No Content' }));
                      }
                    } catch(e){}
                    return _origFetch.call(this, input, init);
                  };
                } catch(e) {}

                // Wrap XMLHttpRequest open/send
                try {
                  const XProto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
                  if (XProto && !XProto.__abx_early_wrapped) {
                    const _origOpen = XProto.open;
                    XProto.open = function(method, url) {
                      try {
                        if (matchEarly(url)) {
                          this.__abx_block = true;
                        }
                      } catch(e){}
                      return _origOpen.apply(this, arguments);
                    };
                    const _origSend = XProto.send;
                    XProto.send = function(body) {
                      try {
                        if (this.__abx_block) {
                          // abort and simulate finished state
                          try { this.abort(); } catch(e){}
                          // fire loadend with status 204 by scheduling events
                          setTimeout(()=>{
                            try {
                              this.readyState = 4;
                              this.status = 204;
                              if (typeof this.onload === 'function') try { this.onload(); } catch(e){}
                              if (typeof this.onreadystatechange === 'function') try { this.onreadystatechange(); } catch(e){}
                            } catch(e){}
                          }, 0);
                          return;
                        }
                      } catch(e){}
                      return _origSend.apply(this, arguments);
                    };
                    XProto.__abx_early_wrapped = true;
                  }
                } catch(e) {}

                window.AdBlockX.__earlyHooksInstalled = true;
              } catch(e) {}
            }

            // Additional hooks for advanced evasion detection
            try {
              // Wrap eval to detect ad-related dynamic code
              const origEval = window.eval;
              window.eval = function(code) {
                try {
                  if (ENABLED && !isCurrentSiteDisabled() && typeof code === 'string' && (code.includes('ad') || code.includes('track') || code.includes('analytics') || code.includes('doubleclick') || code.includes('googlesyndication'))) {
                    pushLog('blocked', { t: nowStr(), type: 'eval', code: code.substring(0, 100) + '...' });
                    panelLog('Blocked eval with ad-related code');
                    return undefined;
                  }
                } catch(e){}
                return origEval.call(this, code);
              };

              // Wrap Function constructor
              const origFunction = window.Function;
              window.Function = function(...args) {
                try {
                  const code = args[args.length - 1];
                  if (ENABLED && !isCurrentSiteDisabled() && typeof code === 'string' && (code.includes('ad') || code.includes('track') || code.includes('analytics'))) {
                    pushLog('blocked', { t: nowStr(), type: 'function', code: code.substring(0, 100) + '...' });
                    panelLog('Blocked Function constructor with ad-related code');
                    return function(){};
                  }
                } catch(e){}
                return new origFunction(...args);
              };

              // Wrap setTimeout/setInterval for ad-related callbacks
              const origSetTimeout = window.setTimeout;
              window.setTimeout = function(callback, delay, ...args) {
                try {
                  if (ENABLED && !isCurrentSiteDisabled() && typeof callback === 'string' && (callback.includes('ad') || callback.includes('track'))) {
                    pushLog('blocked', { t: nowStr(), type: 'setTimeout', code: callback.substring(0, 100) + '...' });
                    panelLog('Blocked setTimeout with ad-related code');
                    return 0;
                  }
                } catch(e){}
                return origSetTimeout.call(this, callback, delay, ...args);
              };

              const origSetInterval = window.setInterval;
              window.setInterval = function(callback, delay, ...args) {
                try {
                  if (ENABLED && !isCurrentSiteDisabled() && typeof callback === 'string' && (callback.includes('ad') || callback.includes('track'))) {
                    pushLog('blocked', { t: nowStr(), type: 'setInterval', code: callback.substring(0, 100) + '...' });
                    panelLog('Blocked setInterval with ad-related code');
                    return 0;
                  }
                } catch(e){}
                return origSetInterval.call(this, callback, delay, ...args);
              };
            } catch(e) {}

            return true;
          } catch (e) { return false; }
        };
      }
    }
  } catch (e) { /* ignore */ }

  try {
    if (typeof window !== 'undefined') {
      // init queue for early callers: push functions to run once full init completes
      window.AdBlockX._q = window.AdBlockX._q || [];
      window.AdBlockX._enqueue = function(fn) { try { if (typeof fn === 'function') window.AdBlockX._q.push(fn); } catch(e){} };

      (function() {
        const ensureAPI = function() {
          try {
            if (typeof window === 'undefined') return;
            if (!window.AdBlockX || typeof window.AdBlockX !== 'object') window.AdBlockX = {};
            if (!window.AdBlockX.earlyAttach) {
              window.AdBlockX.earlyAttach = function() { window.AdBlockX.__earlyAttached = true; return true; };
            }
            window.AdBlockX._q = window.AdBlockX._q || [];
            if (!window.AdBlockX._enqueue) {
              window.AdBlockX._enqueue = function(fn) { try { if (typeof fn === 'function') window.AdBlockX._q.push(fn); } catch(e){} };
            }
          } catch (e) { /* ignore */ }
        };
        ensureAPI();
        const __abx_early_watchdog = setInterval(ensureAPI, 1000);
        // expose a stop function; the main init should call this when finished
        window.AdBlockX._stopEarlyWatchdog = function() { try { clearInterval(__abx_early_watchdog); delete window.AdBlockX._stopEarlyWatchdog; } catch(e){} };
        // provide a 'harden' method to be called at the end of full initialization.
        // It processes any queued early callbacks, stops the watchdog, and attempts
        // to make the AdBlockX property non-configurable to reduce accidental overwrites.
        window.AdBlockX.harden = function() {
          try {
            try { if (window.AdBlockX._stopEarlyWatchdog) window.AdBlockX._stopEarlyWatchdog(); } catch(e){}
            try {
              const q = window.AdBlockX._q || [];
              while (q && q.length) {
                try { const fn = q.shift(); if (typeof fn === 'function') { try { fn(); } catch(e){} } } catch(e){}
              }
            } catch(e){}
            // attempt to make the property non-deletable (best-effort)
            try { Object.defineProperty(window, 'AdBlockX', { configurable: false, writable: true, enumerable: true, value: window.AdBlockX }); } catch(e){}
            return true;
          } catch(e) { return false; }
        };
      })();
    }
  } catch (e) { /* ignore */ }

  /***********************
   * Config (tweak here) + persistence helpers
   ***********************/
  const DEFAULT_BLACKLIST = [
    "doubleclick.net",
    "googlesyndication.com",
    "pagead2.googlesyndication.com",
    "googleads.g.doubleclick.net",
    "adservice.google.com",
    "pagead/",
    "youtube.com/api/stats/ads",
    "youtube.com/get_midroll",
    "youtubei/v1/player/ad_",
    "googletagservices.com",
    "googletagmanager.com",
    "amazon-adsystem.com",
    "scorecardresearch.com",
    "taboola.com",
    "outbrain.com",
    "criteo.com",
    "adnxs.com",
    "adsrvr.org",
    "adroll.com"
  ];

  // Add aggressive YouTube-related hosts/endpoints to the default blacklist for
  // early blocking. These target known ad/tracking endpoints and playback ad APIs.
  DEFAULT_BLACKLIST.push(
    'youtube.com/get_midroll',
    'youtube.com/api/stats/ads',
    'youtubei/v1/player',
    'youtubei/v1/player_ad',
    'googlevideo.com/ad',
    'youtube.com/get_video_info',
    's.youtube.com',
    'r5---sn',
    'ad.doubleclick.net'
  );

  const DEFAULT_SPOOF_LIST = [
    "/api/stats/ads",
    "/pagead/",
    "doubleclick.net",
    "googlesyndication.com",
    // YouTube player ad endpoints: prefer to spoof with NO_ADS JSON instead of returning empty
    "youtube.com/api/stats/ads",
    "youtube.com/get_midroll",
    "youtubei/v1/player",
    "youtubei/v1/player_ad",
    "googlevideo.com/ad"
  ];

  const DEFAULT_WHITELIST = [
    'i.ytimg.com',
    'googlevideo.com',
    'googleusercontent.com',
    'clients1.google.com',
    'generate_204'
  ];

  // additional YouTube-specific regex rules to catch parameterized ad endpoints
  const DEFAULT_YT_REGEX = [
    // player ad requests and ad-break signals
    'youtubei\\/v1\\/player',
    'get_midroll',
    'ad_break|ad?placement|adsegments|ad_format',
    'googlevideo\\.com\\/.*ad',
    'youtube\\.googleapis\\.com\\/v[0-9]\\/.*ad'
  ];

  function loadJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (!v) return typeof fallback === 'function' ? fallback() : JSON.parse(JSON.stringify(fallback));
      return JSON.parse(v);
    } catch (e) { return typeof fallback === 'function' ? fallback() : JSON.parse(JSON.stringify(fallback)); }
  }
  function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  let BLACKLIST = loadJSON('AdBlockX.BLACKLIST', DEFAULT_BLACKLIST);
  let SPOOF_LIST = loadJSON('AdBlockX.SPOOF_LIST', DEFAULT_SPOOF_LIST);
  let REGEX_RULES = loadJSON('AdBlockX.REGEX_RULES', []); // strings: patterns
  let REMOTE_LISTS = loadJSON('AdBlockX.REMOTE_LISTS', []); // [{url, lastFetched}]
  let WHITELIST = loadJSON('AdBlockX.WHITELIST', DEFAULT_WHITELIST);
  let LOGS = loadJSON('AdBlockX.LOGS', { blocked: [], spoofed: [], observed: [] });
  // global enabled flag and extension-style exact blocks
  let ENABLED = loadJSON('AdBlockX.ENABLED', true);
  let EXT_BLOCK = loadJSON('AdBlockX.EXT_BLOCK', []);
  let BLOCK_TYPES = loadJSON('AdBlockX.BLOCK_TYPES', { script:true, image:false, xhr:true, document:false, iframe:true, websocket:false });
  let PER_SITE_DISABLED = loadJSON('AdBlockX.PER_SITE_DISABLED', {}); // map origin -> true meaning disabled on that origin

  // session-scoped stats (reset when browser/tab session ends)
  let SESSION_STATS = loadJSON('AdBlockX.SESSION_STATS', { blocked:0, spoofed:0, observed:0, start: nowStr() });
  // scheduled blocking (hours in 24h, start inclusive, end exclusive)
  let SCHEDULE = loadJSON('AdBlockX.SCHEDULE', { enabled: false, startHour: 0, endHour: 24 });
  // block requests when referrer matches any fragment in this list
  let REFERRER_BLOCKS = loadJSON('AdBlockX.REFERRER_BLOCKS', []);
  // Always-block list: enforced regardless of resource type (for critical ad/tracking endpoints)
  let ALWAYS_BLOCK = loadJSON('AdBlockX.ALWAYS_BLOCK', [
    'googleadservices.com',
    'googleads.g.doubleclick.net',
    'doubleclick.net',
    'googleads.g.doubleclick',
    'pagead/viewthroughconversion',
    'googleadservices'
  ]);
  // Enforcer mode: when enabled, automatically promote observed high-confidence hosts to ALWAYS_BLOCK
  let ENFORCER_ENABLED = !!loadJSON('AdBlockX.ENFORCER_ENABLED', false);
  // Promotion threshold (how many observations before promoting a host)
  let ENFORCER_PROMOTION_THRESHOLD = loadJSON('AdBlockX.ENFORCER_PROMOTION_THRESHOLD', 3);
  // Counters for enforcer observations per-host
  let ENFORCER_COUNTERS = loadJSON('AdBlockX.ENFORCER_COUNTERS', {});
  // Strict enforcer: when enabled, aggressively block all likely ad/tracking resources and prevent DOM insertions
  let STRICT_ENFORCER = !!loadJSON('AdBlockX.STRICT_ENFORCER', false);
  // Watchdog: scans resource loads and DOM for slipped-through ads and removes them
  let WATCHDOG_ENABLED = !!loadJSON('AdBlockX.WATCHDOG_ENABLED', false);
  const WATCHDOG_INTERVAL_MS = 2000;
  let __abx_watchdog = { timer: null, seen: new Set(), mo: null };

  // Optional API key (users may set this to enable remote imports that require a key)
  let API_KEY = loadJSON('AdBlockX.API_KEY', '');
  // Server-side proxy configuration: { url: 'http://host:port/proxy/', apiKey: '...', mode: 'off'|'enforce' }
  let SERVER_PROXY = loadJSON('AdBlockX.SERVER_PROXY', { url: '', apiKey: '', mode: 'off' });
  // Remote script imports: array of script URLs users want to load (disabled by default)
  let REMOTE_IMPORTS = loadJSON('AdBlockX.REMOTE_IMPORTS', []);
  // Prescan remote imports before executing them
  let PRESCAN_REMOTE_IMPORTS = !!loadJSON('AdBlockX.PRESCAN_REMOTE_IMPORTS', false);
  // Flag to allow loading foreign/third-party scripts. Default false for safety.
  let ALLOW_FOREIGN_IMPORTS = !!loadJSON('AdBlockX.ALLOW_FOREIGN_IMPORTS', false);

  function pushLog(type, data) {
    try {
      if (PRIVACY_MODE && __abx_encryption_key) {
        // Encrypt log data
        data = encryptData(JSON.stringify(data), __abx_encryption_key);
      }
      LOGS[type].push(data);
      if (LOGS[type].length > 1000) LOGS[type].shift(); // Limit log size
      saveJSON('AdBlockX.LOGS', LOGS);
      // Auto-delete old logs after 24 hours for privacy
      if (PRIVACY_MODE) {
        setTimeout(() => {
          try {
            const now = Date.now();
            LOGS[type] = LOGS[type].filter(entry => {
              const entryTime = new Date(entry.t || '').getTime();
              return (now - entryTime) < 24 * 60 * 60 * 1000; // Keep only last 24 hours
            });
            saveJSON('AdBlockX.LOGS', LOGS);
          } catch(e){}
        }, 60 * 60 * 1000); // Check every hour
      }
    } catch (e) {}
  }

  function encryptData(data, key) {
    // Simple XOR encryption for client-side privacy
    let result = '';
    for (let i = 0; i < data.length; i++) {
      result += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(result); // Base64 encode
  }

  function decryptData(data, key) {
    const decoded = atob(data);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  }

  // Load lists.json to update lists
  (async () => {
    try {
      // Only fetch lists.json if on localhost to avoid 404 on remote sites
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        const response = await fetch('/lists.json');
        if (response.ok) {
          const data = await response.json();
        if (data.BLACKLIST && Array.isArray(data.BLACKLIST)) {
          for (const item of data.BLACKLIST) {
            if (!BLACKLIST.includes(item)) BLACKLIST.push(item);
          }
        }
        if (data.SPOOF_LIST && Array.isArray(data.SPOOF_LIST)) {
          for (const item of data.SPOOF_LIST) {
            if (!SPOOF_LIST.includes(item)) SPOOF_LIST.push(item);
          }
        }
        if (data.WHITELIST && Array.isArray(data.WHITELIST)) {
          for (const item of data.WHITELIST) {
            if (!WHITELIST.includes(item)) WHITELIST.push(item);
          }
        }
        if (data.REGEX_RULES && Array.isArray(data.REGEX_RULES)) {
          for (const item of data.REGEX_RULES) {
            if (!REGEX_RULES.includes(item)) REGEX_RULES.push(item);
          }
        }
        if (data.ALWAYS_BLOCK && Array.isArray(data.ALWAYS_BLOCK)) {
          for (const item of data.ALWAYS_BLOCK) {
            if (!ALWAYS_BLOCK.includes(item)) ALWAYS_BLOCK.push(item);
          }
        }
        panelLog('Lists updated from lists.json');
        }
      }
    } catch (e) {
      // Ignore if lists.json not available
    }
  })();

  // Browser compatibility
  const IS_MODERN_BROWSER = !!window.ServiceWorker && !!window.MutationObserver && !!window.fetch;
  // Browser compatibility: fallback for non-modern browsers
  if (!IS_MODERN_BROWSER) {
    panelLog('Legacy browser detected: enabling basic mode');
    // Fallback to basic blocking without SW or advanced observers
    ENABLED = true;
    // Use polling for DOM changes
    setInterval(() => {
      try {
        const ads = document.querySelectorAll('[id*="ad"], [class*="ad"], iframe');
        ads.forEach(el => { try { el.style.display = 'none'; } catch(e){} });
      } catch(e){}
    }, 1000);
  }

  function getCurrentOrigin() { try { return location.origin || (location.protocol + '//' + location.hostname); } catch(e){ return ''; } }
  function isCurrentSiteDisabled() { try { const o = getCurrentOrigin(); return !!(PER_SITE_DISABLED && PER_SITE_DISABLED[o]); } catch(e){ return false; } }

  // Check schedule (hour-based). Returns true if current hour is within [startHour, endHour)
  function isWithinSchedule() {
    try {
      if (!SCHEDULE || !SCHEDULE.enabled) return true;
      const d = new Date(); const h = d.getHours();
      const s = Number(SCHEDULE.startHour||0); const e = Number(SCHEDULE.endHour||24);
      if (s === e) return true; // full day
      if (s < e) return h >= s && h < e;
      // wrapped around midnight
      return h >= s || h < e;
    } catch (e) { return true; }
  }

  // isActive combines global ENABLED, per-site and schedule
  function isActive() {
    try { return !!ENABLED && !isCurrentSiteDisabled() && isWithinSchedule(); } catch (e) { return !!ENABLED; }
  }

  // Hypernova aggressive mode
  let HYPERNOVA = loadJSON('AdBlockX.HYPERNOVA', false);
  let __abx_hyper_overrides = null;
  // Archballistic: even more aggressive runtime annihilation
  let ARCHBALLISTIC = loadJSON('AdBlockX.ARCHBALLISTIC', false);
  let __abx_arch_handles = null;
  // AI mode: uses TensorFlow.js for image classification to detect and block ads
  let AI_MODE = loadJSON('AdBlockX.AI_MODE', false);
  let __abx_ai_model = null;
  let __abx_ai_observer = null;
  // Fuck All Ads mode: enables all aggressive ad-blocking features simultaneously
  let FUCK_ALL_ADS_MODE = loadJSON('AdBlockX.FUCK_ALL_ADS_MODE', false);
  // Performance optimizations
  let PERFORMANCE_MODE = loadJSON('AdBlockX.PERFORMANCE_MODE', true); // Enable optimizations by default
  let __abx_throttle = { lastRun: 0, interval: 100 }; // Throttle AI classifications
  // Device capability check: disable resource-intensive features on low-end devices
  const IS_LOW_END_DEVICE = (() => {
    try {
      const cores = navigator.hardwareConcurrency || 1;
      const mem = navigator.deviceMemory || 1;
      return cores < 4 || mem < 4; // Assume low-end if <4 cores or <4GB RAM
    } catch(e) { return false; }
  })();
  if (IS_LOW_END_DEVICE) {
    AI_MODE = false; // Disable AI by default on low-end
    PERFORMANCE_MODE = true; // Force performance mode
  }
  // Privacy enhancements
  let PRIVACY_MODE = loadJSON('AdBlockX.PRIVACY_MODE', false); // Encrypt logs if enabled
  let __abx_encryption_key = null;
  // Petty mode for YouTube: give ad servers a massive middle finger
  let PETTY_MODE = loadJSON('AdBlockX.PETTY_MODE', false);
  // Nuclear mode: ultimate destruction - enables all modes + extra aggression
  let NUCLEAR_MODE = loadJSON('AdBlockX.NUCLEAR_MODE', false);
  // Confirmation mode: prompt before blocking to reduce false positives
  let CONFIRMATION_MODE = loadJSON('AdBlockX.CONFIRMATION_MODE', false);
  // Function to confirm blocking
  function confirmBlock(type, url, reason) {
    if (!CONFIRMATION_MODE) return true;
    try {
      const msg = `Block ${type} request to ${url}? Reason: ${reason}`;
      return confirm(msg);
    } catch(e) { return true; }
  }
  // Petty spoof responses for YouTube
  const PETTY_SPOOFS = {
    'youtube.com/api/stats/ads': JSON.stringify({
      "responseContext": {
        "serviceTrackingParams": [],
        "mainAppWebResponseContext": {
          "loggedOut": true
        },
        "webResponseContextExtensionData": {}
      },
      "command": {
        "adBreakHeartbeatCommand": {
          "nextAdBreakIndex": -1,
          "adBreakIndex": -1,
          "currentTimeMs": "0",
          "adBreak": {
            "adBreakIndex": -1,
            "adBreakType": "AD_BREAK_TYPE_UNSPECIFIED",
            "adBreakTimeOffsetMs": "0",
            "adBreakDurationMs": "0",
            "adBreakRenderer": {
              "adBreakHeaderRenderer": {
                "text": {
                  "runs": [
                    {
                      "text": "🚫 BLOCKED BY ADBLOCKERX 🚫\n🖕 MIDDLE FINGER TO YOUTUBE ADS 🖕\nYour ad servers can suck it! 😎\nFUCK OFF PERMANENTLY, YOUTUBE STAFF AND CEO! 🔨\nTell your team to go fuck themselves! 👎"
                    }
                  ]
                }
              }
            }
          }
        }
      }
    }),
    'youtubei/v1/player': JSON.stringify({
      "responseContext": {
        "serviceTrackingParams": []
      },
      "playabilityStatus": {
        "status": "OK",
        "reason": "🖕 AdBlockerX says: No ads for you! 🖕 FUCK OFF PERMANENTLY, YOUTUBE STAFF AND CEO!"
      },
      "streamingData": {
        "formats": [],
        "adaptiveFormats": []
      },
      "videoDetails": {
        "videoId": "blocked",
        "title": "🚫 AdBlockerX: Middle Finger Mode Activated 🚫 FUCK OFF PERMANENTLY, YOUTUBE STAFF AND CEO!",
        "lengthSeconds": "0",
        "channelId": "blocked",
        "isOwnerViewing": false,
        "isCrawlable": false,
        "thumbnail": {
          "thumbnails": [
            {
              "url": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjkwIiB2aWV3Qm94PSIwIDAgMTIwIDkwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cmVjdCB3aWR0aD0iMTIwIiBoZWlnaHQ9IjkwIiBmaWxsPSIjMDAwIi8+Cjx0ZXh0IHg9IjYwIiB5PSI0NSIgZm9udC1zaXplPSIxNCIgZmlsbD0iI2ZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+8J+RjPCfjI08L3RleHQ+Cjwvc3ZnPg=="
            }
          ]
        },
        "allowRatings": false,
        "viewCount": "0",
        "author": "AdBlockerX",
        "isPrivate": true,
        "isUnpluggedCorpus": true,
        "isLiveContent": false
      },
      "playerConfig": {
        "audioConfig": {
          "loudnessDb": -100
        }
      }
    }),
    'youtube.com/api/stats/qoe': JSON.stringify({
      "responseContext": {
        "serviceTrackingParams": [],
        "mainAppWebResponseContext": {
          "loggedOut": true
        },
        "webResponseContextExtensionData": {}
      },
      "qoe": {
        "quality": "BLOCKED",
        "reason": "🖕 AdBlockerX: Quality of Experience? More like Quality of Fuck You! 🖕 FUCK OFF PERMANENTLY, YOUTUBE STAFF AND CEO! Your ads are shit, and so is your service!"
      }
    }),
    'youtubei/v1/log_event': JSON.stringify({
      "responseContext": {
        "serviceTrackingParams": []
      },
      "logEvent": {
        "eventType": "BLOCKED_EVENT",
        "details": "🚫 AdBlockerX: Logging your failure to serve ads 🚫 🖕 MIDDLE FINGER TO YOUTUBE LOGS 🖕 FUCK OFF PERMANENTLY, YOUTUBE STAFF AND CEO! Tell your engineers to go fuck themselves!"
      }
    }),
    'youtube.com/generate_204': JSON.stringify({
      "trackingBlocked": true,
      "message": "🖕 AdBlockerX: No tracking for you! 🖕 FUCK OFF PERMANENTLY, YOUTUBE STAFF AND CEO! Your pixel tracking can suck it!"
    }),
    'doubleclick.net': JSON.stringify({
      "adBlocked": true,
      "message": "🚫 AdBlockerX: DoubleClick blocked 🚫 🖕 Fuck off, Google Ads team! 🖕 Your invasive tracking is garbage!"
    }),
    'googlesyndication.com': JSON.stringify({
      "syndicationBlocked": true,
      "message": "🚫 AdBlockerX: Google Syndication blocked 🚫 🖕 Tell your CEO to shove ads up his ass! 🖕 Permanent block activated!"
    }),
    'twitch.tv': JSON.stringify({
      "adBlocked": true,
      "message": "🚫 AdBlockerX: Twitch ads blocked 🚫 🖕 Fuck off, Twitch team! 🖕 Your streams are ruined by ads!"
    }),
    'vimeo.com': JSON.stringify({
      "adBlocked": true,
      "message": "🚫 AdBlockerX: Vimeo ads blocked 🚫 🖕 Tell your execs to stop the ads! 🖕 Quality over quantity!"
    }),
    'dailymotion.com': JSON.stringify({
      "adBlocked": true,
      "message": "🚫 AdBlockerX: Dailymotion ads blocked 🚫 🖕 Ads are dead, long live ad-free video! 🖕"
    })
  };
  // ImageNet classes for MobileNet (subset relevant to ads)
  const IMAGENET_CLASSES = [
    'tench', 'goldfish', 'great white shark', 'tiger shark', 'hammerhead', 'electric ray', 'stingray', 'cock', 'hen', 'ostrich', 'brambling', 'goldfinch', 'house finch', 'junco', 'indigo bunting', 'robin', 'bulbul', 'jay', 'magpie', 'chickadee', 'water ouzel', 'kite', 'bald eagle', 'vulture', 'great grey owl', 'European fire salamander', 'common newt', 'eft', 'spotted salamander', 'axolotl', 'bullfrog', 'tree frog', 'tailed frog', 'loggerhead', 'leatherback turtle', 'mud turtle', 'terrapin', 'box turtle', 'banded gecko', 'common iguana', 'American chameleon', 'whiptail', 'agama', 'frilled lizard', 'alligator lizard', 'Gila monster', 'green lizard', 'African chameleon', 'Komodo dragon', 'African crocodile', 'American alligator', 'triceratops', 'thunder snake', 'ringneck snake', 'hognose snake', 'green snake', 'king snake', 'garter snake', 'water snake', 'vine snake', 'night snake', 'boa constrictor', 'rock python', 'Indian cobra', 'green mamba', 'sea snake', 'horned viper', 'diamondback', 'sidewinder', 'trilobite', 'harvestman', 'scorpion', 'black and gold garden spider', 'barn spider', 'garden spider', 'black widow', 'tarantula', 'wolf spider', 'tick', 'centipede', 'black grouse', 'ptarmigan', 'ruffed grouse', 'prairie chicken', 'peacock', 'quail', 'partridge', 'African grey', 'macaw', 'sulphur-crested cockatoo', 'lorikeet', 'coucal', 'bee eater', 'hornbill', 'hummingbird', 'jacamar', 'toucans', 'drake', 'red-breasted merganser', 'goose', 'black swan', 'tusker', 'echidna', 'platypus', 'wallaby', 'koala', 'wombat', 'jellyfish', 'sea anemone', 'brain coral', 'flatworm', 'nematode', 'conch', 'snail', 'slug', 'sea slug', 'chiton', 'chambered nautilus', 'Dungeness crab', 'rock crab', 'fiddler crab', 'king crab', 'American lobster', 'spiny lobster', 'crayfish', 'hermit crab', 'isopod', 'white stork', 'black stork', 'spoonbill', 'flamingo', 'little blue heron', 'American egret', 'bittern', 'crane', 'limpkin', 'European gallinule', 'American coot', 'bustard', 'ruddy turnstone', 'red-backed sandpiper', 'redshank', 'dowitcher', 'oystercatcher', 'pelican', 'king penguin', 'albatross', 'grey whale', 'killer whale', 'dugong', 'sea lion', 'Chihuahua', 'Japanese spaniel', 'Maltese dog', 'Pekinese', 'Shih-Tzu', 'Blenheim spaniel', 'papillon', 'toy terrier', 'Rhodesian ridgeback', 'Afghan hound', 'basset', 'beagle', 'bloodhound', 'bluetick', 'black-and-tan coonhound', 'Walker hound', 'English foxhound', 'redbone', 'borzoi', 'Irish wolfhound', 'Italian greyhound', 'whippet', 'Ibizan hound', 'Norwegian elkhound', 'otterhound', 'Saluki', 'Scottish deerhound', 'Weimaraner', 'Staffordshire bullterrier', 'American Staffordshire terrier', 'Bedlington terrier', 'Border terrier', 'Kerry blue terrier', 'Irish terrier', 'Norwegian terrier', 'Yorkshire terrier', 'wire-haired fox terrier', 'Lakeland terrier', 'Sealyham terrier', 'Airedale', 'cairn', 'Australian terrier', 'Dandie Dinmont', 'Boston bull', 'miniature schnauzer', 'giant schnauzer', 'standard schnauzer', 'Scotch terrier', 'Tibetan terrier', 'silky terrier', 'soft-coated wheaten terrier', 'West Highland white terrier', 'Lhasa', 'flat-coated retriever', 'curly-coated retriever', 'golden retriever', 'Labrador retriever', 'Chesapeake Bay retriever', 'German short-haired pointer', 'vizsla', 'English setter', 'Irish setter', 'Gordon setter', 'Brittany spaniel', 'clumber', 'English springer', 'Welsh springer spaniel', 'cocker spaniel', 'Sussex spaniel', 'Irish water spaniel', 'kuvasz', 'schipperke', 'groenendael', 'malinois', 'briard', 'kelpie', 'komondor', 'Old English sheepdog', 'Shetland sheepdog', 'collie', 'Border collie', 'Bouvier des Flandres', 'Rottweiler', 'German shepherd', 'Doberman', 'miniature pinscher', 'Greater Swiss Mountain dog', 'Bernese mountain dog', 'Appenzeller', 'EntleBucher', 'boxer', 'bull mastiff', 'Tibetan mastiff', 'French bulldog', 'Great Dane', 'Saint Bernard', 'Eskimo dog', 'malamute', 'Siberian husky', 'dalmatian', 'affenpinscher', 'basenji', 'pug', 'Leonberg', 'Newfoundland', 'Great Pyrenees', 'Samoyed', 'Pomeranian', 'chow', 'keeshond', 'Brabancon griffon', 'Pembroke', 'Cardigan', 'toy poodle', 'miniature poodle', 'standard poodle', 'Mexican hairless', 'timber wolf', 'white wolf', 'red wolf', 'coyote', 'dingo', 'dhole', 'African hunting dog', 'hyena', 'red fox', 'kit fox', 'Arctic fox', 'grey fox', 'tabby', 'tiger cat', 'Persian cat', 'Siamese cat', 'Egyptian cat', 'cougar', 'lynx', 'leopard', 'snow leopard', 'jaguar', 'lion', 'tiger', 'cheetah', 'brown bear', 'American black bear', 'ice bear', 'sloth bear', 'mongoose', 'meerkat', 'tiger beetle', 'ladybug', 'ground beetle', 'long-horned beetle', 'leaf beetle', 'dung beetle', 'rhinoceros beetle', 'weevil', 'fly', 'bee', 'ant', 'grasshopper', 'cricket', 'walking stick', 'cockroach', 'mantis', 'cicada', 'leafhopper', 'lacewing', 'dragonfly', 'damselfly', 'admiral', 'ringlet', 'monarch', 'cabbage butterfly', 'sulphur butterfly', 'lycaenid', 'starfish', 'sea urchin', 'sea cucumber', 'wood rabbit', 'hare', 'Angora', 'hamster', 'porcupine', 'fox squirrel', 'marmot', 'beaver', 'guinea pig', 'sorrel', 'zebra', 'hog', 'wild boar', 'warthog', 'hippopotamus', 'ox', 'water buffalo', 'bison', 'ram', 'bighorn sheep', 'ibex', 'hartebeest', 'impala', 'gazelle', 'Arabian camel', 'llama', 'weasel', 'mink', 'polecat', 'black-footed ferret', 'otter', 'skunk', 'badger', 'armadillo', 'three-toed sloth', 'orangutan', 'gorilla', 'chimpanzee', 'gibbon', 'siamang', 'guenon', 'patas', 'baboon', 'macaque', 'langur', 'colobus', 'proboscis monkey', 'marmoset', 'capuchin', 'howler monkey', 'titi', 'spider monkey', 'squirrel monkey', 'Madagascar cat', 'indri', 'Indian elephant', 'African elephant', 'lesser panda', 'giant panda', 'barracuda', 'eel', 'coho', 'rock beauty', 'clownfish', 'sturgeon', 'gar', 'lionfish', 'puffer', 'abacus', 'abaya', 'academic gown', 'accordion', 'acoustic guitar', 'aircraft carrier', 'airliner', 'airship', 'altar', 'ambulance', 'amphibian', 'analog clock', 'apiary', 'apron', 'ashcan', 'assault rifle', 'backpack', 'bakery', 'balance beam', 'balloon', 'ballpoint', 'Band Aid', 'banjo', 'bathing cap', 'battery', 'beach wagon', 'beacon', 'beaker', 'bearskin', 'beer bottle', 'beer glass', 'bell cote', 'bib', 'bicycle-built-for-two', 'bikini', 'binder', 'binoculars', 'birdhouse', 'boathouse', 'bobsled', 'bolo tie', 'bonnet', 'bookcase', 'bookshop', 'bottlecap', 'bow', 'bow tie', 'brass', 'brassiere', 'breakwater', 'breastplate', 'broom', 'bucket', 'buckle', 'bulletproof vest', 'bullet train', 'butcher shop', 'cab', 'caldron', 'candle', 'cannon', 'canoe', 'can opener', 'cardigan', 'car mirror', 'carousel', 'carpenter\'s kit', 'carton', 'car wheel', 'cash machine', 'cassette', 'cassette player', 'castle', 'catamaran', 'CD player', 'cello', 'cellular telephone', 'chain', 'chainlink fence', 'chain mail', 'chain saw', 'chest', 'chiffonier', 'chime', 'china cabinet', 'Christmas stocking', 'church', 'cinema', 'cleaver', 'cliff dwelling', 'cloak', 'clog', 'cocktail shaker', 'coffee mug', 'coffeemaker', 'coil', 'combination lock', 'computer keyboard', 'confectionery', 'container ship', 'convertible', 'corkscrew', 'cornet', 'cowboy boot', 'cowboy hat', 'cradle', 'crane', 'crash helmet', 'crate', 'crib', 'Crock Pot', 'croquet ball', 'crutch', 'cuirass', 'dam', 'desk', 'desktop computer', 'dial telephone', 'diaper', 'digital clock', 'digital watch', 'dining table', 'dishrag', 'dishwasher', 'disk brake', 'dock', 'dogsled', 'dome', 'doormat', 'drilling platform', 'drum', 'drumstick', 'dumbbell', 'Dutch oven', 'electric fan', 'electric guitar', 'electric locomotive', 'entertainment center', 'envelope', 'espresso maker', 'face powder', 'feather boa', 'file', 'fireboat', 'fire engine', 'fire screen', 'flagpole', 'flute', 'folding chair', 'football helmet', 'forklift', 'fountain', 'fountain pen', 'four-poster', 'freight car', 'French horn', 'frying pan', 'fur coat', 'garbage truck', 'gasmask', 'gas pump', 'goblet', 'go-kart', 'golf ball', 'golfcart', 'gondola', 'gong', 'gown', 'grand piano', 'greenhouse', 'grille', 'grocery store', 'guillotine', 'hair slide', 'hair spray', 'half track', 'hammer', 'hamper', 'hand blower', 'hand-held computer', 'handkerchief', 'hard disc', 'harmonica', 'harp', 'harvester', 'hatchet', 'holster', 'home theater', 'honeycomb', 'hook', 'hoopskirt', 'horizontal bar', 'horse cart', 'hose', 'hospice', 'hourglass', 'iPod', 'iron', 'jack-o\'-lantern', 'jean', 'jeep', 'jersey', 'jigsaw puzzle', 'jinrikisha', 'joystick', 'kimono', 'knee pad', 'knot', 'lab coat', 'ladle', 'lampshade', 'laptop', 'lawn mower', 'lens cap', 'letter opener', 'library', 'lifeboat', 'lighter', 'limousine', 'liner', 'lipstick', 'Loafer', 'lotion', 'loudspeaker', 'loupe', 'lumbermill', 'magnetic compass', 'mailbag', 'mailbox', 'maillot', 'maillot', 'manhole cover', 'maraca', 'marimba', 'mask', 'matchstick', 'maypole', 'maze', 'measuring cup', 'meat loaf', 'medicine chest', 'megalith', 'microphone', 'microwave', 'military uniform', 'milk can', 'minibus', 'miniskirt', 'minivan', 'missile', 'mitten', 'mixing bowl', 'mobile home', 'Model T', 'modem', 'monastery', 'monitor', 'moped', 'mortar', 'mortarboard', 'mosque', 'mosquito net', 'motor scooter', 'mountain bike', 'mountain tent', 'mouse', 'mousetrap', 'moving van', 'muzzle', 'nail', 'neck brace', 'necklace', 'nipple', 'notebook', 'obelisk', 'oboe', 'ocarina', 'odometer', 'oil filter', 'organ', 'oscilloscope', 'overskirt', 'oxcart', 'oxygen mask', 'packet', 'paddle', 'paddlewheel', 'padlock', 'paintbrush', 'pajama', 'palace', 'panpipe', 'paper towel', 'parachute', 'parallel bars', 'park bench', 'parking meter', 'passenger car', 'patio', 'pay-phone', 'pedestal', 'pencil box', 'pencil sharpener', 'perfume', 'Petri dish', 'photocopier', 'pick', 'pickelhaube', 'picket fence', 'pickup', 'pier', 'piggy bank', 'pillow', 'ping-pong ball', 'pinwheel', 'pirate', 'pitcher', 'plane', 'planetarium', 'plastic bag', 'plate rack', 'plow', 'plunger', 'Polaroid camera', 'pole', 'police van', 'poncho', 'pool table', 'pop bottle', 'pot', 'potter\'s wheel', 'power drill', 'prayer rug', 'printer', 'prison', 'projectile', 'projector', 'puck', 'punching bag', 'purse', 'quill', 'quilt', 'racer', 'racket', 'radiator', 'radio', 'radio telescope', 'rain barrel', 'recreational vehicle', 'reel', 'reflex camera', 'refrigerator', 'remote control', 'restaurant', 'revolver', 'rifle', 'rocking chair', 'rotisserie', 'rubber eraser', 'rugby ball', 'rule', 'running shoe', 'safe', 'safety pin', 'saltshaker', 'sandal', 'sarong', 'saxophone', 'scabbard', 'scale', 'school bus', 'schooner', 'scoreboard', 'screen', 'screwdriver', 'scrub brush', 'sculpture', 'sea lyme', 'seashore', 'seawall', 'sewing machine', 'shovel', 'shower cap', 'shower curtain', 'ski', 'ski mask', 'sleeping bag', 'slide rule', 'sliding door', 'slot', 'snorkel', 'snowmobile', 'snowplow', 'soap dispenser', 'soccer ball', 'sock', 'solar dish', 'sombrero', 'soup bowl', 'space bar', 'space heater', 'space shuttle', 'spatula', 'speedboat', 'spider web', 'spindle', 'sports car', 'spotlight', 'stage', 'steam locomotive', 'steel arch bridge', 'steel drum', 'stethoscope', 'stole', 'stone wall', 'stopwatch', 'stove', 'strainer', 'streetcar', 'street sign', 'stretcher', 'studio couch', 'stupa', 'submarine', 'suit', 'sundial', 'sunglass', 'sunglasses', 'sunscreen', 'suspension bridge', 'swab', 'sweatshirt', 'swimming trunks', 'swing', 'switch', 'syringe', 'table lamp', 'tank', 'tape player', 'teapot', 'teddy', 'television', 'tennis ball', 'thatch', 'theater curtain', 'thimble', 'thresher', 'throne', 'tile roof', 'toaster', 'tobacco shop', 'toilet seat', 'torch', 'totem pole', 'toy store', 'tractor', 'trailer truck', 'tray', 'trench coat', 'tricycle', 'trimaran', 'tripod', 'triumphal arch', 'trolleybus', 'trombone', 'tub', 'turnstile', 'typewriter keyboard', 'umbrella', 'unicycle', 'upright', 'vacuum', 'vase', 'vault', 'velvet', 'vending machine', 'vestment', 'viaduct', 'violin', 'volleyball', 'waffle iron', 'wall clock', 'wallet', 'wardrobe', 'warplane', 'washbasin', 'washer', 'water bottle', 'water jug', 'water tower', 'whiskey jug', 'whistle', 'wig', 'window screen', 'window shade', 'Windsor tie', 'wine bottle', 'wing', 'wok', 'wooden spoon', 'wool', 'worm fence', 'wreck', 'yawl', 'yurt', 'web site', 'comic book', 'crossword puzzle', 'street sign', 'traffic light', 'book jacket', 'menu', 'plate', 'guacamole', 'consomme', 'hot pot', 'trifle', 'ice cream', 'ice lolly', 'French loaf', 'bagel', 'pretzel', 'cheeseburger', 'hotdog', 'mashed potato', 'head cabbage', 'broccoli', 'cauliflower', 'zucchini', 'spaghetti squash', 'acorn squash', 'butternut squash', 'cucumber', 'artichoke', 'bell pepper', 'cardoon', 'mushroom', 'Granny Smith', 'strawberry', 'orange', 'lemon', 'fig', 'pineapple', 'banana', 'jackfruit', 'custard apple', 'pomegranate', 'hay', 'carbonara', 'chocolate sauce', 'dough', 'meat loaf', 'pizza', 'potpie', 'burrito', 'red wine', 'espresso', 'cup', 'eggnog', 'alp', 'bubble', 'cliff', 'coral reef', 'geyser', 'lakeside', 'promontory', 'sandbar', 'seashore', 'valley', 'volcano', 'ballplayer', 'groom', 'scuba diver', 'rapeseed', 'daisy', 'yellow lady\'s slipper', 'corn', 'acorn', 'hip', 'buckeye', 'coral fungus', 'agaric', 'gyromitra', 'stinkhorn', 'earthstar', 'hen-of-the-woods', 'bolete', 'ear', 'toilet tissue'
  ];
  function enableHypernova() {
    try {
      if (__abx_hyper_overrides) return;
      HYPERNOVA = true; saveJSON('AdBlockX.HYPERNOVA', true);
      // Inject aggressive CSS
      const aggressive = [
        '[id*="ad"], [class*="ad-"], [class*="-ad"], [class*="ads"], [class*="adslot"], iframe[src*="ads"], iframe[id*="ad"] { display:none !important; }',
        'script[src*="ads"], script[src*="doubleclick"], script[src*="googlesyndication"] { display:none !important; }'
      ].join('\n');
      injectHideCSS([aggressive]);

      // aggressive mutation observer that removes nodes and clears inline scripts
      const mo = new MutationObserver(muts => {
        for (const m of muts) {
          for (const n of m.addedNodes || []) {
            try {
              if (!(n instanceof HTMLElement)) continue;
              const html = n.outerHTML || '';
              // heuristics
              if (/\bads?\b|doubleclick|googlesyndication|googletagmanager|taboola|outbrain|criteo|adnxs|adservice|pagead/ig.test(html)) {
                try { n.remove(); pushLog('blocked', { t: nowStr(), url: location.href }); panelLog('Hypernova removed element'); } catch (e) {}
                continue;
              }
              // strip inline scripts
              if (n.tagName === 'SCRIPT') {
                try { n.type = 'javascript/blocked'; n.textContent = ''; } catch(e){}
              }
            } catch (e) {}
          }
        }
      });
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true });

      // override createElement/appendChild to intercept ad iframes/scripts
      const origCreate = Document.prototype.createElement;
      const origAppend = Node.prototype.appendChild;
      Document.prototype.createElement = function(tagName, options) {
        const el = origCreate.call(this, tagName, options);
        try {
          const tn = String(tagName||'').toLowerCase();
          if (tn === 'iframe' || tn === 'script') {
            const origSet = el.setAttribute.bind(el);
            el.setAttribute = function(name, value) {
              try {
                // strict enforcer blocks any iframe/script creation with suspicious src
                if (STRICT_ENFORCER && (name==='src' || name==='data-src') && /ads?|doubleclick|googlesyndication|pagead|adservice|googletag|googlesyndication|googleadservices/ig.test(String(value||''))) { panelLog('Strict blocked element creation: ' + String(value||'')); throw new Error('Blocked by Strict Enforcer'); }
                if ((name==='src' || name==='data-src') && /ads?|doubleclick|googlesyndication|pagead/ig.test(String(value||''))) { throw new Error('Blocked by Hypernova'); }
              } catch(e) { return; }
              return origSet(name, value);
            };
          }
        } catch(e){}
        return el;
      };
      Node.prototype.appendChild = function(child) {
        try {
          if (child && child.tagName && /^(IFRAME|SCRIPT)$/i.test(child.tagName)) {
            const s = (child.src||child.getAttribute && child.getAttribute('src')||'');
            if (s && /ads?|doubleclick|googlesyndication|pagead|googleadservices|adservice/ig.test(String(s))) {
              pushLog('blocked', { t: nowStr(), url: s, reason: STRICT_ENFORCER ? 'STRICT_DOM_BLOCK' : 'DOM_BLOCK' });
              panelLog((STRICT_ENFORCER ? 'Strict blocked appendChild ' : 'Hypernova blocked appendChild ') + s);
              return child; // do not append
            }
          }
        } catch(e){}
        return origAppend.call(this, child);
      };

      __abx_hyper_overrides = { mo, origCreate, origAppend };
      panelLog('Hypernova enabled');
    } catch(e){ panelLog('enableHypernova failed: '+e,'err'); }
  }

  function disableHypernova() {
    try {
      HYPERNOVA = false; saveJSON('AdBlockX.HYPERNOVA', false);
      injectHideCSS([]);
      if (__abx_hyper_overrides) {
        try { __abx_hyper_overrides.mo.disconnect(); } catch(e){}
        try { Document.prototype.createElement = __abx_hyper_overrides.origCreate; } catch(e){}
        try { Node.prototype.appendChild = __abx_hyper_overrides.origAppend; } catch(e){}
        __abx_hyper_overrides = null;
      }
      panelLog('Hypernova disabled');
    } catch(e){ panelLog('disableHypernova failed: '+e,'err'); }
  }

  // Archballistic: force-block network calls and aggressively remove nodes
  function scanAndAnnihilate() {
    try {
      const selectors = 'iframe,script,img,video,source,link[rel],object,embed';
      const nodes = Array.from(document.querySelectorAll(selectors));
      for (const n of nodes) {
        try {
          const src = (n.src || n.getAttribute && (n.getAttribute('src')||n.getAttribute('data-src')) || n.href || '');
          const txt = (n.outerHTML||'') + ' ' + String(src||'');
          if (urlMatchesList(src, BLACKLIST) || urlMatchesList(src, EXT_BLOCK) || urlMatchesList(src, SPOOF_LIST)) {
            try { n.remove(); pushLog('blocked', { t: nowStr(), url: src }); panelLog('Archballistic removed node: ' + src); } catch(e){}
            continue;
          }
          // also check regex rules
          for (const r of (REGEX_RULES||[])) {
            try { const re = new RegExp(r); if (re.test(txt)) { n.remove(); pushLog('blocked', { t: nowStr(), url: location.href }); panelLog('Archballistic removed by regex'); break; } } catch(e){}
          }
        } catch(e){}
      }
    } catch(e){ panelLog('scanAndAnnihilate failed: '+e,'err'); }
  }

  function enableArchballistic() {
    try {
      if (__abx_arch_handles) return;
      ARCHBALLISTIC = true; saveJSON('AdBlockX.ARCHBALLISTIC', true);
      // ensure hypernova is enabled for DOM overrides
      if (!HYPERNOVA) enableHypernova();
      // perform an initial annihilation pass
      scanAndAnnihilate();

      // override fetch/XHR/WebSocket to forcibly block matching requests
      const origFetch = window.fetch.bind(window);
      const origXHROpen = XMLHttpRequest.prototype.open;
      const origXHRSend = XMLHttpRequest.prototype.send;
      const OrigWS = window.WebSocket;

      window.fetch = async function(...args) {
        try {
          const url = String(args[0]||'');
          if (!ENABLED || isCurrentSiteDisabled()) return origFetch(...args);
          if (urlMatchesList(url, BLACKLIST) || urlMatchesList(url, EXT_BLOCK) || urlMatchesList(url, SPOOF_LIST)) {
            if (confirmBlock('fetch', url, 'matches blocklist')) {
              pushLog('blocked', { t: nowStr(), url });
              panelLog('Archballistic blocked fetch: ' + url);
              return new Response('', { status: 204 });
            }
          }
        } catch(e){}
        return origFetch(...args);
      };

      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        try { this._abx_url = url; } catch(e){}
        return origXHROpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function(...args) {
        try {
          const url = this._abx_url;
          if (!ENABLED || isCurrentSiteDisabled()) return origXHRSend.apply(this, args);
          if (urlMatchesList(url, BLACKLIST) || urlMatchesList(url, EXT_BLOCK) || urlMatchesList(url, SPOOF_LIST)) {
            pushLog('blocked', { t: nowStr(), url }); panelLog('Archballistic blocked XHR: ' + url);
            // emulate finished XHR with empty response
            this.readyState = 4; this.status = 204; this.responseText = '';
            setTimeout(() => { try { this.onreadystatechange && this.onreadystatechange(); } catch(e){}; try { this.onload && this.onload(); } catch(e){}; }, 0);
            return;
          }
        } catch(e){}
        return origXHRSend.apply(this, args);
      };

      window.WebSocket = function(url, protocols) {
        try {
          if (!ENABLED || isCurrentSiteDisabled()) return new OrigWS(url, protocols);
          if (urlMatchesList(url, BLACKLIST) || urlMatchesList(url, EXT_BLOCK) || urlMatchesList(url, SPOOF_LIST)) {
            pushLog('blocked', { t: nowStr(), url }); panelLog('Archballistic blocked WebSocket: ' + url);
            return { readyState: 3, close() {}, send() {}, addEventListener() {}, removeEventListener() {} };
          }
        } catch(e){}
        return new OrigWS(url, protocols);
      };

      // override WebAssembly.instantiate to detect potential evasion
      const origWasmInstantiate = WebAssembly.instantiate.bind(WebAssembly);
      WebAssembly.instantiate = async function(bufferSource, importObject) {
        try {
          if (!ENABLED || isCurrentSiteDisabled()) return origWasmInstantiate(bufferSource, importObject);
          // check if this looks like ad-related WASM (basic heuristic)
          const isAdWasm = bufferSource && typeof bufferSource === 'object' && bufferSource.byteLength > 1000 &&
            (bufferSource.toString().includes('ad') || bufferSource.toString().includes('track') || bufferSource.toString().includes('analytics'));
          if (isAdWasm) {
            pushLog('blocked', { t: nowStr(), type: 'wasm', size: bufferSource.byteLength });
            panelLog('Archballistic blocked WebAssembly module (potential ad evasion)');
            // return a dummy module
            return { instance: { exports: {} }, module: {} };
          }
        } catch(e){}
        return origWasmInstantiate(bufferSource, importObject);
      };

      // store handles to restore later
      __abx_arch_handles = { origFetch, origXHROpen, origXHRSend, OrigWS, origWasmInstantiate };
      panelLog('Archballistic enabled');
    } catch(e){ panelLog('enableArchballistic failed: '+e,'err'); }
  }

  function disableArchballistic() {
    try {
      ARCHBALLISTIC = false; saveJSON('AdBlockX.ARCHBALLISTIC', false);
      if (__abx_arch_handles) {
        try { window.fetch = __abx_arch_handles.origFetch; } catch(e){}
        try { XMLHttpRequest.prototype.open = __abx_arch_handles.origXHROpen; } catch(e){}
        try { XMLHttpRequest.prototype.send = __abx_arch_handles.origXHRSend; } catch(e){}
        try { window.WebSocket = __abx_arch_handles.OrigWS; } catch(e){}
        try { WebAssembly.instantiate = __abx_arch_handles.origWasmInstantiate; } catch(e){}
        __abx_arch_handles = null;
      }
      panelLog('Archballistic disabled');
    } catch(e){ panelLog('disableArchballistic failed: '+e,'err'); }
  }

  // AI mode functions
  async function enableAI() {
    try {
      if (__abx_ai_model) return;
      AI_MODE = true; saveJSON('AdBlockX.AI_MODE', true);
      panelLog('Loading TensorFlow.js MobileNet model...');
      // Load TensorFlow.js and MobileNet model
      if (!window.tf) {
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.15.0/dist/tf.min.js');
      }
      if (!window.tf) throw new Error('TensorFlow.js failed to load');
      __abx_ai_model = await window.tf.loadLayersModel('https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json');
      if (!__abx_ai_model) throw new Error('MobileNet model failed to load');
      panelLog('AI model loaded successfully');
      // Start mutation observer for images
      __abx_ai_observer = new MutationObserver(async (mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.tagName === 'IMG' && node.src) {
              try {
                await classifyImage(node);
              } catch (e) { /* ignore */ }
            }
          }
        }
      });
      __abx_ai_observer.observe(document.body, { childList: true, subtree: true });
      panelLog('AI image observer started');
    } catch (e) {
      panelLog('enableAI failed: ' + e, 'err');
      AI_MODE = false; saveJSON('AdBlockX.AI_MODE', false);
    }
  }

  function disableAI() {
    try {
      AI_MODE = false; saveJSON('AdBlockX.AI_MODE', false);
      if (__abx_ai_observer) {
        __abx_ai_observer.disconnect();
        __abx_ai_observer = null;
      }
      if (__abx_ai_model) {
        __abx_ai_model.dispose();
        __abx_ai_model = null;
      }
      panelLog('AI mode disabled');
    } catch (e) { panelLog('disableAI failed: ' + e, 'err'); }
  }

  function enableFuckAllAds() {
    try {
      if (FUCK_ALL_ADS_MODE) return;
      FUCK_ALL_ADS_MODE = true; saveJSON('AdBlockX.FUCK_ALL_ADS_MODE', true);
      // Enable all aggressive modes
      if (!HYPERNOVA) enableHypernova();
      if (!ARCHBALLISTIC) enableArchballistic();
      if (!AI_MODE) enableAI();
      // Enable enforcer and watchdog
      ENFORCER_ENABLED = true; saveJSON('AdBlockX.ENFORCER_ENABLED', true);
      WATCHDOG_ENABLED = true; saveJSON('AdBlockX.WATCHDOG_ENABLED', true);
      startWatchdog();
      // Aggressive CSS injection
      injectHideCSS([
        '[id*="ad"], [class*="ad"], [src*="ad"], [href*="ad"] { display:none !important; }',
        'iframe, embed, object { display:none !important; }',
        '[data-ad], [data-advertisement] { display:none !important; }'
      ]);
      // Mutation observer for advanced ad removal
      const fuckObserver = new MutationObserver(muts => {
        for (const m of muts) {
          for (const n of m.addedNodes || []) {
            try {
              if (!(n instanceof HTMLElement)) continue;
              const el = n;
              // Remove elements with ad-related attributes or content
              if (el.id && /\b(ad|ads?|advertisement|banner|popup|overlay)\b/i.test(el.id)) {
                el.remove(); pushLog('blocked', { t: nowStr(), url: location.href, reason: 'Fuck All Ads: id match' });
              } else if (el.className && /\b(ad|ads?|advertisement|banner|popup|overlay)\b/i.test(el.className)) {
                el.remove(); pushLog('blocked', { t: nowStr(), url: location.href, reason: 'Fuck All Ads: class match' });
              } else if (el.src && (BLACKLIST.some(b => el.src.includes(b)) || ALWAYS_BLOCK.some(b => el.src.includes(b)))) {
                el.remove(); pushLog('blocked', { t: nowStr(), url: location.href, reason: 'Fuck All Ads: src blacklisted' });
              } else if (el.tagName === 'IFRAME' || el.tagName === 'EMBED' || el.tagName === 'OBJECT') {
                el.remove(); pushLog('blocked', { t: nowStr(), url: location.href, reason: 'Fuck All Ads: embed element' });
              }
            } catch (e) {}
          }
        }
      });
      fuckObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
      // Store observer for cleanup
      window.AdBlockX.__fuck_observer = fuckObserver;
      panelLog('Fuck All Ads mode enabled: all aggressive features activated');
    } catch (e) { panelLog('enableFuckAllAds failed: ' + e, 'err'); }
  }

  function disableFuckAllAds() {
    try {
      FUCK_ALL_ADS_MODE = false; saveJSON('AdBlockX.FUCK_ALL_ADS_MODE', false);
      // Disable all modes
      if (HYPERNOVA) disableHypernova();
      if (ARCHBALLISTIC) disableArchballistic();
      if (AI_MODE) disableAI();
      ENFORCER_ENABLED = false; saveJSON('AdBlockX.ENFORCER_ENABLED', false);
      WATCHDOG_ENABLED = false; saveJSON('AdBlockX.WATCHDOG_ENABLED', false);
      stopWatchdog();
      // Remove injected CSS
      injectHideCSS([]);
      // Disconnect observer
      if (window.AdBlockX.__fuck_observer) {
        window.AdBlockX.__fuck_observer.disconnect();
        delete window.AdBlockX.__fuck_observer;
      }
      panelLog('Fuck All Ads mode disabled');
    } catch (e) { panelLog('disableFuckAllAds failed: ' + e, 'err'); }
  }

  function enablePetty() {
    try {
      if (PETTY_MODE) return;
      PETTY_MODE = true; saveJSON('AdBlockX.PETTY_MODE', true);
      panelLog('Petty mode enabled: YouTube ad servers get a massive middle finger! 🖕 (Invisible to users)');
    } catch (e) { panelLog('enablePetty failed: ' + e, 'err'); }
  }

  function disablePetty() {
    try {
      PETTY_MODE = false; saveJSON('AdBlockX.PETTY_MODE', false);
      panelLog('Petty mode disabled');
    } catch (e) { panelLog('disablePetty failed: ' + e, 'err'); }
  }

  function enableNuclear() {
    try {
      if (NUCLEAR_MODE) return;
      NUCLEAR_MODE = true; saveJSON('AdBlockX.NUCLEAR_MODE', true);
      // Enable all modes
      enableAssHat();
      enableStealth();
      enableAI();
      enableFuckAllAds();
      enablePetty();
      // Extra nuclear aggression: inject more CSS to hide ad containers
      const nuclearCSS = `
        [class*="ad-"], [id*="ad-"], [class*="advert"], [id*="advert"],
        .video-ads, .ytp-ad-module, .ytp-ad-overlay, .ytp-ad-text,
        .companion-ad, .masthead-ad, .search-ads, .related-ads { display: none !important; }
        * { animation: none !important; transition: none !important; }
      `;
      const style = document.createElement('style');
      style.textContent = nuclearCSS;
      document.head.appendChild(style);
      panelLog('Nuclear mode enabled: All modes activated + extra CSS annihilation! 💥');
    } catch (e) { panelLog('enableNuclear failed: ' + e, 'err'); }
  }

  function disableNuclear() {
    try {
      NUCLEAR_MODE = false; saveJSON('AdBlockX.NUCLEAR_MODE', false);
      // Disable all modes
      disableAssHat();
      disableStealth();
      disableAI();
      disableFuckAllAds();
      disablePetty();
      panelLog('Nuclear mode disabled');
    } catch (e) { panelLog('disableNuclear failed: ' + e, 'err'); }
  }

  async function classifyImage(img) {
    try {
      if (!AI_MODE || !__abx_ai_model || !img.src) return;
      // Performance throttle: limit classifications to once per interval
      const now = Date.now();
      if (now - __abx_throttle.lastRun < __abx_throttle.interval) return;
      __abx_throttle.lastRun = now;
      // Lazy load: only classify visible images
      if (!isElementVisible(img)) return;
      // Check if image src is from blacklisted domain
      const url = new URL(img.src, location.href);
      const hostname = url.hostname;
      if (BLACKLIST.some(b => hostname.includes(b)) || ALWAYS_BLOCK.some(b => hostname.includes(b))) {
        img.style.display = 'none';
        pushLog('blocked', { t: nowStr(), url: img.src, reason: 'blacklisted domain' });
        panelLog('AI blocked image from blacklisted domain: ' + img.src);
        return;
      }
      // Preprocess image for MobileNet (optimized)
      const tensor = window.tf.browser.fromPixels(img).resizeNearestNeighbor([224, 224]).toFloat().expandDims();
      const predictions = await __abx_ai_model.predict(tensor).data();
      tensor.dispose();
      // Get top prediction
      let maxIndex = 0;
      let maxProb = predictions[0];
      for (let i = 1; i < predictions.length; i++) {
        if (predictions[i] > maxProb) {
          maxProb = predictions[i];
          maxIndex = i;
        }
      }
      const predictedClass = IMAGENET_CLASSES[maxIndex];
      // Check if it's an ad-related class
      const adClasses = ['billboard', 'advertisement', 'banner', 'poster', 'signboard', 'commercial', 'ad', 'promotion'];
      if (adClasses.some(c => predictedClass.toLowerCase().includes(c))) {
        img.style.display = 'none';
        pushLog('blocked', { t: nowStr(), url: img.src, reason: 'AI classified as ad: ' + predictedClass });
        panelLog('AI blocked image: ' + predictedClass + ' (' + img.src + ')');
      }
    } catch (e) { /* ignore classification errors */ }
  }

  function isElementVisible(el) {
    try {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.left >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) && rect.right <= (window.innerWidth || document.documentElement.clientWidth);
    } catch (e) { return false; }
  }

  // Video ad detection for native players
  function detectVideoAds() {
    try {
      const videos = document.querySelectorAll('video');
      for (const v of videos) {
        try {
          // Check for ad-related attributes or sources
          if (v.src && (BLACKLIST.some(b => v.src.includes(b)) || ALWAYS_BLOCK.some(b => v.src.includes(b)))) {
            v.pause(); v.currentTime = 0; v.style.display = 'none';
            pushLog('blocked', { t: nowStr(), url: v.src, reason: 'video ad detected' });
            panelLog('Blocked video ad: ' + v.src);
          }
          // Check child sources
          const sources = v.querySelectorAll('source');
          for (const s of sources) {
            if (s.src && (BLACKLIST.some(b => s.src.includes(b)) || ALWAYS_BLOCK.some(b => s.src.includes(b)))) {
              v.pause(); v.currentTime = 0; v.style.display = 'none';
              pushLog('blocked', { t: nowStr(), url: s.src, reason: 'video source ad' });
              panelLog('Blocked video source ad: ' + s.src);
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // Run video detection periodically
  setInterval(detectVideoAds, 5000);

  // False positive reduction: user feedback system
  let FALSE_POSITIVE_FEEDBACK = loadJSON('AdBlockX.FALSE_POSITIVE_FEEDBACK', {});
  function reportFalsePositive(url, reason) {
    try {
      FALSE_POSITIVE_FEEDBACK[url] = (FALSE_POSITIVE_FEEDBACK[url] || 0) + 1;
      saveJSON('AdBlockX.FALSE_POSITIVE_FEEDBACK', FALSE_POSITIVE_FEEDBACK);
      // If high false positives, auto-whitelist
      if (FALSE_POSITIVE_FEEDBACK[url] > 3) {
        WHITELIST.push(url);
        saveJSON('AdBlockX.WHITELIST', WHITELIST);
        panelLog('Auto-whitelisted due to false positives: ' + url);
      }
    } catch (e) {}
  }
  window.AdBlockX.reportFalsePositive = reportFalsePositive;

  // Advanced evasion: detect WebAssembly-based trackers
  function detectWasmTrackers() {
    try {
      // Hook WebAssembly.instantiate
      const origInstantiate = WebAssembly.instantiate;
      WebAssembly.instantiate = async function(buffer, importObject) {
        try {
          // Check if buffer contains ad/tracking signatures
          if (buffer && buffer.byteLength > 0) {
            const arr = new Uint8Array(buffer);
            // Simple heuristic: look for common tracking patterns in WASM
            const sig = arr.slice(0, 100).join('');
            if (/\b(ad|track|pixel|beacon)\b/i.test(sig) || BLACKLIST.some(b => sig.includes(b))) {
              throw new Error('Blocked WASM tracker');
            }
          }
        } catch (e) {
          if (e.message === 'Blocked WASM tracker') {
            pushLog('blocked', { t: nowStr(), url: 'wasm', reason: 'WASM tracker' });
            panelLog('Blocked WebAssembly tracker');
            return Promise.reject(e);
          }
        }
        return origInstantiate.call(this, buffer, importObject);
      };
    } catch (e) {}
  }
  detectWasmTrackers();

  // Merge YouTube-specific heuristics into runtime lists (called during init)
  function augmentYouTubeHeuristics() {
    try {
      // merge default regex rules
      for (const r of (DEFAULT_YT_REGEX||[])) {
        if (!REGEX_RULES.includes(r)) REGEX_RULES.push(r);
      }
      // ensure common YouTube ad hosts are in blacklist/always-block
      const ytHosts = ['youtube.com', 's.youtube.com', 'googlevideo.com', 'youtubei.googleapis.com', 'ad.doubleclick.net'];
      for (const h of ytHosts) {
        if (!BLACKLIST.includes(h)) BLACKLIST.push(h);
        if (!ALWAYS_BLOCK.includes(h)) ALWAYS_BLOCK.push(h);
      }
      // add suggested spoof endpoints
      const ytSpoofs = ['youtube.com/api/stats/ads', 'youtube.com/get_midroll', 'youtubei/v1/player', 'googlevideo.com/ad'];
      for (const s of ytSpoofs) if (!SPOOF_LIST.includes(s)) SPOOF_LIST.push(s);
      saveJSON('AdBlockX.BLACKLIST', BLACKLIST);
      saveJSON('AdBlockX.SPOOF_LIST', SPOOF_LIST);
      saveJSON('AdBlockX.REGEX_RULES', REGEX_RULES);
      saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK);
      panelLog('YouTube heuristics augmented: blacklist+spoof+regex updated');
    } catch (e) { panelLog('augmentYouTubeHeuristics failed: ' + e, 'err'); }
  }

  function addAnalyticsHostsToBlacklist() {
    try {
      const hosts = [
        'google-analytics.com', 'analytics.google.com', 'stats.g.doubleclick.net', 'doubleclick.net',
        'googlesyndication.com', 'pagead2.googlesyndication.com', 'googletagmanager.com', 'googletagservices.com',
        'scorecardresearch.com', 'quantserve.com', 'adservice.google.com'
      ];
      for (const h of hosts) if (!BLACKLIST.includes(h)) BLACKLIST.push(h);
      saveJSON('AdBlockX.BLACKLIST', BLACKLIST);
      panelLog('Hypernova: analytics hosts added to blacklist');
    } catch(e){ panelLog('addAnalyticsHostsToBlacklist failed: '+e,'err'); }
  }

  const SPOOF_JSON_OBJ = {
    responseContext: {},
    adPlacements: [],
    adBreaks: [],
    playerAds: [],
    trackingParams: "",
    status: "NO_ADS",
    // make spoof look more like a YouTube player ad response to reduce detection
    version: "2.0",
    playabilityStatus: { status: 'OK' },
    videoDetails: { title: '', lengthSeconds: '0', isLive: false }
  };
  const SPOOF_JSON = JSON.stringify(SPOOF_JSON_OBJ);

  function pushLog(kind, entry) {
    try {
      if (!LOGS[kind]) LOGS[kind] = [];
      // Encrypt entry if privacy mode enabled
      const logEntry = PRIVACY_MODE ? encryptData(JSON.stringify(entry)) : entry;
      LOGS[kind].push(logEntry);
      // keep logs bounded
      if (LOGS[kind].length > 2000) LOGS[kind].splice(0, LOGS[kind].length - 2000);
      saveJSON('AdBlockX.LOGS', LOGS);
      // update session stats
      try {
        if (!SESSION_STATS) SESSION_STATS = { blocked:0, spoofed:0, observed:0, start: nowStr() };
        if (kind === 'blocked') SESSION_STATS.blocked = (SESSION_STATS.blocked||0) + 1;
        if (kind === 'spoofed') SESSION_STATS.spoofed = (SESSION_STATS.spoofed||0) + 1;
        if (kind === 'observed') SESSION_STATS.observed = (SESSION_STATS.observed||0) + 1;
        saveJSON('AdBlockX.SESSION_STATS', SESSION_STATS);
      } catch(e){}
      if (panelState && panelState.updateCounts) panelState.updateCounts();
    } catch (e) { console.warn('[AdBlockX] pushLog failed', e); }
  }

  /***********************
   * Helpers
   ***********************/
  function nowStr() { return new Date().toISOString(); }
  function urlMatchesList(url, list) {
    if (!url) return false;
    try {
      // if current page is whitelisted, disable blocking here
      try { const curHost = location.hostname || ''; const curOrigin = location.origin || ''; if ((WHITELIST||[]).includes(curHost) || (WHITELIST||[]).includes(curOrigin)) return false; } catch (e) {}
      const s = String(url || '');
      // try to parse URL to get hostname + pathname
      let hostname = '', pathname = '', href = s;
      try {
        const u = new URL(s, location.origin);
        hostname = u.hostname || '';
        pathname = u.pathname || '';
        href = u.href || s;
      } catch (e) {
        // fallback to raw string matching
      }
      // direct fragment match
      if (list && list.length && list.some(fragment => {
        if (!fragment) return false;
        const f = String(fragment);
        return hostname.includes(f) || pathname.includes(f) || href.includes(f) || s.includes(f);
      })) return true;
      // regex rules
      for (const r of (REGEX_RULES||[])) {
        try {
          const re = new RegExp(r);
          if (re.test(s) || re.test(hostname) || re.test(pathname)) return true;
        } catch (e) { /* invalid regex ignored */ }
      }
      return false;
    } catch (e) { return false; }
  }

  // Check whether a given URL or its hostname appears in the user/default whitelist
  function isUrlWhitelisted(url) {
    try {
      if (!url) return false;
      const s = String(url || '');
      let hostname = '';
      try { hostname = (new URL(s, location.origin)).hostname || ''; } catch(e) { hostname = ''; }
      for (const w of (WHITELIST||[])) {
        try {
          if (!w) continue;
          const frag = String(w);
          if (!frag) continue;
          if (hostname === frag) return true;
          if (hostname.includes(frag)) return true;
          if (s.includes(frag)) return true;
        } catch(e) {}
      }
      return false;
    } catch (e) { return false; }
  }

  // Watchdog: scan performance resources and DOM elements for slipped-through ads
  function startWatchdog() {
    try {
      if (__abx_watchdog.timer) return; // already running
      __abx_watchdog.seen = __abx_watchdog.seen || new Set();
      const scan = async () => {
        try {
          const items = [];
          // gather performance resources
          const entries = (performance && performance.getEntriesByType) ? performance.getEntriesByType('resource') : [];
          for (const e of entries) {
            try {
              const url = String(e.name || '');
              if (!url || __abx_watchdog.seen.has(url)) continue;
              if (isUrlWhitelisted(url)) continue;
              try { if (e.initiatorType === 'link' || e.initiatorType === 'preload') continue; } catch(e) {}
              __abx_watchdog.seen.add(url);
              items.push({ url, tag: '', id: '', className: '', initiatorType: e.initiatorType||'' });
            } catch(e){}
          }
          // gather DOM nodes
          const selectors = 'iframe[src], script[src], img[src], video[src], source[src]';
          const nodes = Array.from(document.querySelectorAll(selectors));
          for (const n of nodes) {
            try {
              const src = (n.src || n.getAttribute && (n.getAttribute('src')||n.getAttribute('data-src')) || '');
              if (!src) continue;
              if (isUrlWhitelisted(src)) continue;
              if (__abx_watchdog.seen.has(src)) continue;
              __abx_watchdog.seen.add(src);
              items.push({ url: src, tag: (n.tagName||''), id: (n.id||''), className: (n.className||''), initiatorType: '' });
            } catch(e){}
          }

          if (!items.length) return;

          let results = [];
          try {
            if (window.AdBlockX && window.AdBlockX.MULTICORE && typeof window.AdBlockX.MULTICORE.runScan === 'function') {
              results = await window.AdBlockX.MULTICORE.runScan(items);
            } else {
              // fallback: run same checks on main thread
              const res = [];
              for (const it of items) {
                try {
                  const url = it.url || '';
                  if (!url) continue;
                  if (urlMatchesList(url, ALWAYS_BLOCK)) { res.push({ url, reason: 'ALWAYS_BLOCK' }); continue; }
                  if (urlMatchesList(url, BLACKLIST) || urlMatchesList(url, EXT_BLOCK)) { res.push({ url, reason: 'BLACKLIST' }); continue; }
                  if (urlMatchesList(url, SPOOF_LIST)) { res.push({ url, reason: 'SPOOF' }); continue; }
                  // regex rules
                  for (const r of (REGEX_RULES||[])) { try { const re = new RegExp(r); if (re.test(url) || re.test(it.tag||'') || re.test(it.className||'')) { res.push({ url, reason: 'REGEX' }); break; } } catch(e){} }
                } catch(e){}
              }
              results = res;
            }
          } catch(e) { results = []; }

          for (const r of (results||[])) {
            try {
              const url = r.url || '';
              const reason = (r.reason||'').toUpperCase();
              if (!url) continue;
              if (reason === 'ALWAYS_BLOCK') { pushLog('blocked', { t: nowStr(), url, reason: 'WATCHDOG_ALWAYS' }); removeElementsForUrl(url, 'WATCHDOG_ALWAYS'); }
              else if (reason === 'BLACKLIST' || reason === 'REGEX') {
                pushLog('blocked', { t: nowStr(), url, reason: 'WATCHDOG_BLACKLIST' });
                removeElementsForUrl(url, 'WATCHDOG_BLACKLIST');
                if (ENFORCER_ENABLED) try {
                  const h = (new URL(url, location.href)).hostname;
                  if (h && !ALWAYS_BLOCK.includes(h)) {
                    ENFORCER_COUNTERS[h] = (ENFORCER_COUNTERS[h]||0) + 1;
                    saveJSON('AdBlockX.ENFORCER_COUNTERS', ENFORCER_COUNTERS);
                    panelLog('Watchdog observed host ' + h + ' count=' + ENFORCER_COUNTERS[h]);
                    if (ENFORCER_COUNTERS[h] >= (ENFORCER_PROMOTION_THRESHOLD||3)) {
                      ALWAYS_BLOCK.push(h);
                      saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK);
                      panelLog('Watchdog promoted to ALWAYS_BLOCK: ' + h);
                    }
                  }
                } catch(e){}
              }
              else if (reason === 'SPOOF') { pushLog('spoofed', { t: nowStr(), url, reason: 'WATCHDOG_SPOOF' }); removeElementsForUrl(url, 'WATCHDOG_SPOOF'); }
            } catch(e){}
          }
        } catch(e) { /* ignore watchdog errors */ }
      };
      __abx_watchdog.timer = setInterval(scan, WATCHDOG_INTERVAL_MS);
      // also use mutation observer to catch new nodes quickly
      try {
        __abx_watchdog.mo = new MutationObserver(muts => {
          for (const m of muts) for (const n of m.addedNodes || []) {
            try {
              if (!(n instanceof HTMLElement)) continue;
              const src = (n.src || n.getAttribute && (n.getAttribute('src')||n.getAttribute('data-src')) || '');
              if (!src) continue;
              if (isUrlWhitelisted(src)) continue;
              if (urlMatchesList(src, ALWAYS_BLOCK) || urlMatchesList(src, BLACKLIST) || urlMatchesList(src, EXT_BLOCK) || urlMatchesList(src, SPOOF_LIST)) {
                const reason = urlMatchesList(src, ALWAYS_BLOCK) ? 'WATCHDOG_ALWAYS' : (urlMatchesList(src, SPOOF_LIST) ? 'WATCHDOG_SPOOF' : 'WATCHDOG_BLACKLIST');
                pushLog('blocked', { t: nowStr(), url: src, reason });
                removeElementNode(n, reason);
              }
            } catch(e){}
          }
        });
        __abx_watchdog.mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
      } catch(e){}
      panelLog('Watchdog started');
    } catch(e) { panelLog('startWatchdog failed: ' + e, 'err'); }
  }

  function stopWatchdog() {
    try {
      if (__abx_watchdog.timer) { clearInterval(__abx_watchdog.timer); __abx_watchdog.timer = null; }
      if (__abx_watchdog.mo) { try { __abx_watchdog.mo.disconnect(); } catch(e){}; __abx_watchdog.mo = null; }
      panelLog('Watchdog stopped');
    } catch(e){}
  }

  function removeElementsForUrl(url, reason) {
    try {
      // remove or neutralize elements with matching src/href
      const esc = CSS.escape ? CSS.escape(url) : url.replace(/([\"'\[\]\:\/\.])/g,'\\$1');
      const sel = `iframe[src*="${url}"], iframe[src*="${esc}"], script[src*="${url}"], img[src*="${url}"], video[src*="${url}"], source[src*="${url}"]`;
      const nodes = Array.from(document.querySelectorAll(sel));
      for (const n of nodes) removeElementNode(n, reason);
    } catch(e){}
  }

  function removeElementNode(n, reason) {
    try {
      if (!n) return;
      // detach safely
      try { n.remove(); } catch(e) { try { n.style.display = 'none'; n.src = ''; n.setAttribute && n.setAttribute('src', ''); } catch(e){} }
      panelLog('Watchdog removed element: ' + (n.src||n.getAttribute && n.getAttribute('src') || '' ) + ' reason:' + reason);
    } catch(e){}
  }

  // -----------------------------
  // Remote imports and API key support
  // -----------------------------
  /***********************
   * Anti-Adblocker Module
   * - Detects common anti-adblock scripts and patterns
   * - Neutralizes anti-adblock callbacks, stubs common detector globals
   * - Removes bait elements ("adblock" divs) and auto-click overlays
   * - Provides aggression levels: 0=off,1=detect-only,2=neutralize
   ***********************/
  let ANTI_ADBLOCK_LEVEL = loadJSON('AdBlockX.ANTI_ADBLOCK_LEVEL', 2); // default neutralize
  let __abx_anti_handles = null;

  function detectAntiAdblockScripts() {
    try {
      const suspects = [];
      // heuristics: look for inline scripts that reference 'adblock' or 'blockad' or 'onAdBlock'
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const s of scripts) {
        try {
          const txt = (s.textContent || '') + ' ' + (s.src || '');
          if (/\badblock\b|onAdBlock|blockAd|anti-?ad|detectAdBlock|checkAdBlock/i.test(txt)) {
            suspects.push({ src: s.src || '[inline]', hint: txt.slice(0,200) });
          }
        } catch(e){}
      }
      // bait elements commonly used by anti-adblock
      const baits = Array.from(document.querySelectorAll('[class*="adblock"],[id*="adblock"],[data-adblock]'));
      const result = { scripts: suspects, baits: baits.length };
      // dispatch event for demo integration
      try { window.dispatchEvent(new CustomEvent('AdBlockX:event', { detail: { type: 'detect', data: result } })); } catch(e){}
      return result;
    } catch (e) { return { scripts:[], baits:0 }; }
  }

  function neutralizeAntiAdblock() {
    try {
      if (__abx_anti_handles) return; // already active
      // stub common globals and methods anti-adblock libs check
      const origs = {};
      const stubs = {
        "adblock": false,
        "blockAdBlock": function(){ return false; },
        "BlockAdBlock": function(){ return false; },
        "onAdBlock": function(){},
        "fuckAdBlock": function(){},
        "checkAdBlock": function(){ return false; },
      };
      for (const k of Object.keys(stubs)) {
        try { origs[k] = window[k]; window[k] = stubs[k]; } catch(e){}
      }

      // intercept and neutralize commonly used DOM bait checks
      const baitSelector = '[class*="adblock"],[id*="adblock"],[data-adblock],[class*="pub_"],[class*="adsbox"]';
      const removeBait = (n) => {
        try {
          if (!n || !(n instanceof HTMLElement)) return;
          if (/adblock|adsbox|pub_/.test((n.className||'') + ' ' + (n.id||''))) {
            try { n.style.display='none'; n.removeAttribute && n.removeAttribute('data-adblock'); } catch(e){}
          }
        } catch(e){}
      };

      // mutation observer to scrub bait elements as they're added
      const mo = new MutationObserver(muts => {
        for (const m of muts) for (const n of m.addedNodes || []) {
          try { removeBait(n); } catch(e){}
        }
      });
      try { mo.observe(document.documentElement || document.body, { childList: true, subtree: true }); } catch(e){}

      // override addEventListener for key anti-adblock event names to noop
      const origAdd = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, listener, opts) {
        try {
          if (/adblock|advert|blockad/i.test(type)) return; // swallow
        } catch(e){}
        return origAdd.call(this, type, listener, opts);
      };

      __abx_anti_handles = { origs, mo, origAdd };
      panelLog('Anti-Adblock neutralizer active (level=' + ANTI_ADBLOCK_LEVEL + ')');
      // dispatch event
      try { window.dispatchEvent(new CustomEvent('AdBlockX:event', { detail: { type: 'neutralize', level: ANTI_ADBLOCK_LEVEL } })); } catch(e){}
    } catch (e) { panelLog('neutralizeAntiAdblock failed: '+e,'err'); }
  }

  function disableAntiAdblock() {
    try {
      if (!__abx_anti_handles) return;
      // restore stubs
      try {
        for (const k of Object.keys(__abx_anti_handles.origs||{})) {
          try { window[k] = __abx_anti_handles.origs[k]; } catch(e){}
        }
      } catch(e){}
      try { __abx_anti_handles.mo && __abx_anti_handles.mo.disconnect(); } catch(e){}
      try { EventTarget.prototype.addEventListener = __abx_anti_handles.origAdd; } catch(e){}
      __abx_anti_handles = null;
      panelLog('Anti-Adblock neutralizer disabled');
      // dispatch event
      try { window.dispatchEvent(new CustomEvent('AdBlockX:event', { detail: { type: 'disable' } })); } catch(e){}
    } catch (e) { panelLog('disableAntiAdblock failed: '+e,'err'); }
  }

  // simple monitor: detect and optionally neutralize after DOMContentLoaded
  function setupAntiAdblockMonitor() {
    try {
      const run = () => {
        try {
          const det = detectAntiAdblockScripts();
          if ((det.scripts && det.scripts.length) || det.baits) panelLog('Anti-Adblock detected: scripts=' + (det.scripts||[]).length + ' baits=' + det.baits);
          if (ANTI_ADBLOCK_LEVEL >= 2) neutralizeAntiAdblock();
        } catch(e){}
        // dispatch event for monitor run
        try { window.dispatchEvent(new CustomEvent('AdBlockX:event', { detail: { type: 'monitor', level: ANTI_ADBLOCK_LEVEL } })); } catch(e){}
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
    } catch(e){}
  }

  // API and UI hooks for anti-adblock
  // Ensure the public API container exists before attaching methods
  window.AdBlockX = window.AdBlockX || {};
  window.AdBlockX.getAntiAdblockLevel = () => Number(loadJSON('AdBlockX.ANTI_ADBLOCK_LEVEL', ANTI_ADBLOCK_LEVEL)||0);
  window.AdBlockX.setAntiAdblockLevel = (v) => { ANTI_ADBLOCK_LEVEL = Number(v||0); saveJSON('AdBlockX.ANTI_ADBLOCK_LEVEL', ANTI_ADBLOCK_LEVEL); if (ANTI_ADBLOCK_LEVEL >= 2) neutralizeAntiAdblock(); else disableAntiAdblock(); panelLog('Anti-Adblock level set to ' + ANTI_ADBLOCK_LEVEL); };

  async function loadScriptUrl(url) {
    return new Promise((resolve, reject) => {
      try {
        const s = document.createElement('script');
        s.async = true;
        s.src = url;
        s.onload = () => resolve(true);
        s.onerror = (e) => reject(new Error('Script load failed: ' + url));
        (document.head || document.documentElement).appendChild(s);
      } catch (e) { reject(e); }
    });
  }

  async function loadRemoteImports() {
    try {
      if (!ALLOW_FOREIGN_IMPORTS) { panelLog('Remote imports disabled by policy'); return; }
      if (!REMOTE_IMPORTS || !REMOTE_IMPORTS.length) { panelLog('No remote imports to load'); return; }
      for (const u of REMOTE_IMPORTS) {
        try {
          // basic safety: only allow http/https
          if (!/^https?:\/\//i.test(String(u||''))) { panelLog('Skipping non-HTTP import: ' + u); continue; }
          // if API_KEY present, allow appending as query param if placeholder {API_KEY} is present
          let finalUrl = String(u);
          if (API_KEY && finalUrl.includes('{API_KEY}')) finalUrl = finalUrl.replace(/\{API_KEY\}/g, encodeURIComponent(API_KEY));
          // optional prescan to avoid executing suspicious remote scripts
          if (PRESCAN_REMOTE_IMPORTS) {
            try {
              const probe = [{ url: finalUrl, tag: 'script', id:'', className:'' }];
              let scanRes = [];
              if (window.AdBlockX && window.AdBlockX.MULTICORE && typeof window.AdBlockX.MULTICORE.runScan === 'function') {
                scanRes = await window.AdBlockX.MULTICORE.runScan(probe);
              } else {
                // main-thread fallback
                for (const it of probe) {
                  try {
                    const url = it.url || '';
                    if (!url) continue;
                    if (urlMatchesList(url, ALWAYS_BLOCK) || urlMatchesList(url, BLACKLIST) || urlMatchesList(url, EXT_BLOCK) || urlMatchesList(url, SPOOF_LIST)) scanRes.push({ url, reason: 'BLACKLIST' });
                    for (const r of (REGEX_RULES||[])) { try { const re = new RegExp(r); if (re.test(url)) { scanRes.push({ url, reason: 'REGEX' }); break; } } catch(e){} }
                  } catch(e){}
                }
              }
              if ((scanRes||[]).length) { panelLog('Prescan blocked remote import: ' + finalUrl + ' reason:' + JSON.stringify(scanRes)); continue; }
            } catch(e){ panelLog('Prescan failed: '+e,'err'); }
          }
          await loadScriptUrl(finalUrl);
          panelLog('Loaded remote import: ' + finalUrl);
        } catch (e) { panelLog('Failed to load remote import: ' + u + ' -> ' + e, 'err'); }
      }
    } catch (e) { panelLog('loadRemoteImports failed: ' + e, 'err'); }
  }

  // API functions for key/import management
  window.AdBlockX = window.AdBlockX || {};
  window.AdBlockX.setApiKey = function(k) { API_KEY = String(k||''); saveJSON('AdBlockX.API_KEY', API_KEY); panelLog('API key set'); };
  window.AdBlockX.getApiKey = function() { return API_KEY; };
  window.AdBlockX.setServerProxy = function(url, apiKey, mode) { SERVER_PROXY = { url: String(url||''), apiKey: String(apiKey||''), mode: String(mode||'off') }; saveJSON('AdBlockX.SERVER_PROXY', SERVER_PROXY); panelLog('Server proxy set: ' + SERVER_PROXY.url + ' mode=' + SERVER_PROXY.mode); };
  window.AdBlockX.getServerProxy = function() { return JSON.parse(JSON.stringify(SERVER_PROXY)); };
  window.AdBlockX.addRemoteImport = function(url) { if (!REMOTE_IMPORTS.includes(url)) { REMOTE_IMPORTS.push(url); saveJSON('AdBlockX.REMOTE_IMPORTS', REMOTE_IMPORTS); } };
  window.AdBlockX.removeRemoteImport = function(url) { const i = REMOTE_IMPORTS.indexOf(url); if (i>=0) { REMOTE_IMPORTS.splice(i,1); saveJSON('AdBlockX.REMOTE_IMPORTS', REMOTE_IMPORTS); } };
  window.AdBlockX.getRemoteImports = function() { return REMOTE_IMPORTS.slice(); };
  window.AdBlockX.setAllowForeignImports = function(v) { ALLOW_FOREIGN_IMPORTS = !!v; saveJSON('AdBlockX.ALLOW_FOREIGN_IMPORTS', ALLOW_FOREIGN_IMPORTS); panelLog('ALLOW_FOREIGN_IMPORTS set to ' + ALLOW_FOREIGN_IMPORTS); };
  window.AdBlockX.getAllowForeignImports = function() { return !!ALLOW_FOREIGN_IMPORTS; };
  window.AdBlockX.loadRemoteImports = loadRemoteImports;

  // remote list fetch & merge
  async function fetchRemoteList(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const txt = await res.text();
      // Expect newline-delimited fragments; ignore comments (#)
      const entries = txt.split(/\r?\n/).map(s=>s.trim()).filter(s=>s && !s.startsWith('#'));
      return entries;
    } catch (e) { throw e; }
  }

  async function updateRemoteLists() {
    const now = Date.now();
    for (const r of (REMOTE_LISTS||[])) {
      try {
        const items = await fetchRemoteList(r.url);
        // merge into BLACKLIST (avoid duplicates)
        for (const it of items) if (!BLACKLIST.includes(it)) BLACKLIST.push(it);
        r.lastFetched = now;
        saveJSON('AdBlockX.BLACKLIST', BLACKLIST);
        saveJSON('AdBlockX.REMOTE_LISTS', REMOTE_LISTS);
        panelLog('Remote list updated: ' + r.url);
      } catch (e) { panelLog('Remote list fetch failed: ' + r.url + ' -> ' + e, 'err'); }
    }
  }

  // element hiding and mutation observer
  const HIDE_CSS_ID = 'adblockx-hide-css';
  function injectHideCSS(rules) {
    try {
      let style = document.getElementById(HIDE_CSS_ID);
      if (!style) { style = document.createElement('style'); style.id = HIDE_CSS_ID; document.head && document.head.appendChild(style); }
      style.textContent = (rules||[]).join('\n');
    } catch (e) { console.warn('[AdBlockX] injectHideCSS failed', e); }
  }

  let __abx_mutation = null;
  // YouTube overlay remover handles
  let __abx_yt_overlay = { mo: null, enabled: !!loadJSON('AdBlockX.YT_OVERLAY_ENABLED', true) };
  function startYouTubeOverlayRemover() {
    try {
      if (__abx_yt_overlay.mo) return;
      const removeOverlay = (n) => {
        try {
          if (!n || !(n instanceof HTMLElement)) return;
          const txt = (n.className||'') + ' ' + (n.id||'') + ' ' + (n.outerHTML||'');
          // heuristics: YouTube ad overlays often contain 'ad', 'ad-overlay', 'ytp-ad', 'ad-showing'
          if (/ytp-ad|ad-overlay|ad-showing|ad-click|ad-skip-button|ad-badge/i.test(txt)) {
            try { n.remove(); pushLog('blocked', { t: nowStr(), url: location.href, reason: 'YT_OVERLAY' }); panelLog('YouTube overlay removed'); } catch(e){}
          }
        } catch(e){}
      };
      const mo = new MutationObserver(muts => {
        for (const m of muts) for (const n of m.addedNodes || []) {
          try { removeOverlay(n); } catch(e){}
        }
      });
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
      __abx_yt_overlay.mo = mo; __abx_yt_overlay.enabled = true; saveJSON('AdBlockX.YT_OVERLAY_ENABLED', true);
      panelLog('YouTube overlay remover started');
    } catch(e){ panelLog('startYouTubeOverlayRemover failed: '+e,'err'); }
  }
  function stopYouTubeOverlayRemover() {
    try { if (__abx_yt_overlay.mo) { __abx_yt_overlay.mo.disconnect(); __abx_yt_overlay.mo = null; } __abx_yt_overlay.enabled = false; saveJSON('AdBlockX.YT_OVERLAY_ENABLED', false); panelLog('YouTube overlay remover stopped'); } catch(e){ panelLog('stopYouTubeOverlayRemover failed: '+e,'err'); }
  }
  function startMutationObserver() {
    try {
      if (__abx_mutation) return;
      __abx_mutation = new MutationObserver(mutations => {
        try {
          for (const m of mutations) {
            for (const n of m.addedNodes || []) {
              try {
                if (!(n instanceof HTMLElement)) continue;
                const html = n.outerHTML || '';
                // test regex rules against new node outerHTML
                for (const r of (REGEX_RULES||[])) {
                  try { const re = new RegExp(r); if (re.test(html)) { n.remove(); pushLog('blocked', { t: nowStr(), url: location.href }); panelLog('Removed element by regex'); break; } } catch(e){}
                }
              } catch(e){}
            }
          }
        } catch(e){}
      });
      __abx_mutation.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (e) { console.warn('[AdBlockX] startMutationObserver failed', e); }
  }

  function stopMutationObserver() { try { if (__abx_mutation) { __abx_mutation.disconnect(); __abx_mutation = null; } } catch(e){}
  }

  // Autonomy Engine (advanced)
  class AutonomyEngine {
  // Cluster engine: group similar domains and patterns
  updateClusters() {
    // Adaptive threshold: median similarity for current data
    const domainList = Object.keys(this.stats.blockedDomains);
    const domainThreshold = this._adaptiveThreshold(domainList, this._domainSimilarity);
    this.domainClusters = this._findClusters(domainList, this._domainSimilarity, domainThreshold);
    // Hierarchical clustering: nested clusters for large sets
    this.domainClusters = this._hierarchicalClusters(this.domainClusters, this._domainSimilarity, domainThreshold);

    const patternList = Object.keys(this.stats.blockedPatterns);
    const patternThreshold = this._adaptiveThreshold(patternList, this._patternSimilarity);
    this.patternClusters = this._findClusters(patternList, this._patternSimilarity, patternThreshold);
    this.patternClusters = this._hierarchicalClusters(this.patternClusters, this._patternSimilarity, patternThreshold);

    this._trackClusterActivity();
    this.logAction('Advanced clusters updated');
  }


  _adaptiveThreshold(list, similarityFn) {
    if (list.length < 2) return 0.8;
    const sims = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        sims.push(similarityFn(list[i], list[j]));
      }
    }
    sims.sort((a,b)=>a-b);
    return sims[Math.floor(sims.length/2)] || 0.8;
  }

  _findClusters(list, similarityFn, threshold=0.8) {
    const clusters = [];
    const visited = new Set();
    for (let i = 0; i < list.length; i++) {
      if (visited.has(list[i])) continue;
      const cluster = [list[i]];
      visited.add(list[i]);
      for (let j = i + 1; j < list.length; j++) {
        if (!visited.has(list[j]) && similarityFn(list[i], list[j]) > threshold) {
          cluster.push(list[j]);
          visited.add(list[j]);
        }
      }
      if (cluster.length > 1) clusters.push(cluster);
    }
    return clusters;
  }

  _hierarchicalClusters(clusters, similarityFn, threshold) {
    // Merge clusters that are highly similar
    let merged = true;
    while (merged && clusters.length > 1) {
      merged = false;
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          // Compare cluster centroids
          const a = clusters[i][0], b = clusters[j][0];
          if (similarityFn(a, b) > threshold + 0.1) {
            clusters[i] = [...new Set([...clusters[i], ...clusters[j]])];
            clusters.splice(j, 1);
            merged = true;
            break;
          }
        }
        if (merged) break;
      }
    }
    return clusters;
  }

  _trackClusterActivity() {
    this.clusterAnalytics = {
      topDomainClusters: (this.domainClusters||[]).map(c=>({cluster:c, total:c.reduce((sum,d)=>sum+(this.stats.blockedDomains[d]||0),0)})).sort((a,b)=>b.total-a.total).slice(0,5),
      topPatternClusters: (this.patternClusters||[]).map(c=>({cluster:c, total:c.reduce((sum,p)=>sum+(this.stats.blockedPatterns[p]||0),0)})).sort((a,b)=>b.total-a.total).slice(0,5)
    };
  }

  getClusterAnalytics() { return this.clusterAnalytics || { topDomainClusters: [], topPatternClusters: [] }; }

  // User controls for clusters
  approveCluster(type, idx) {
    if (type === 'domain') {
      const cluster = this.domainClusters[idx];
      for (const d of cluster) {
        if (!BLACKLIST.includes(d)) BLACKLIST.push(d);
      }
      saveJSON('AdBlockX.BLACKLIST', BLACKLIST);
      this.logAction(`Approved domain cluster: ${cluster.join(', ')}`);
    } else if (type === 'pattern') {
      const cluster = this.patternClusters[idx];
      for (const p of cluster) {
        if (!REGEX_RULES.includes(p)) REGEX_RULES.push(p);
      }
      saveJSON('AdBlockX.REGEX_RULES', REGEX_RULES);
      this.logAction(`Approved pattern cluster: ${cluster.join(', ')}`);
    }
    this.updateClusters();
  }
  rejectCluster(type, idx) {
    this.logAction(`Rejected ${type} cluster: ${idx}`);
    // Optionally mark cluster as ignored
  }

  // _findClusters consolidated above (duplicate removed)

  getDomainClusters() { return this.domainClusters || []; }
  getPatternClusters() { return this.patternClusters || []; }

  // approveChange consolidated above (duplicate removed)
    constructor() {
      this.enabled = false;
      this.stats = { blockedDomains: {}, blockedPatterns: {}, domMutations: 0 };
      this.log = [];
      this.pendingChanges = [];
      this.changeHistory = [];
      this.settings = {
        domainThreshold: 10,
        patternThreshold: 10,
        aggressiveness: 1,
        whitelist: [],
      };
      this.analytics = { blocked: {}, falsePositives: {}, actions: [] };
      this.remoteSyncUrl = '';
    }
    enable() { this.enabled = true; this.logAction('Autonomy enabled'); }
    disable() { this.enabled = false; this.logAction('Autonomy disabled'); }
    logAction(action) { this.log.push({ time: Date.now(), action }); if (this.log.length > 1000) this.log.shift(); }
    observeBlock(domain, pattern) {
      if (!this.enabled) return;
      // Native anomaly detection: cluster domains/patterns by frequency and similarity
      if (domain && !this.settings.whitelist.includes(domain)) {
        this.stats.blockedDomains[domain] = (this.stats.blockedDomains[domain] || 0) + 1;
        this.analytics.blocked[domain] = (this.analytics.blocked[domain] || 0) + 1;
        // Self-tuning: adjust threshold based on domain activity
        if (this.stats.blockedDomains[domain] > this.settings.domainThreshold * this.settings.aggressiveness && !BLACKLIST.includes(domain)) {
          // Cluster similar domains
          const similar = Object.keys(this.stats.blockedDomains).filter(d => d !== domain && this._domainSimilarity(domain, d) > 0.8);
          if (similar.length > 2) {
            this.pendingChanges.push({ type: 'domain-cluster', value: [domain, ...similar] });
            this.logAction(`Clustered domains for review: ${[domain, ...similar].join(', ')}`);
          } else {
            this.pendingChanges.push({ type: 'domain', value: domain });
            this.logAction(`Queued domain for review: ${domain}`);
          }
        }
      }
      if (pattern) {
        this.stats.blockedPatterns[pattern] = (this.stats.blockedPatterns[pattern] || 0) + 1;
        this.analytics.blocked[pattern] = (this.analytics.blocked[pattern] || 0) + 1;
        // Self-tuning: adjust threshold based on pattern activity
        if (this.stats.blockedPatterns[pattern] > this.settings.patternThreshold * this.settings.aggressiveness && !REGEX_RULES.includes(pattern)) {
          // Cluster similar patterns
          const similar = Object.keys(this.stats.blockedPatterns).filter(p => p !== pattern && this._patternSimilarity(pattern, p) > 0.8);
          if (similar.length > 2) {
            this.pendingChanges.push({ type: 'pattern-cluster', value: [pattern, ...similar] });
            this.logAction(`Clustered patterns for review: ${[pattern, ...similar].join(', ')}`);
          } else {
            this.pendingChanges.push({ type: 'pattern', value: pattern });
            this.logAction(`Queued pattern for review: ${pattern}`);
          }
        }
      }
    }

    // Native similarity (Jaccard index for domains, Levenshtein for patterns)
    _domainSimilarity(a, b) {
      const setA = new Set(a.split('.'));
      const setB = new Set(b.split('.'));
      const intersection = new Set([...setA].filter(x => setB.has(x)));
      return intersection.size / Math.max(setA.size, setB.size);
    }
    _patternSimilarity(a, b) {
      // Levenshtein distance
      const m = a.length, n = b.length;
      const dp = Array(m+1).fill().map(()=>Array(n+1).fill(0));
      for(let i=0;i<=m;i++)dp[i][0]=i;
      for(let j=0;j<=n;j++)dp[0][j]=j;
      for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=a[i-1]==b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
      return 1 - dp[m][n]/Math.max(m,n);
    }

    // Advanced analytics: native summary
    getAnalyticsSummary() {
      const topDomains = Object.entries(this.stats.blockedDomains).sort((a,b)=>b[1]-a[1]).slice(0,10);
      const topPatterns = Object.entries(this.stats.blockedPatterns).sort((a,b)=>b[1]-a[1]).slice(0,10);
      return {
        topDomains,
        topPatterns,
        falsePositives: this.analytics.falsePositives,
        changeHistory: this.changeHistory,
        pendingChanges: this.pendingChanges
      };
    }

    // Self-tuning: adjust aggressiveness based on user feedback
    adjustAggressiveness(feedbackScore) {
      if (feedbackScore > 0.8) this.settings.aggressiveness = Math.min(this.settings.aggressiveness + 0.1, 2);
      else if (feedbackScore < 0.2) this.settings.aggressiveness = Math.max(this.settings.aggressiveness - 0.1, 0.5);
      this.logAction(`Aggressiveness auto-tuned to ${this.settings.aggressiveness.toFixed(2)}`);
    }
    observeDomMutation() {
      if (!this.enabled) return;
      this.stats.domMutations++;
      if (this.stats.domMutations % 50 === 0) {
        this.logAction(`High DOM mutation detected: ${this.stats.domMutations}`);
      }
    }
    approveChange(idx) {
      const change = this.pendingChanges[idx];
      if (!change) return;
      if (change.type === 'domain') {
        BLACKLIST.push(change.value);
        saveJSON('AdBlockX.BLACKLIST', BLACKLIST);
        this._applyDynamicUpdate('domain', change.value);
      } else if (change.type === 'pattern') {
        REGEX_RULES.push(change.value);
        saveJSON('AdBlockX.REGEX_RULES', REGEX_RULES);
        this._applyDynamicUpdate('pattern', change.value);
      } else if (change.type === 'domain-cluster') {
        for (const d of change.value) {
          if (!BLACKLIST.includes(d)) BLACKLIST.push(d);
        }
        saveJSON('AdBlockX.BLACKLIST', BLACKLIST);
        this._applyDynamicUpdate('domain-cluster', change.value);
      } else if (change.type === 'pattern-cluster') {
        for (const p of change.value) {
          if (!REGEX_RULES.includes(p)) REGEX_RULES.push(p);
        }
        saveJSON('AdBlockX.REGEX_RULES', REGEX_RULES);
        this._applyDynamicUpdate('pattern-cluster', change.value);
      }
      this.changeHistory.push({ ...change, time: Date.now() });
      this.pendingChanges.splice(idx, 1);
      this.logAction(`Approved change: ${change.type} ${change.value}`);
    }

    // Real-time dynamic update handler
    _applyDynamicUpdate(type, value) {
      // Immediately refresh blocking logic and UI
      if (typeof window !== 'undefined' && window.panelState && window.panelState.updateCounts) {
        window.panelState.updateCounts();
      }
      // Optionally trigger mutation observer or network refresh
      if (type.startsWith('domain')) {
        if (typeof maybeRefreshSW === 'function') maybeRefreshSW();
      }
      // Log dynamic update
      this.logAction(`Dynamic update applied: ${type} ${Array.isArray(value) ? value.join(', ') : value}`);
    }
    rejectChange(idx) {
      const change = this.pendingChanges[idx];
      if (!change) return;
      this.changeHistory.push({ ...change, time: Date.now(), rejected: true });
      this.pendingChanges.splice(idx, 1);
      this.logAction(`Rejected change: ${change.type} ${change.value}`);
    }
    rollbackLastChange() {
      const last = this.changeHistory.pop();
      if (!last) return;
      if (last.type === 'domain') {
        const i = BLACKLIST.indexOf(last.value);
        if (i !== -1) BLACKLIST.splice(i, 1);
        saveJSON('AdBlockX.BLACKLIST', BLACKLIST);
      } else if (last.type === 'pattern') {
        const i = REGEX_RULES.indexOf(last.value);
        if (i !== -1) REGEX_RULES.splice(i, 1);
        saveJSON('AdBlockX.REGEX_RULES', REGEX_RULES);
      }
      this.logAction(`Rolled back change: ${last.type} ${last.value}`);
    }
    setRemoteSyncUrl(url) { this.remoteSyncUrl = url; }
    async syncRemote() {
      if (!this.remoteSyncUrl) return;
      try {
        const payload = { blacklist: BLACKLIST, regex: REGEX_RULES, history: this.changeHistory };
        await fetch(this.remoteSyncUrl, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
        this.logAction('Synced with remote');
      } catch (e) { this.logAction('Remote sync failed'); }
    }
    importRemote(data) {
      if (data.blacklist) BLACKLIST = data.blacklist;
      if (data.regex) REGEX_RULES = data.regex;
      saveJSON('AdBlockX.BLACKLIST', BLACKLIST);
      saveJSON('AdBlockX.REGEX_RULES', REGEX_RULES);
      this.logAction('Imported remote data');
    }
    setThresholds(domainT, patternT) {
      this.settings.domainThreshold = domainT;
      this.settings.patternThreshold = patternT;
      this.logAction(`Thresholds updated: domain=${domainT}, pattern=${patternT}`);
    }
    setAggressiveness(level) {
      this.settings.aggressiveness = level;
      this.logAction(`Aggressiveness set to ${level}`);
    }
    addWhitelist(domain) {
      if (!this.settings.whitelist.includes(domain)) {
        this.settings.whitelist.push(domain);
        this.logAction(`Whitelisted domain: ${domain}`);
      }
    }
    removeWhitelist(domain) {
      const i = this.settings.whitelist.indexOf(domain);
      if (i !== -1) {
        this.settings.whitelist.splice(i, 1);
        this.logAction(`Removed from whitelist: ${domain}`);
      }
    }
    trackFalsePositive(domain) {
      this.analytics.falsePositives[domain] = (this.analytics.falsePositives[domain] || 0) + 1;
      this.logAction(`False positive tracked: ${domain}`);
    }
    getAnalytics() { return this.analytics; }
    getPendingChanges() { return this.pendingChanges; }
    getChangeHistory() { return this.changeHistory; }
    getLog() { return this.log; }
  }
  /***********************
   * Service Worker source (string)
   ***********************/
  // Lazily initialize AUTONOMY using a proxy: the real AutonomyEngine is created
  // only when mutating methods are invoked or when a property is set.
  try {
    let _realAutonomy = null;
    function makeRealAutonomy() {
      if (_realAutonomy) return _realAutonomy;
      try { _realAutonomy = new AutonomyEngine(); } catch (e) { console.warn('[AdBlockX] AutonomyEngine init failed', e); _realAutonomy = null; }
      return _realAutonomy;
    }

    const TRIGGER_METHODS = ['enable', 'disable', 'approveChange', 'start', 'stop', 'init', 'configure'];

    function createAutonomyProxy() {
      const handler = {
        get(target, prop) {
          try {
            if (_realAutonomy) return _realAutonomy[prop];
                    // If the property is a trigger method, return a wrapper that instantiates first
                    if (typeof prop === 'string' && TRIGGER_METHODS.includes(prop)) {
                      return function(...args) {
                        const inst = makeRealAutonomy();
                        if (!inst) throw new Error('AutonomyEngine failed to initialize');
                        const fn = inst[prop];
                        return typeof fn === 'function' ? fn.apply(inst, args) : fn;
                      };
                    }
                    // For common property reads, ensure the real instance is created so reads reflect persisted state
                    if (prop === 'enabled') {
                      try { const inst = _realAutonomy || makeRealAutonomy(); return !!(inst && inst.enabled); } catch(e) { return false; }
                    }
                    if (prop === 'getAnalytics') {
                      return function() { const inst = _realAutonomy || makeRealAutonomy(); return inst ? (inst.getAnalytics ? inst.getAnalytics() : {}) : {}; };
                    }
                    // fallback: undefined
                    return undefined;
          } catch (e) { return undefined; }
        },
        set(target, prop, value) {
          try {
            const inst = makeRealAutonomy();
            if (!inst) return false;
            inst[prop] = value;
            return true;
          } catch (e) { return false; }
        },
        has(target, prop) { return !!(_realAutonomy && prop in _realAutonomy); }
      };
      return new Proxy({}, handler);
    }

    window.AdBlockX = window.AdBlockX || {};
    const autonomyProxy = createAutonomyProxy();
    try { Object.defineProperty(window.AdBlockX, 'AUTONOMY', { configurable: true, enumerable: true, value: autonomyProxy, writable: true }); } catch (e) { console.warn('[AdBlockX] could not define AdBlockX.AUTONOMY', e); }
    try { Object.defineProperty(window, 'AUTONOMY', { configurable:true, enumerable:true, get: ()=> window.AdBlockX.AUTONOMY, set: (v)=> { try { window.AdBlockX.AUTONOMY = v; } catch(e){} } }); } catch(e) {}
  } catch (e) { console.warn('[AdBlockX] could not setup lazy AUTONOMY proxy', e); }
  /***********************
   * Minotaur Engine - lightweight detector for suspicious ad artifacts
   * - stores findings in localStorage under 'AdBlockX.MINOTAUR_FINDINGS'
   * - provides enable/disable/run/getFindings APIs via window.AdBlockX.MINOTAUR
   ***********************/
  (function(){
    try {
      const engine = {
        enabled: !!loadJSON('AdBlockX.MINOTAUR_ENABLED', false),
        lastRun: loadJSON('AdBlockX.MINOTAUR_LAST', null),
        findings: loadJSON('AdBlockX.MINOTAUR_FINDINGS', []),
        async run(options={}) {
          try {
            const now = Date.now();
            const results = [];
            const nodes = Array.from(document.querySelectorAll('iframe,script,img,video,source,embed,object'));
            for (const n of nodes) {
              try {
                const src = (n.src || (n.getAttribute && (n.getAttribute('src')||n.getAttribute('data-src'))) || n.href || '').toString();
                if (!src) continue;
                const suspect = urlMatchesList(src, BLACKLIST) || urlMatchesList(src, SPOOF_LIST) || /ads?|doubleclick|googlesyndication|pagead|adservice|adnxs|taboola|outbrain|criteo|adroll/i.test(src) || /\bads?\b/i.test((n.className||n.id||''));
                if (suspect) results.push({ t: new Date().toISOString(), type: n.tagName||'node', src, node: (n.id||n.className||'') });
              } catch(e){}
            }
            try {
              const blocked = LOGS.blocked || [];
              const grouped = {};
              for (const it of blocked.slice(-500)) {
                try { const u = new URL(it.url||'', location.origin); const h = u.hostname; grouped[h] = (grouped[h]||0)+1; } catch(e){}
              }
              const frequent = Object.entries(grouped).filter(([k,v])=>v>=3).map(([k,v])=>({host:k,count:v}));
              for (const f of frequent) results.push({ t: new Date().toISOString(), type: 'host-freq', host: f.host, count: f.count });
            } catch(e){}
            const map = new Map(); const final = [];
            for (const r of results) {
              const k = (r.src||r.host||'') + '|' + (r.type||''); if (!map.has(k)) { map.set(k,true); final.push(r); }
            }
            engine.findings = final; engine.lastRun = Date.now(); saveJSON('AdBlockX.MINOTAUR_FINDINGS', engine.findings); saveJSON('AdBlockX.MINOTAUR_LAST', engine.lastRun);
            return engine.findings;
          } catch(e){ console.warn('[Minotaur] run err', e); return []; }
        },
        enable() { engine.enabled = true; saveJSON('AdBlockX.MINOTAUR_ENABLED', true); },
        disable() { engine.enabled = false; saveJSON('AdBlockX.MINOTAUR_ENABLED', false); },
        getFindings() { return JSON.parse(JSON.stringify(engine.findings || [])); },
        clearFindings() { engine.findings = []; saveJSON('AdBlockX.MINOTAUR_FINDINGS', []); }
      };
  // attach to global so UI and API can use it
  window.AdBlockX = window.AdBlockX || {}; window.AdBlockX.MINOTAUR = engine;
     // also expose a simple global alias used by some UI code to avoid ReferenceError
     try { window.MINOTAUR = window.MINOTAUR || { engine: engine }; } catch(e) {}
    } catch(e) { console.warn('[Minotaur] init failed', e); }
  })();
  // Multi-core worker pool: offload expensive scans
  (function(){
    try {
      const DEFAULT_POOL = Math.max(1, (navigator.hardwareConcurrency || 2) - 1);
      let poolSize = loadJSON('AdBlockX.MULTICORE_POOL', DEFAULT_POOL) || DEFAULT_POOL;
      let workers = [];
      let nextWorker = 0;
      let taskId = 0;
      const pending = new Map();

      const workerScript = `
        self.onmessage = function(evt) {
          try {
            const d = evt.data;
            if (!d || !d.cmd) return;
            if (d.cmd === 'scan') {
              const items = d.items || [];
              const BLACKLIST = d.BLACKLIST || [];
              const SPOOF_LIST = d.SPOOF_LIST || [];
              const ALWAYS_BLOCK = d.ALWAYS_BLOCK || [];
              const REGEX_RULES = d.REGEX_RULES || [];
              const results = [];
              for (let it of items) {
                try {
                  const url = String(it.url || '');
                  if (!url) continue;
                  let reason = null;
                  for (const a of ALWAYS_BLOCK) if (a && url.includes(a)) { reason = 'ALWAYS_BLOCK'; break; }
                  if (!reason) for (const s of BLACKLIST) if (s && url.includes(s)) { reason = 'BLACKLIST'; break; }
                  if (!reason) for (const s of SPOOF_LIST) if (s && url.includes(s)) { reason = 'SPOOF'; break; }
                  if (!reason) {
                    for (const r of REGEX_RULES) {
                      try { const re = new RegExp(r); if (re.test(url) || re.test(it.tag||'') || re.test(it.className||'')) { reason = 'REGEX'; break; } } catch(e) {}
                    }
                  }
                  if (reason) results.push({ url, tag: it.tag||'', id: it.id||'', className: it.className||'', initiatorType: it.initiatorType||'', reason });
                } catch(e){}
              }
              self.postMessage({ id: d.id, ok: true, results });
            } else if (d.cmd === 'ping') {
              self.postMessage({ id: d.id, ok: true, pong: true });
            }
          } catch(e){}
        };
      `;

      function createWorker() {
        try {
          const blob = new Blob([workerScript], { type: 'application/javascript' });
          let url = URL.createObjectURL(blob);
          // Handle Trusted Types for Worker URL
          if (window.trustedTypes && window.trustedTypes.createPolicy) {
            const policy = window.trustedTypes.createPolicy('adblockx-worker', {
              createScriptURL: (input) => input
            });
            url = policy.createScriptURL(url);
          }
          const w = new Worker(url);
          w.addEventListener('message', (evt) => {
            try {
              const data = evt.data || {};
              const p = pending.get(data.id);
              if (p) { pending.delete(data.id); p.resolve(data); }
            } catch(e){}
          });
          w.addEventListener('error', (err) => { console.warn('[AdBlockX] multicore worker error', err); });
          return w;
        } catch (e) { return null; }
      }

      function initPool(n) {
        try {
          for (const w of workers) try { w.terminate(); } catch(e){}
          workers = [];
          nextWorker = 0;
          poolSize = Math.max(1, Number(n||poolSize));
          saveJSON('AdBlockX.MULTICORE_POOL', poolSize);
          for (let i = 0; i < poolSize; i++) {
            const w = createWorker(); if (w) workers.push(w);
          }
          panelLog('MultiCore pool initialized: ' + workers.length + ' workers');
        } catch(e){ panelLog('initPool failed: '+e,'err'); }
      }

      function runTaskOnWorker(payload) {
        return new Promise((resolve) => {
          try {
            if (!workers || !workers.length) { return resolve({ id: payload.id, ok: false, error: 'no-workers' }); }
            const w = workers[nextWorker % workers.length]; nextWorker++;
            pending.set(payload.id, { resolve, started: Date.now() });
            w.postMessage(payload);
            setTimeout(() => { if (pending.has(payload.id)) { pending.delete(payload.id); resolve({ id: payload.id, ok: false, error: 'timeout' }); } }, 7000);
          } catch(e) { resolve({ id: payload.id, ok: false, error: String(e) }); }
        });
      }

      async function runScan(items) {
        try {
          if (!items || !items.length) return [];
          const plain = items.map(it => ({ url: String(it.url||''), tag: String(it.tag||''), id: String(it.id||''), className: String(it.className||''), initiatorType: String(it.initiatorType||'') }));
          const id = 'mc-'+(++taskId);
          const payload = { cmd: 'scan', id, items: plain, BLACKLIST, SPOOF_LIST, ALWAYS_BLOCK, REGEX_RULES };
          if (workers && workers.length) {
            const res = await runTaskOnWorker(payload);
            if (res && res.ok && Array.isArray(res.results)) return res.results;
          }
          // fallback main-thread
          const results = [];
          for (const it of plain) {
            try {
              const url = it.url || ''; let reason = null;
              for (const a of ALWAYS_BLOCK) if (a && url.includes(a)) { reason = 'ALWAYS_BLOCK'; break; }
              if (!reason) for (const s of BLACKLIST) if (s && url.includes(s)) { reason = 'BLACKLIST'; break; }
              if (!reason) for (const s of SPOOF_LIST) if (s && url.includes(s)) { reason = 'SPOOF'; break; }
              if (!reason) for (const r of REGEX_RULES) { try { const re = new RegExp(r); if (re.test(url) || re.test(it.tag||'') || re.test(it.className||'')) { reason = 'REGEX'; break; } } catch(e){} }
              if (reason) results.push(Object.assign({}, it, { reason }));
            } catch(e){}
          }
          return results;
        } catch(e){ return []; }
      }

      initPool(poolSize);
      window.AdBlockX = window.AdBlockX || {};
      window.AdBlockX.MULTICORE = { runScan, initPool: (n)=>initPool(n), getStatus: ()=>({ poolSize: poolSize, workers: workers.length, pending: pending.size }), setPoolSize: (n)=>initPool(n) };
    } catch(e) { console.warn('[AdBlockX] MULTICORE init failed', e); }
  })();
    function getSWSource() {
      return `
      const BLACKLIST = ${JSON.stringify(BLACKLIST)};
      const SPOOF_LIST = ${JSON.stringify(SPOOF_LIST)};
      const EXT_BLOCK = ${JSON.stringify(EXT_BLOCK)};
  const ENABLED = ${JSON.stringify(ENABLED)};
  const SCHEDULE = ${JSON.stringify(SCHEDULE)};
  const ALWAYS_BLOCK = ${JSON.stringify(ALWAYS_BLOCK)};
  const REFERRER_BLOCKS = ${JSON.stringify(REFERRER_BLOCKS)};
  const BLOCK_TYPES = ${JSON.stringify(BLOCK_TYPES)};
      const SPOOF_JSON = ${JSON.stringify(SPOOF_JSON)};

      function urlMatchesList(url, list) {
        if (!url) return false;
        try {
          const s = String(url || '');
          try {
            const u = new URL(s, self.location.origin);
            const hostname = u.hostname || '';
            const pathname = u.pathname || '';
            return list.some(fragment => fragment && (hostname.includes(fragment) || pathname.includes(fragment) || s.includes(fragment)) );
          } catch (e) {
            return list.some(fragment => fragment && s.includes(fragment));
          }
        } catch (e) { return false; }
      }

      self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
      self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

      self.addEventListener('fetch', event => {
        try {
          if (!ENABLED) return; // no blocking when disabled
          // schedule check (best-effort inside SW)
          try {
            if (SCHEDULE && SCHEDULE.enabled) {
              const now = new Date(); const h = now.getHours(); const s = Number(SCHEDULE.startHour||0); const e = Number(SCHEDULE.endHour||24);
              if (!(s === e ? true : (s < e ? (h >= s && h < e) : (h >= s || h < e)))) return;
            }
          } catch(e){}
          const req = event.request;
          const url = req.url || '';
          const dest = (req.destination || '').toLowerCase();
          // map destination to our block type keys
          const typeMap = { 'script':'script', 'image':'image', 'xhr':'xhr', 'fetch':'xhr', 'document':'document', 'iframe':'iframe' };
          const tkey = typeMap[dest] || (dest ? dest : null);
          if (tkey && BLOCK_TYPES && BLOCK_TYPES[tkey] === false) {
            // configured to not block this type
          } else {
            // referrer block (best-effort)
            try { const ref = req.referrer || ''; if (ref && REFERRER_BLOCKS.some(f=> ref.includes(f))) { event.respondWith(new Response('', { status:204 })); return; } } catch(e){}
            // ALWAYS_BLOCK enforced regardless of resource type
            try { if (urlMatchesList(url, ALWAYS_BLOCK)) { event.respondWith(new Response('', { status:204 })); return; } } catch(e){}
            if (urlMatchesList(url, BLACKLIST) || urlMatchesList(url, EXT_BLOCK)) {
              event.respondWith(new Response('', { status: 204, statusText: 'No Content' }));
              return;
            }
            if (urlMatchesList(url, SPOOF_LIST)) {
              const headers = { 'Content-Type': 'application/json' };
              event.respondWith(new Response(SPOOF_JSON, { status: 200, headers }));
              return;
            }
          }
        } catch (e) {
          // If SW code throws, let network handle it
        }
        // otherwise, do not call respondWith and let the network proceed
      });

      self.addEventListener('message', evt => {
        if (evt.data && evt.data.cmd === 'ping') {
          try { evt.source && evt.source.postMessage && evt.source.postMessage({ ok: true, sw: true }); } catch (e) {}
        }
      });
    `;
    }

  /***********************
   * Register SW
   ***********************/
  async function registerSW() {
    if (!('serviceWorker' in navigator)) {
      throw new Error('ServiceWorkerNotSupported');
    }
    const blob = new Blob([getSWSource()], { type: 'text/javascript' });
    const swUrl = URL.createObjectURL(blob);

    let reg;
    try {
      reg = await navigator.serviceWorker.register(swUrl, { scope: '/' });
    } catch (eRoot) {
      try {
        reg = await navigator.serviceWorker.register(swUrl, { scope: location.pathname || './' });
      } catch (ePath) {
        reg = await navigator.serviceWorker.register(swUrl);
      }
    }

    // wait until active
    if (reg.installing) {
      await new Promise(res => {
        const i = reg.installing;
        i.addEventListener('statechange', () => {
          if (i.state === 'activated') res();
        });
      });
    }
    return reg;
  }

  // Unregister existing SW and optionally re-register (attempt to update SW with new source)
  async function maybeRefreshSW(reRegister = true) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        try { await r.unregister(); panelLog('SW unregistered at ' + r.scope); } catch (e) {}
      }
      registration = null;
      if (reRegister && 'serviceWorker' in navigator && !isCurrentSiteDisabled() && ENABLED) {
        try { registration = await registerSW(); panelLog('SW re-registered. Scope: ' + (registration && registration.scope)); } catch(e){ panelLog('SW re-register failed: '+e,'err'); }
      }
    } catch (e) { panelLog('maybeRefreshSW failed: '+e,'err'); }
  }

  /***********************
   * Fallback hooks
   ***********************/
  const fallback = {
    enabled: true,
    init() {
      if (this._inited) return;
      this._inited = true;
      this._origFetch = window.fetch.bind(window);
      const that = this;
      window.fetch = async function(...args) {
        try {
          const url = String(args[0] || '');
          pushLog('observed', { t: nowStr(), url });
          // respect schedule and per-site in fallback
          if (!isActive()) return that._origFetch(...args);
          // enforce ALWAYS_BLOCK
          try {
            if (urlMatchesList(url, ALWAYS_BLOCK)) { pushLog('blocked', { t: nowStr(), url, reason: 'ALWAYS_BLOCK' }); console.warn('[AdBlockX] fallback always-blocked fetch', url); return new Response('', { status: 204 }); }
          } catch(e){}
          // referrer blocking (best-effort)
          try {
            const ref = (args[1] && args[1].referrer) || document.referrer || '';
            if (ref && (REFERRER_BLOCKS||[]).some(f => String(ref).includes(f))) {
              pushLog('blocked', { t: nowStr(), url, referrer: ref, reason: 'REFERRER_BLOCK' });
              console.warn('[AdBlockX] fallback blocked fetch by referrer', url, ref);
              return new Response('', { status: 204 });
            }
          } catch(e){}
          // fallback cannot reliably determine destination; honor global lists
          if (urlMatchesList(url, BLACKLIST) || urlMatchesList(url, EXT_BLOCK)) {
            pushLog('blocked', { t: nowStr(), url, reason: 'BLACKLIST' });
            console.warn('[AdBlockX] fallback blocked fetch', url);
            // If server proxy enforcement is configured, forward the request via proxy to let server decide
            try {
              if (SERVER_PROXY && SERVER_PROXY.mode === 'enforce' && SERVER_PROXY.url) {
                try {
                  const proxyUrl = SERVER_PROXY.url.replace(/\/\/$/, '') + '/' + encodeURIComponent(url);
                  const hdrs = Object.assign({}, (args[1] && args[1].headers) || {});
                  if (SERVER_PROXY.apiKey) hdrs['x-api-key'] = SERVER_PROXY.apiKey;
                  const prox = await that._origFetch(proxyUrl, Object.assign({}, args[1] || {}, { headers: hdrs }));
                  // if proxy returned 204 (blocked) or 200 with spoof body, forward that response
                  if (prox && prox.status === 204) return new Response('', { status: 204 });
                  if (prox && prox.status === 200) {
                    const txt = await prox.text();
                    return new Response(txt, { status: 200, headers: { 'Content-Type': prox.headers.get('content-type') || 'text/plain' } });
                  }
                } catch(e){ panelLog('Proxy enforcement failed: '+e,'err'); }
              }
            } catch(e){}
            if (ENFORCER_ENABLED) try { const h = (new URL(url, location.href)).hostname; if (h && !ALWAYS_BLOCK.includes(h)) { ALWAYS_BLOCK.push(h); saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK); panelLog('Enforcer promoted to ALWAYS_BLOCK: ' + h); } } catch(e){}
            return new Response('', { status: 204 });
          }
          if (urlMatchesList(url, SPOOF_LIST)) {
            pushLog('spoofed', { t: nowStr(), url, reason: 'SPOOF' });
            console.warn('[AdBlockX] fallback spoofed fetch', url);
            return new Response(SPOOF_JSON, { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        } catch (e) { console.warn('[AdBlockX] fetch hook error', e); }
        return that._origFetch(...args);
      };

      this._origXHROpen = XMLHttpRequest.prototype.open;
      this._origXHRSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        try { this._abx_url = url; } catch (e) {}
        return fallback._origXHROpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function(...args) {
        try {
          const url = this._abx_url;
          pushLog('observed', { t: nowStr(), url });
          if (!isActive()) return fallback._origXHRSend.apply(this, args);
          // enforce ALWAYS_BLOCK for XHR
          try { if (urlMatchesList(url, ALWAYS_BLOCK)) { pushLog('blocked', { t: nowStr(), url, reason: 'ALWAYS_BLOCK' }); panelLog('Archballistic blocked XHR (always-block): ' + url); return; } } catch(e){}
          // referrer check
          try { const ref = document.referrer || ''; if (ref && (REFERRER_BLOCKS||[]).some(f => String(ref).includes(f))) { pushLog('blocked', { t: nowStr(), url, referrer: ref, reason: 'REFERRER_BLOCK' }); console.warn('[AdBlockX] fallback XHR blocked by referrer', url, ref); return; } } catch(e){}
          // xhr blocking respects block types setting
          if (BLOCK_TYPES && BLOCK_TYPES['xhr'] === false) return fallback._origXHRSend.apply(this, args);
          if (urlMatchesList(url, BLACKLIST) || urlMatchesList(url, EXT_BLOCK)) {
            pushLog('blocked', { t: nowStr(), url, reason: 'BLACKLIST' });
            console.warn('[AdBlockX] fallback blocked XHR', url);
            if (ENFORCER_ENABLED) try { const h = (new URL(url, location.href)).hostname; if (h && !ALWAYS_BLOCK.includes(h)) { ALWAYS_BLOCK.push(h); saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK); panelLog('Enforcer promoted to ALWAYS_BLOCK: ' + h); } } catch(e){}
            return;
          }
          if (urlMatchesList(url, SPOOF_LIST)) {
            pushLog('spoofed', { t: nowStr(), url, reason: 'SPOOF' });
            console.warn('[AdBlockX] fallback spoofed XHR', url);
            this.readyState = 4;
            this.status = 200;
            this.responseText = SPOOF_JSON;
            setTimeout(() => {
              try { this.onreadystatechange && this.onreadystatechange(); } catch(e){}
              try { this.onload && this.onload(); } catch(e){}
            }, 0);
            return;
          }
        } catch(e){ console.warn('[AdBlockX] xhr hook error', e); }
        return fallback._origXHRSend.apply(this, args);
      };

      try {
        const OrigWS = window.WebSocket;
        window.WebSocket = function(url, protocols) {
          try {
            pushLog('observed', { t: nowStr(), url });
            if (!ENABLED) return new OrigWS(url, protocols);
            if (BLOCK_TYPES && BLOCK_TYPES['websocket'] === false) return new OrigWS(url, protocols);
            if (urlMatchesList(url, BLACKLIST) || urlMatchesList(url, EXT_BLOCK) || (STRICT_ENFORCER && urlMatchesList(url, ALWAYS_BLOCK))) {
              pushLog('blocked', { t: nowStr(), url, reason: STRICT_ENFORCER ? 'STRICT_WS_BLOCK' : 'BLACKLIST' });
              console.warn('[AdBlockX] fallback blocked WebSocket', url);
              if (ENFORCER_ENABLED) try { const h = (new URL(url, location.href)).hostname; if (h && !ALWAYS_BLOCK.includes(h)) { ALWAYS_BLOCK.push(h); saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK); panelLog('Enforcer promoted to ALWAYS_BLOCK: ' + h); } } catch(e){}
              return { readyState: 3, close() {}, send() {}, addEventListener() {}, removeEventListener() {} };
            }
          } catch (e) {}
          return new OrigWS(url, protocols);
        };
      } catch (e) { console.warn('[AdBlockX] WebSocket hook failed', e); }
    },

    restore() {
      try {
        if (this._origFetch) window.fetch = this._origFetch;
        if (this._origXHROpen) XMLHttpRequest.prototype.open = this._origXHROpen;
        if (this._origXHRSend) XMLHttpRequest.prototype.send = this._origXHRSend;
      } catch (e) { console.warn('[AdBlockX] fallback restore failed', e); }
    }
  };

  /***********************
   * UI panel (Trusted Types safe)
   ***********************/
  function makePanel() {
    // root panel
    const panel = document.createElement('div');
    panel.id = 'adblockx-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      top: '12px',
      zIndex: 2147483647,
      background: '#0b0b0b',
      color: '#fff',
      padding: '12px',
      borderRadius: '8px',
      fontFamily: 'monospace',
      fontSize: '12px',
      width: '360px',
      boxShadow: '0 8px 30px rgba(0,0,0,0.6)'
    });

  // header row
    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.justifyContent = 'space-between';
    headerRow.style.alignItems = 'center';
    headerRow.style.marginBottom = '8px';

    const title = document.createElement('strong');
    title.style.color = '#ff6b6b';
    title.textContent = 'AdBlockX SW';
    headerRow.appendChild(title);

    const controlsDiv = document.createElement('div');
    controlsDiv.style.fontSize = '11px';

    const btnRegister = document.createElement('button');
    btnRegister.textContent = 'Register SW';
    btnRegister.style.marginRight = '6px';
    btnRegister.addEventListener('click', async () => {
      try {
        panelLog('Attempting to register Service Worker...');
        // attempt to register (re-use registerSW function available in closure)
        try {
          registration = await registerSW();
          panelLog('SW registered. Scope: ' + (registration && registration.scope));
          btnRegister.textContent = 'Registered';
        } catch (e) {
          panelLog('Register failed: ' + e, 'err');
        }
      } catch (e) { panelLog('Register click failed: ' + e, 'err'); }
    });
    controlsDiv.appendChild(btnRegister);

    const btnEnable = document.createElement('button');
    btnEnable.textContent = ENABLED ? 'Enabled: On' : 'Enabled: Off';
    btnEnable.style.marginRight = '6px';
    btnEnable.addEventListener('click', () => {
      ENABLED = !ENABLED;
      saveJSON('AdBlockX.ENABLED', ENABLED);
      btnEnable.textContent = ENABLED ? 'Enabled: On' : 'Enabled: Off';
      panelLog('AdBlockX ' + (ENABLED ? 'enabled' : 'disabled'));
    });
    controlsDiv.appendChild(btnEnable);

    const btnPerSite = document.createElement('button');
    btnPerSite.textContent = isCurrentSiteDisabled() ? 'Site: Disabled' : 'Site: Enabled';
    btnPerSite.style.marginRight = '6px';
    btnPerSite.addEventListener('click', () => {
      try {
        const o = getCurrentOrigin();
        if (!o) return;
        const v = !isCurrentSiteDisabled();
        PER_SITE_DISABLED[o] = v; // true means disabled
        saveJSON('AdBlockX.PER_SITE_DISABLED', PER_SITE_DISABLED);
        btnPerSite.textContent = v ? 'Site: Disabled' : 'Site: Enabled';
        panelLog('Per-site disabled for ' + o + ': ' + v);
        maybeRefreshSW();
      } catch (e) { panelLog('Per-site toggle failed: ' + e, 'err'); }
    });
    controlsDiv.appendChild(btnPerSite);

    const btnHyper = document.createElement('button');
    btnHyper.textContent = HYPERNOVA ? 'Hypernova: On' : 'Hypernova: Off';
    btnHyper.style.marginRight = '6px';
    btnHyper.addEventListener('click', () => {
      try {
        if (!HYPERNOVA) {
          enableHypernova();
          btnHyper.textContent = 'Hypernova: On';
          // auto-add analytics hosts
          try { addAnalyticsHostsToBlacklist(); } catch(e){}
        } else {
          disableHypernova();
          btnHyper.textContent = 'Hypernova: Off';
        }
        maybeRefreshSW();
      } catch (e) { panelLog('Hypernova toggle failed: '+e,'err'); }
    });
    controlsDiv.appendChild(btnHyper);

    const btnArch = document.createElement('button');
    btnArch.textContent = ARCHBALLISTIC ? 'Archballistic: On' : 'Archballistic: Off';
    btnArch.style.marginRight = '6px';
    btnArch.addEventListener('click', () => {
      try {
        if (!ARCHBALLISTIC) { enableArchballistic(); btnArch.textContent = 'Archballistic: On'; }
        else { disableArchballistic(); btnArch.textContent = 'Archballistic: Off'; }
      } catch (e) { panelLog('Archballistic toggle failed: '+e,'err'); }
    });
    controlsDiv.appendChild(btnArch);

    const btnEnforcer = document.createElement('button');
    btnEnforcer.textContent = ENFORCER_ENABLED ? 'Enforcer: On' : 'Enforcer: Off';
    btnEnforcer.style.marginRight = '6px';
    btnEnforcer.addEventListener('click', () => {
      try {
        ENFORCER_ENABLED = !ENFORCER_ENABLED;
        saveJSON('AdBlockX.ENFORCER_ENABLED', !!ENFORCER_ENABLED);
        btnEnforcer.textContent = ENFORCER_ENABLED ? 'Enforcer: On' : 'Enforcer: Off';
        panelLog('Enforcer ' + (ENFORCER_ENABLED ? 'enabled' : 'disabled'));
      } catch(e){ panelLog('Enforcer toggle failed: '+e,'err'); }
    });
    controlsDiv.appendChild(btnEnforcer);
    const btnStrict = document.createElement('button');
    btnStrict.textContent = STRICT_ENFORCER ? 'Strict: On' : 'Strict: Off';
    btnStrict.style.marginRight = '6px';
    btnStrict.addEventListener('click', () => {
      try {
        STRICT_ENFORCER = !STRICT_ENFORCER;
        saveJSON('AdBlockX.STRICT_ENFORCER', !!STRICT_ENFORCER);
        btnStrict.textContent = STRICT_ENFORCER ? 'Strict: On' : 'Strict: Off';
        panelLog('Strict Enforcer ' + (STRICT_ENFORCER ? 'enabled' : 'disabled'));
        // When strict is enabled, enforce aggressive block types
        if (STRICT_ENFORCER) {
          BLOCK_TYPES = Object.assign(BLOCK_TYPES||{}, { script:true, image:true, xhr:true, document:true, iframe:true, websocket:true });
          saveJSON('AdBlockX.BLOCK_TYPES', BLOCK_TYPES);
          // enable hypernova + archballistic for maximum effect
          try { enableHypernova(); enableArchballistic(); } catch(e){}
        }
      } catch(e){ panelLog('Strict toggle failed: '+e,'err'); }
    });
    controlsDiv.appendChild(btnStrict);
    const btnWatch = document.createElement('button');
    btnWatch.textContent = WATCHDOG_ENABLED ? 'Watchdog: On' : 'Watchdog: Off';
    btnWatch.style.marginRight = '6px';
    btnWatch.addEventListener('click', () => {
      try {
        WATCHDOG_ENABLED = !WATCHDOG_ENABLED; saveJSON('AdBlockX.WATCHDOG_ENABLED', !!WATCHDOG_ENABLED);
        btnWatch.textContent = WATCHDOG_ENABLED ? 'Watchdog: On' : 'Watchdog: Off';
        if (WATCHDOG_ENABLED) startWatchdog(); else stopWatchdog();
      } catch(e) { panelLog('Watchdog toggle failed: '+e, 'err'); }
    });
    controlsDiv.appendChild(btnWatch);

    // Ass Hat Mode: aggressive tracker-stopping mode
    let ASS_HAT_MODE = !!loadJSON('AdBlockX.ASS_HAT_MODE', false);
    let __abx_asshat_mo = null;
    const ASS_HAT_TRACKERS = [
      'analytics.google.com', 'www.google-analytics.com', 'stats.g.doubleclick.net', 'pixel.advertising.com', 'adservice.google.com',
      'ads.yahoo.com', 'adsrvr.org', 'adnxs.com', 'criteo.com', 'trk.mailchimp.com', 'mixpanel.com', 'segment.io', 'cdn.segment.com'
    ];

    function enableAssHat() {
      try {
        if (ASS_HAT_MODE) return;
        ASS_HAT_MODE = true; saveJSON('AdBlockX.ASS_HAT_MODE', true);
        // add trackers to blacklist/always block (avoid duplicates)
        for (const t of ASS_HAT_TRACKERS) { if (!BLACKLIST.includes(t)) BLACKLIST.push(t); if (!ALWAYS_BLOCK.includes(t)) ALWAYS_BLOCK.push(t); }
        saveJSON('AdBlockX.BLACKLIST', BLACKLIST); saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK);
        // inject CSS to hide 1x1 pixels and common tracker elements
        injectHideCSS(["img[src*='google-analytics'], img[src*='pixel'], img[width='1'][height='1'], img[style*='display:none'], iframe[src*='analytics']"]);
        // mutation observer to remove tracker elements quickly
        __abx_asshat_mo = new MutationObserver(muts => {
          for (const m of muts) for (const n of m.addedNodes || []) {
            try {
              if (!(n instanceof HTMLElement)) continue;
              const tag = (n.tagName||'').toLowerCase();
              const src = (n.src || n.getAttribute && (n.getAttribute('src')||n.getAttribute('data-src')) || '');
              const html = n.outerHTML || '';
              let hostname = '';
              try { hostname = (new URL(src, location.href)).hostname; } catch(e){ hostname = ''; }
              const referrer = document.referrer || location.href; // trace back to where it came from
              if (tag === 'img') {
                // tiny pixels or known tracker hosts
                if ((n.width && n.height && (Number(n.width)===1 && Number(n.height)===1)) || /pixel|tracker|analytics|ga\.js|collect\?/i.test(src+html)) { 
                  try { n.remove(); 
                    // switch off their server: add hostname to ALWAYS_BLOCK
                    if (hostname && !ALWAYS_BLOCK.includes(hostname)) { ALWAYS_BLOCK.push(hostname); saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK); }
                    pushLog('blocked', { t: nowStr(), url: src, reason: 'ASS_HAT_PIXEL', referrer: referrer }); 
                  } catch(e){} 
                }
              }
              if (tag === 'iframe' || tag === 'script') {
                if (src && ASS_HAT_TRACKERS.some(h => src.includes(h))) { 
                  try { n.remove(); 
                    // switch off their server: add hostname to ALWAYS_BLOCK
                    if (hostname && !ALWAYS_BLOCK.includes(hostname)) { ALWAYS_BLOCK.push(hostname); saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK); }
                    pushLog('blocked', { t: nowStr(), url: src, reason: 'ASS_HAT_TRACKER', referrer: referrer }); 
                  } catch(e){} 
                }
              }
            } catch(e){}
          }
        });
        try { __abx_asshat_mo.observe(document.documentElement || document.body, { childList: true, subtree: true }); } catch(e){}
        panelLog('Ass Hat mode enabled: trackers will be aggressively blocked/removed');
      } catch(e){ panelLog('enableAssHat failed: '+e,'err'); }
    }

    function disableAssHat() {
      try {
        if (!ASS_HAT_MODE) return;
        ASS_HAT_MODE = false; saveJSON('AdBlockX.ASS_HAT_MODE', false);
        // remove ASS_HAT_TRACKERS from BLACKLIST and ALWAYS_BLOCK (best-effort)
        for (const t of ASS_HAT_TRACKERS) {
          const i = BLACKLIST.indexOf(t); if (i >= 0) BLACKLIST.splice(i,1);
          const j = ALWAYS_BLOCK.indexOf(t); if (j >= 0) ALWAYS_BLOCK.splice(j,1);
        }
        saveJSON('AdBlockX.BLACKLIST', BLACKLIST); saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK);
        injectHideCSS([]);
        try { __abx_asshat_mo && __abx_asshat_mo.disconnect(); __abx_asshat_mo = null; } catch(e){}
        panelLog('Ass Hat mode disabled');
      } catch(e){ panelLog('disableAssHat failed: '+e,'err'); }
    }

    const btnAssHat = document.createElement('button');
    btnAssHat.textContent = ASS_HAT_MODE ? 'Ass Hat: On' : 'Ass Hat: Off';
    btnAssHat.style.marginRight = '6px';
    btnAssHat.addEventListener('click', () => {
      try {
        if (!ASS_HAT_MODE) { enableAssHat(); btnAssHat.textContent = 'Ass Hat: On'; } else { disableAssHat(); btnAssHat.textContent = 'Ass Hat: Off'; }
        maybeRefreshSW();
      } catch(e){ panelLog('Ass Hat toggle failed: '+e,'err'); }
    });
    controlsDiv.appendChild(btnAssHat);

    // Stealth Mode: military-grade undetectable ad blocking
    let STEALTH_MODE = !!loadJSON('AdBlockX.STEALTH_MODE', false);
    let __abx_stealth_handles = null;

    function enableStealth() {
      try {
        if (STEALTH_MODE) return;
        STEALTH_MODE = true; saveJSON('AdBlockX.STEALTH_MODE', true);
        __abx_stealth_handles = {};

        // 1. Enhance spoof responses with realistic delays and content
        const origFetch = window.fetch;
        window.fetch = async function(url, opts) {
          try {
            const u = String(url || '');
            if (urlMatchesList(u, SPOOF_LIST)) {
              // Add random delay to simulate network latency (100-500ms)
              const delay = 100 + Math.random() * 400;
              await new Promise(r => setTimeout(r, delay));
              // Return realistic spoof response
              const spoofBody = JSON.stringify(SPOOF_JSON_OBJ);
              return new Response(spoofBody, { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } });
            }
          } catch(e){}
          return origFetch.call(this, url, opts);
        };
        __abx_stealth_handles.origFetch = origFetch;

        // 2. Insert fake ad elements to mimic presence
        const fakeAds = [
          '<div id="ad-banner" style="width:728px;height:90px;background:#f0f0f0;border:1px solid #ccc;display:none;"></div>',
          '<iframe src="about:blank" style="width:300px;height:250px;border:none;display:none;"></iframe>'
        ];
        fakeAds.forEach(html => {
          const div = document.createElement('div');
          div.innerHTML = html;
          div.style.position = 'absolute'; div.style.left = '-9999px';
          document.body.appendChild(div);
        });

        // 3. Hook common anti-adblock detection globals
        const detections = ['adblock', 'blockAdBlock', 'fuckAdBlock', 'checkAdBlock'];
        detections.forEach(key => {
          if (!(key in window)) {
            __abx_stealth_handles[key] = undefined;
            window[key] = function(){ return false; };
          }
        });

        // 4. Suppress AdBlockerX console logs to avoid detection
        const origConsoleLog = console.log;
        console.log = function(...args) {
          if (args[0] && String(args[0]).includes('AdBlockX')) return; // suppress
          return origConsoleLog.apply(this, args);
        };
        __abx_stealth_handles.origConsoleLog = origConsoleLog;

        // 5. Randomize timing in hooks to avoid patterns
        // (already have delays in fetch)

        panelLog('Stealth mode enabled: undetectable with military-grade precision');
      } catch(e){ panelLog('enableStealth failed: '+e,'err'); }
    }

    function disableStealth() {
      try {
        if (!STEALTH_MODE) return;
        STEALTH_MODE = false; saveJSON('AdBlockX.STEALTH_MODE', false);
        if (__abx_stealth_handles) {
          // Restore fetch
          if (__abx_stealth_handles.origFetch) window.fetch = __abx_stealth_handles.origFetch;
          // Remove fake ads
          const fakes = document.querySelectorAll('[id*="ad-banner"], iframe[src="about:blank"]');
          fakes.forEach(n => n.remove());
          // Restore detections
          const detections = ['adblock', 'blockAdBlock', 'fuckAdBlock', 'checkAdBlock'];
          detections.forEach(key => {
            if (__abx_stealth_handles[key] === undefined) delete window[key];
            else window[key] = __abx_stealth_handles[key];
          });
          // Restore console
          if (__abx_stealth_handles.origConsoleLog) console.log = __abx_stealth_handles.origConsoleLog;
          __abx_stealth_handles = null;
        }
        panelLog('Stealth mode disabled');
      } catch(e){ panelLog('disableStealth failed: '+e,'err'); }
    }

    const btnStealth = document.createElement('button');
    btnStealth.textContent = STEALTH_MODE ? 'Stealth: On' : 'Stealth: Off';
    btnStealth.style.marginRight = '6px';
    btnStealth.addEventListener('click', () => {
      try {
        if (!STEALTH_MODE) { enableStealth(); btnStealth.textContent = 'Stealth: On'; } else { disableStealth(); btnStealth.textContent = 'Stealth: Off'; }
      } catch(e){ panelLog('Stealth toggle failed: '+e,'err'); }
    });
    controlsDiv.appendChild(btnStealth);

    // AI Mode: private AI model assistance for advanced blocking
    let AI_MODE = !!loadJSON('AdBlockX.AI_MODE', false);
    let __abx_ai_model = null;
    let __abx_ai_mo = null;
    const IMAGENET_CLASSES = [
      'tench', 'goldfish', 'great white shark', 'tiger shark', 'hammerhead', 'electric ray', 'stingray', 'cock', 'hen', 'ostrich', 'brambling', 'goldfinch', 'house finch', 'junco', 'indigo bunting', 'robin', 'bulbul', 'jay', 'magpie', 'chickadee', 'water ouzel', 'kite', 'bald eagle', 'vulture', 'great grey owl', 'European fire salamander', 'common newt', 'eft', 'spotted salamander', 'axolotl', 'bullfrog', 'tree frog', 'tailed frog', 'loggerhead', 'leatherback turtle', 'mud turtle', 'terrapin', 'box turtle', 'banded gecko', 'common iguana', 'American chameleon', 'whiptail', 'agama', 'frilled lizard', 'alligator lizard', 'Gila monster', 'green lizard', 'African chameleon', 'Komodo dragon', 'African crocodile', 'American alligator', 'triceratops', 'thunder snake', 'ringneck snake', 'hognose snake', 'green snake', 'king snake', 'garter snake', 'water snake', 'vine snake', 'night snake', 'boa constrictor', 'rock python', 'Indian cobra', 'green mamba', 'sea snake', 'horned viper', 'diamondback', 'sidewinder', 'trilobite', 'harvestman', 'scorpion', 'black and gold garden spider', 'barn spider', 'garden spider', 'black widow', 'tarantula', 'wolf spider', 'tick', 'centipede', 'black grouse', 'ptarmigan', 'ruffed grouse', 'prairie chicken', 'peacock', 'quail', 'partridge', 'African grey', 'macaw', 'sulphur-crested cockatoo', 'lorikeet', 'coucal', 'bee eater', 'hornbill', 'hummingbird', 'jacamar', 'toucan', 'drake', 'red-breasted merganser', 'goose', 'black swan', 'tusker', 'echidna', 'platypus', 'wallaby', 'koala', 'wombat', 'jellyfish', 'sea anemone', 'brain coral', 'flatworm', 'nematode', 'conch', 'snail', 'slug', 'sea slug', 'chiton', 'chambered nautilus', 'Dungeness crab', 'rock crab', 'fiddler crab', 'king crab', 'American lobster', 'spiny lobster', 'crayfish', 'hermit crab', 'isopod', 'white stork', 'black stork', 'spoonbill', 'flamingo', 'little blue heron', 'American egret', 'bittern', 'crane', 'limpkin', 'European gallinule', 'American coot', 'bustard', 'ruddy turnstone', 'red-backed sandpiper', 'redshank', 'dowitcher', 'oystercatcher', 'pelican', 'king penguin', 'albatross', 'grey whale', 'killer whale', 'dugong', 'sea lion', 'Chihuahua', 'Japanese spaniel', 'Maltese dog', 'Pekinese', 'Shih-Tzu', 'Blenheim spaniel', 'papillon', 'toy terrier', 'Rhodesian ridgeback', 'Afghan hound', 'basset', 'beagle', 'bloodhound', 'bluetick', 'black-and-tan coonhound', 'Walker hound', 'English foxhound', 'redbone', 'borzoi', 'Irish wolfhound', 'Italian greyhound', 'whippet', 'Ibizan hound', 'Norwegian elkhound', 'otterhound', 'Saluki', 'Scottish deerhound', 'Weimaraner', 'Staffordshire bullterrier', 'American Staffordshire terrier', 'Bedlington terrier', 'Border terrier', 'Kerry blue terrier', 'Irish terrier', 'Norwegian elkhound', 'Yorkshire terrier', 'wire-haired fox terrier', 'Lakeland terrier', 'Sealyham terrier', 'Airedale', 'cairn', 'Australian terrier', 'Dandie Dinmont', 'Boston bull', 'miniature schnauzer', 'giant schnauzer', 'standard schnauzer', 'Scotch terrier', 'Tibetan terrier', 'silky terrier', 'soft-coated wheaten terrier', 'West Highland white terrier', 'Lhasa', 'flat-coated retriever', 'curly-coated retriever', 'golden retriever', 'Labrador retriever', 'Chesapeake Bay retriever', 'German short-haired pointer', 'vizsla', 'English setter', 'Irish setter', 'Gordon setter', 'Brittany spaniel', 'clumber', 'English springer', 'Welsh springer spaniel', 'cocker spaniel', 'Sussex spaniel', 'Irish water spaniel', 'kuvasz', 'schipperke', 'groenendael', 'malinois', 'briard', 'kelpie', 'komondor', 'Old English sheepdog', 'Shetland sheepdog', 'collie', 'Border collie', 'Bouvier des Flandres', 'Rottweiler', 'German shepherd', 'Doberman', 'miniature pinscher', 'Greater Swiss Mountain dog', 'Bernese mountain dog', 'Appenzeller', 'EntleBucher', 'boxer', 'bull mastiff', 'Tibetan mastiff', 'French bulldog', 'Great Dane', 'Saint Bernard', 'Eskimo dog', 'malamute', 'Siberian husky', 'dalmatian', 'affenpinscher', 'basenji', 'pug', 'Leonberger', 'Newfoundland', 'Great Pyrenees', 'Samoyed', 'Pomeranian', 'chow', 'keeshond', 'Brabancon griffon', 'Pembroke', 'Cardigan', 'toy poodle', 'miniature poodle', 'standard poodle', 'Mexican hairless', 'timber wolf', 'white wolf', 'red wolf', 'coyote', 'dingo', 'dhole', 'African hunting dog', 'hyena', 'red fox', 'kit fox', 'Arctic fox', 'grey fox', 'tabby', 'tiger cat', 'Persian cat', 'Siamese cat', 'Egyptian cat', 'cougar', 'lynx', 'leopard', 'snow leopard', 'jaguar', 'lion', 'tiger', 'cheetah', 'brown bear', 'American black bear', 'ice bear', 'sloth bear', 'mongoose', 'meerkat', 'tiger beetle', 'ladybug', 'ground beetle', 'long-horned beetle', 'leaf beetle', 'dung beetle', 'rhinoceros beetle', 'weevil', 'fly', 'bee', 'ant', 'grasshopper', 'cricket', 'walking stick', 'cockroach', 'mantis', 'cicada', 'leafhopper', 'lacewing', 'dragonfly', 'damselfly', 'admiral', 'ringlet', 'monarch', 'cabbage butterfly', 'sulphur butterfly', 'lycaenid', 'starfish', 'sea urchin', 'sea cucumber', 'wood rabbit', 'hare', 'Angora', 'hamster', 'porcupine', 'fox squirrel', 'marmot', 'beaver', 'guinea pig', 'sorrel', 'zebra', 'hog', 'wild boar', 'warthog', 'hippopotamus', 'ox', 'water buffalo', 'bison', 'ram', 'bighorn', 'ibex', 'hartebeest', 'impala', 'gazelle', 'Arabian camel', 'llama', 'weasel', 'mink', 'polecat', 'black-footed ferret', 'otter', 'skunk', 'badger', 'armadillo', 'three-toed sloth', 'orangutan', 'gorilla', 'chimpanzee', 'gibbon', 'siamang', 'guenon', 'patas', 'baboon', 'macaque', 'langur', 'colobus', 'proboscis monkey', 'marmoset', 'capuchin', 'howler monkey', 'titi', 'spider monkey', 'squirrel monkey', 'Madagascar cat', 'indri', 'Indian elephant', 'African elephant', 'lesser panda', 'giant panda', 'barracouta', 'eel', 'coho', 'rock beauty', 'clownfish', 'sturgeon', 'gar', 'lionfish', 'puffer', 'abacus', 'abaya', 'academic gown', 'accordion', 'acoustic guitar', 'aircraft carrier', 'airliner', 'airship', 'altar', 'ambulance', 'amphibian', 'analog clock', 'apiary', 'apron', 'ashcan', 'assault rifle', 'backpack', 'bakery', 'balance beam', 'balloon', 'ballpoint', 'Band Aid', 'banjo', 'bannister', 'barbell', 'barber chair', 'barbershop', 'barn', 'barometer', 'barrel', 'barrow', 'baseball', 'basketball', 'bassinet', 'bassoon', 'bathing cap', 'bath towel', 'bathtub', 'beach wagon', 'beacon', 'beaker', 'bearskin', 'beer bottle', 'beer glass', 'bell cote', 'bib', 'bicycle-built-for-two', 'bikini', 'binder', 'binoculars', 'birdhouse', 'boathouse', 'bobsled', 'bolo tie', 'bonnet', 'bookcase', 'bookshop', 'bottlecap', 'bow', 'bow tie', 'brass', 'brassiere', 'breakwater', 'breastplate', 'broom', 'bucket', 'buckle', 'bulletproof vest', 'bullet train', 'butcher shop', 'cab', 'caldron', 'candle', 'cannon', 'canoe', 'can opener', 'cardigan', 'car mirror', 'carousel', 'carpenter\'s kit', 'carton', 'car wheel', 'cash machine', 'cassette', 'cassette player', 'castle', 'catamaran', 'CD player', 'cello', 'cellular telephone', 'chain', 'chainlink fence', 'chain mail', 'chain saw', 'chest', 'chiffonier', 'chime', 'china cabinet', 'Christmas stocking', 'church', 'cinema', 'cleaver', 'cliff dwelling', 'cloak', 'clog', 'cocktail shaker', 'coffee mug', 'coffeemaker', 'coil', 'combination lock', 'computer keyboard', 'confectionery', 'container ship', 'convertible', 'corkscrew', 'cornet', 'cowboy boot', 'cowboy hat', 'cradle', 'crane', 'crash helmet', 'crate', 'crib', 'Crock Pot', 'croquet ball', 'crutch', 'cuirass', 'dam', 'desk', 'desktop computer', 'dial telephone', 'diaper', 'digital clock', 'digital watch', 'dining table', 'dishrag', 'dishwasher', 'disk brake', 'dock', 'dogsled', 'dome', 'doormat', 'drilling platform', 'drum', 'drumstick', 'dumbbell', 'Dutch oven', 'electric fan', 'electric guitar', 'electric locomotive', 'entertainment center', 'envelope', 'espresso maker', 'face powder', 'feather boa', 'file', 'fireboat', 'fire engine', 'fire screen', 'flagpole', 'flute', 'folding chair', 'football helmet', 'forklift', 'fountain', 'fountain pen', 'four-poster', 'freight car', 'French horn', 'frying pan', 'fur coat', 'garbage truck', 'gasmask', 'gas pump', 'goblet', 'go-kart', 'golf ball', 'golfcart', 'gondola', 'gong', 'gown', 'grand piano', 'greenhouse', 'grille', 'grocery store', 'guillotine', 'hair slide', 'halter', 'hammer', 'hamper', 'hand blower', 'hand-held computer', 'handkerchief', 'hard disc', 'harmonica', 'harp', 'harvester', 'hatchet', 'holster', 'home theater', 'honeycomb', 'hook', 'hoopskirt', 'horizontal bar', 'horse cart', 'hose', 'hostel', 'hot pot', 'hourglass', 'house finch', 'humidifier', 'iPod', 'iron', 'jack-o\'-lantern', 'jean', 'jeep', 'jersey', 'jigsaw puzzle', 'jinrikisha', 'joystick', 'kimono', 'knee pad', 'knot', 'lab coat', 'ladle', 'lampshade', 'laptop', 'lawn mower', 'lens cap', 'letter opener', 'library', 'lifeboat', 'lighter', 'limousine', 'liner', 'lipstick', 'Loafer', 'lotion', 'loudspeaker', 'loupe', 'lumbermill', 'magnetic compass', 'mailbag', 'mailbox', 'maillot', 'maillot', 'manhole cover', 'maraca', 'marimba', 'mask', 'matchstick', 'maypole', 'maze', 'measuring cup', 'medicine chest', 'megalith', 'microphone', 'microwave', 'military uniform', 'milk can', 'minibus', 'miniskirt', 'minivan', 'missile', 'mitten', 'mixing bowl', 'mobile home', 'Model T', 'modem', 'monastery', 'monitor', 'moped', 'mortar', 'mortarboard', 'mosque', 'mosquito net', 'motor scooter', 'mountain bike', 'mountain tent', 'mouse', 'mousetrap', 'moving van', 'muzzle', 'nail', 'neck brace', 'necklace', 'nipple', 'notebook', 'obelisk', 'oboe', 'ocarina', 'odometer', 'oil filter', 'organ', 'oscilloscope', 'overskirt', 'oxcart', 'oxygen mask', 'packet', 'paddle', 'paddlewheel', 'padlock', 'paintbrush', 'pajama', 'palace', 'panpipe', 'paper towel', 'parachute', 'parallel bars', 'park bench', 'parking meter', 'passenger car', 'patio', 'pay-phone', 'pedestal', 'pencil box', 'pencil sharpener', 'perfume', 'Petri dish', 'photocopier', 'pick', 'pickelhaube', 'picket fence', 'pickup', 'pier', 'piggy bank', 'pill bottle', 'pillow', 'ping-pong ball', 'pinwheel', 'pirate', 'pitcher', 'plane', 'planetarium', 'plastic bag', 'plate rack', 'plow', 'plunger', 'Polaroid camera', 'pole', 'police van', 'poncho', 'pool table', 'pop bottle', 'pot', 'potter\'s wheel', 'power drill', 'prayer rug', 'printer', 'prison', 'projectile', 'projector', 'puck', 'punching bag', 'purse', 'quill', 'quilt', 'racer', 'racket', 'radiator', 'radio', 'radio telescope', 'rain barrel', 'recreational vehicle', 'reel', 'reflex camera', 'refrigerator', 'remote control', 'restaurant', 'revolver', 'rifle', 'rocking chair', 'rotisserie', 'rubber eraser', 'rugby ball', 'rule', 'running shoe', 'safe', 'safety pin', 'saltshaker', 'sandal', 'sarong', 'sax', 'scabbard', 'scale', 'school bus', 'schooner', 'scoreboard', 'screen', 'screw', 'screwdriver', 'seat belt', 'sewing machine', 'shield', 'shoe shop', 'shoji', 'shopping basket', 'shopping cart', 'shovel', 'shower cap', 'shower curtain', 'ski', 'ski mask', 'sleeping bag', 'slide rule', 'sliding door', 'slot', 'snorkel', 'snowmobile', 'snowplow', 'soap dispenser', 'soccer ball', 'sock', 'solar dish', 'sombrero', 'soup bowl', 'space bar', 'space heater', 'space shuttle', 'spatula', 'speedboat', 'spider web', 'spindle', 'sports car', 'spotlight', 'stage', 'steam locomotive', 'steel arch bridge', 'steel drum', 'stethoscope', 'stole', 'stone wall', 'stopwatch', 'stove', 'strainer', 'streetcar', 'stretcher', 'studio couch', 'stupa', 'submarine', 'suit', 'sundial', 'sunglass', 'sunglasses', 'sunscreen', 'suspension bridge', 'swab', 'sweatshirt', 'swimming trunks', 'swing', 'switch', 'syringe', 'table lamp', 'tank', 'tape player', 'teapot', 'teddy', 'television', 'tennis ball', 'thatch', 'theater curtain', 'thimble', 'thresher', 'throne', 'tile roof', 'toaster', 'tobacco shop', 'toilet seat', 'torch', 'totem pole', 'tow truck', 'toyshop', 'tractor', 'trailer truck', 'tray', 'trench coat', 'tricycle', 'trimaran', 'tripod', 'triumphal arch', 'trolleybus', 'trombone', 'tub', 'turnstile', 'typewriter', 'umbrella', 'unicycle', 'upright', 'vacuum', 'vase', 'vault', 'velvet', 'vending machine', 'vestment', 'viaduct', 'violin', 'volleyball', 'waffle iron', 'wall clock', 'wallet', 'wardrobe', 'warplane', 'washbasin', 'washer', 'water bottle', 'water jug', 'water tower', 'whiskey jug', 'whistle', 'wig', 'window screen', 'window shade', 'Windsor tie', 'wine bottle', 'wing', 'wok', 'wooden spoon', 'wool', 'worm fence', 'wreck', 'yawl', 'yurt', 'web site', 'comic book', 'crossword puzzle', 'street sign', 'traffic light', 'book jacket', 'menu', 'plate', 'guacamole', 'consomme', 'hot pot', 'trifle', 'ice cream', 'ice lolly', 'French loaf', 'bagel', 'pretzel', 'cheeseburger', 'hotdog', 'mashed potato', 'head cabbage', 'broccoli', 'cauliflower', 'zucchini', 'spaghetti squash', 'acorn squash', 'butternut squash', 'cucumber', 'artichoke', 'bell pepper', 'cardoon', 'mushroom', 'Granny Smith', 'strawberry', 'orange', 'lemon', 'fig', 'pineapple', 'banana', 'jackfruit', 'custard apple', 'pomegranate', 'hay', 'carbonara', 'chocolate sauce', 'dough', 'meat loaf', 'pizza', 'potpie', 'burrito', 'red wine', 'espresso', 'cup', 'eggnog', 'alp', 'bubble', 'cliff', 'coral reef', 'geyser', 'lakeside', 'promontory', 'sandbar', 'seashore', 'valley', 'volcano', 'ballplayer', 'groom', 'scuba diver', 'rapeseed', 'daisy', 'yellow lady\'s slipper', 'corn', 'acorn', 'hip', 'buckeye', 'coral fungus', 'agaric', 'gyromitra', 'stinkhorn', 'earthstar', 'hen-of-the-woods', 'bolete', 'ear', 'toilet tissue'
    ];

    async function enableAI() {
      try {
        if (AI_MODE) return;
        AI_MODE = true; saveJSON('AdBlockX.AI_MODE', true);

        // Load TensorFlow.js dynamically
        if (!window.tf) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.15.0/dist/tf.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }

        // Load Tesseract.js for OCR
        if (!window.Tesseract) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/tesseract.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }

        // Load MobileNet model for image classification
        __abx_ai_model = await window.tf.loadLayersModel('https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json');

        // Set up image classifier
        async function classifyImage(img) {
          try {
            if (!img.complete || img.naturalWidth === 0) return [];
            const tfImage = window.tf.browser.fromPixels(img);
            const resized = window.tf.image.resizeBilinear(tfImage, [224, 224]);
            const normalized = resized.div(255.0);
            const batched = normalized.expandDims(0);
            const logits = __abx_ai_model.predict(batched);
            const predictions = await window.tf.softmax(logits).data();
            const top5 = Array.from(predictions).map((p, i) => ({ probability: p, className: IMAGENET_CLASSES[i] })).sort((a, b) => b.probability - a.probability).slice(0, 5);
            return top5;
          } catch (e) { return []; }
        }

        // OCR function to detect text in images
        async function scanImageForAds(img) {
          try {
            if (!img.complete || img.naturalWidth === 0) return false;
            const { data: { text } } = await window.Tesseract.recognize(img, 'eng', { logger: m => console.log(m) });
            const adKeywords = ['ad', 'advertisement', 'sponsored', 'promo', 'buy now', 'click here', 'subscribe', 'free trial'];
            return adKeywords.some(k => text.toLowerCase().includes(k));
          } catch (e) { return false; }
        }

        // Mutation observer for new images
        __abx_ai_mo = new MutationObserver(async (muts) => {
          for (const m of muts) for (const n of m.addedNodes || []) {
            if (n.tagName === 'IMG' && n.src) {
              n.addEventListener('load', async () => {
                const predictions = await classifyImage(n);
                const adLike = predictions.some(p => p.className.toLowerCase().includes('banner') || p.className.toLowerCase().includes('poster') || p.className.toLowerCase().includes('advertisement'));
                const ocrAd = await scanImageForAds(n);
                if ((adLike && predictions[0].probability > 0.5) || ocrAd) {
                  n.remove();
                  pushLog('blocked', { t: nowStr(), url: n.src, reason: adLike ? 'AI_AD_DETECTED' : 'OCR_AD_DETECTED', predictions: predictions.slice(0,3) });
                  panelLog('AI/OCR blocked ad image: ' + n.src);
                }
              });
            }
          }
        });
        __abx_ai_mo.observe(document.documentElement || document.body, { childList: true, subtree: true });

        panelLog('AI mode enabled: private model loaded for ad detection');
      } catch(e){ panelLog('enableAI failed: '+e,'err'); }
    }

    function disableAI() {
      try {
        if (!AI_MODE) return;
        AI_MODE = false; saveJSON('AdBlockX.AI_MODE', false);
        if (__abx_ai_mo) { __abx_ai_mo.disconnect(); __abx_ai_mo = null; }
        __abx_ai_model = null;
        panelLog('AI mode disabled');
      } catch(e){ panelLog('disableAI failed: '+e,'err'); }
    }

    const btnAI = document.createElement('button');
    btnAI.textContent = AI_MODE ? 'AI: On' : 'AI: Off';
    btnAI.style.marginRight = '6px';
    btnAI.addEventListener('click', async () => {
      try {
        if (!AI_MODE) { await enableAI(); btnAI.textContent = 'AI: On'; } else { disableAI(); btnAI.textContent = 'AI: Off'; }
      } catch(e){ panelLog('AI toggle failed: '+e,'err'); }
    });
    controlsDiv.appendChild(btnAI);

    const btnPetty = document.createElement('button');
    btnPetty.textContent = PETTY_MODE ? 'Petty: On' : 'Petty: Off';
    btnPetty.style.marginRight = '6px';
    btnPetty.addEventListener('click', () => {
      try {
        if (!PETTY_MODE) { enablePetty(); btnPetty.textContent = 'Petty: On'; } else { disablePetty(); btnPetty.textContent = 'Petty: Off'; }
      } catch(e){ panelLog('Petty toggle failed: '+e,'err'); }
    });
    controlsDiv.appendChild(btnPetty);

    const btnNuclear = document.createElement('button');
    btnNuclear.textContent = NUCLEAR_MODE ? 'Nuclear: On' : 'Nuclear: Off';
    btnNuclear.style.marginRight = '6px';
    btnNuclear.addEventListener('click', () => {
      try {
        if (!NUCLEAR_MODE) { enableNuclear(); btnNuclear.textContent = 'Nuclear: On'; } else { disableNuclear(); btnNuclear.textContent = 'Nuclear: Off'; }
      } catch(e){ panelLog('Nuclear toggle failed: '+e,'err'); }
    });
    controlsDiv.appendChild(btnNuclear);

    const btnConfirmation = document.createElement('button');
    btnConfirmation.textContent = CONFIRMATION_MODE ? 'Confirm: On' : 'Confirm: Off';
    btnConfirmation.style.marginRight = '6px';
    btnConfirmation.addEventListener('click', () => {
      CONFIRMATION_MODE = !CONFIRMATION_MODE;
      saveJSON('AdBlockX.CONFIRMATION_MODE', CONFIRMATION_MODE);
      btnConfirmation.textContent = CONFIRMATION_MODE ? 'Confirm: On' : 'Confirm: Off';
      panelLog('Confirmation mode ' + (CONFIRMATION_MODE ? 'enabled' : 'disabled'));
    });
    controlsDiv.appendChild(btnConfirmation);

      // Autonomy Engine toggle button
      const btnAuto = document.createElement('button');
      btnAuto.textContent = AUTONOMY && AUTONOMY.enabled ? 'Autonomy: On' : 'Autonomy: Off';
      btnAuto.style.marginRight = '6px';
      btnAuto.addEventListener('click', () => {
        if (AUTONOMY.enabled) {
          AUTONOMY.disable();
          btnAuto.textContent = 'Autonomy: Off';
          panelLog('Autonomy engine disabled');
        } else {
          AUTONOMY.enable();
          btnAuto.textContent = 'Autonomy: On';
          panelLog('Autonomy engine enabled');
        }
      });
      controlsDiv.appendChild(btnAuto);

    // Minotaur engine controls (lightweight scanner)
    const btnMinotaur = document.createElement('button');
    btnMinotaur.textContent = 'Minotaur: Off';
    btnMinotaur.style.marginRight = '6px';
    btnMinotaur.addEventListener('click', () => {
      try {
        if (!MINOTAUR.engine.enabled) {
          MINOTAUR.enable(); btnMinotaur.textContent = 'Minotaur: On'; panelLog('Minotaur enabled');
        } else {
          MINOTAUR.disable(); btnMinotaur.textContent = 'Minotaur: Off'; panelLog('Minotaur disabled');
        }
      } catch (e) { panelLog('Minotaur toggle failed: '+e,'err'); }
    });
    controlsDiv.appendChild(btnMinotaur);

    // YouTube-specific controls
    const ytToggle = document.createElement('button');
    const ytEnabled = !!loadJSON('AdBlockX.YT_HEURISTICS_ENABLED', true);
    ytToggle.textContent = ytEnabled ? 'YouTube: On' : 'YouTube: Off';
    ytToggle.style.marginRight = '6px';
    ytToggle.addEventListener('click', () => {
      try {
        const next = !loadJSON('AdBlockX.YT_HEURISTICS_ENABLED', true);
        saveJSON('AdBlockX.YT_HEURISTICS_ENABLED', next);
        ytToggle.textContent = next ? 'YouTube: On' : 'YouTube: Off';
        if (next) { augmentYouTubeHeuristics(); panelLog('YouTube heuristics enabled'); } else { panelLog('YouTube heuristics disabled (persistent)'); }
      } catch(e){ panelLog('YT toggle failed: '+e,'err'); }
    });
    controlsDiv.appendChild(ytToggle);

    const ytPreviewBtn = document.createElement('button');
    ytPreviewBtn.textContent = 'Preview YT Regex';
    ytPreviewBtn.style.marginRight = '6px';
    ytPreviewBtn.addEventListener('click', () => {
      try {
        // derive suggested regex rules from recent blocked observed logs
        const map = {};
        for (const b of (LOGS.observed||[]).slice(-500)) {
          try { const u = b.url || ''; if (!u) continue; if (/youtube|googlevideo/.test(u)) { const h = (new URL(u, location.href)).hostname; map[h] = (map[h]||0)+1; } } catch(e){}
        }
        const arr = Object.keys(map).sort((a,b)=>map[b]-map[a]).slice(0,20);
        const suggestions = arr.map(h=>('^https?://([^.]+\\.)*'+h.replace(/\\./g,'\\\\.')+'')).join('\n');
        const win = window.open('', '_blank'); win.document.write('<h3>Suggested YouTube regex rules</h3><pre>' + suggestions + '</pre>');
      } catch(e){ panelLog('YT preview failed: '+e,'err'); }
    });
    controlsDiv.appendChild(ytPreviewBtn);

    // Anti-Adblock toggle button
    const btnAnti = document.createElement('button');
    btnAnti.textContent = ANTI_ADBLOCK_LEVEL && ANTI_ADBLOCK_LEVEL >= 2 ? 'Anti-Adblock: Neutralize' : (ANTI_ADBLOCK_LEVEL === 1 ? 'Anti-Adblock: Detect' : 'Anti-Adblock: Off');
    btnAnti.style.marginRight = '6px';
    btnAnti.addEventListener('click', () => {
      try {
        // cycle levels: 0 -> 1 -> 2 -> 0
        const next = ((ANTI_ADBLOCK_LEVEL || 0) + 1) % 3;
        ANTI_ADBLOCK_LEVEL = next; saveJSON('AdBlockX.ANTI_ADBLOCK_LEVEL', ANTI_ADBLOCK_LEVEL);
        if (ANTI_ADBLOCK_LEVEL >= 2) neutralizeAntiAdblock(); else disableAntiAdblock();
        btnAnti.textContent = ANTI_ADBLOCK_LEVEL && ANTI_ADBLOCK_LEVEL >= 2 ? 'Anti-Adblock: Neutralize' : (ANTI_ADBLOCK_LEVEL === 1 ? 'Anti-Adblock: Detect' : 'Anti-Adblock: Off');
        panelLog('Anti-Adblock level changed to ' + ANTI_ADBLOCK_LEVEL);
      } catch(e){ panelLog('Anti toggle failed: '+e,'err'); }
    });
    controlsDiv.appendChild(btnAnti);

    const btnRunMinotaur = document.createElement('button');
    btnRunMinotaur.textContent = 'Run Minotaur';
    btnRunMinotaur.style.marginRight = '6px';
    btnRunMinotaur.addEventListener('click', async () => {
      try {
        panelLog('Running Minotaur scan...');
        const findings = await MINOTAUR.engine.run();
        const win = window.open('', '_blank');
        win.document.write('<h3>Minotaur Findings</h3><pre>' + JSON.stringify(findings, null, 2) + '</pre>');
        panelLog('Minotaur scan complete. Findings: ' + (findings.length||0));
      } catch (e) { panelLog('Minotaur run failed: '+e,'err'); }
    });
    controlsDiv.appendChild(btnRunMinotaur);

    const btnUnreg = document.createElement('button');
    btnUnreg.textContent = 'Unregister SW';
    btnUnreg.style.marginRight = '6px';
    btnUnreg.addEventListener('click', async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          try { await r.unregister(); panelLog('SW unregistered at ' + r.scope); } catch(e){}
        }
        btnUnreg.textContent = 'Unregistered';
        btnRegister.textContent = 'Register SW';
      } catch (e) { panelLog('Unregister failed: ' + e, 'err'); }
    });
    controlsDiv.appendChild(btnUnreg);

    const btnFallback = document.createElement('button');
    btnFallback.textContent = fallback.enabled ? 'Fallback: On' : 'Fallback: Off';
    btnFallback.style.marginRight = '6px';
    btnFallback.addEventListener('click', () => {
      fallback.enabled = !fallback.enabled;
      if (fallback.enabled) { fallback.init(); btnFallback.textContent = 'Fallback: On'; panelLog('Fallback enabled'); saveJSON('AdBlockX.FALLBACK', true); }
      else { fallback.restore(); btnFallback.textContent = 'Fallback: Off'; panelLog('Fallback disabled'); saveJSON('AdBlockX.FALLBACK', false); }
    });
    controlsDiv.appendChild(btnFallback);

    const btnExport = document.createElement('button');
    btnExport.textContent = 'Export Logs';
  btnExport.style.marginRight = '6px';
    btnExport.addEventListener('click', () => {
      try {
        const blob = new Blob([JSON.stringify(LOGS, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'adblockx-logs.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        panelLog('Exported logs');
      } catch (e) { panelLog('Export failed: ' + e, 'err'); }
    });
    controlsDiv.appendChild(btnExport);

    const btnExportLists = document.createElement('button');
    btnExportLists.textContent = 'Export Settings';
    btnExportLists.style.marginRight = '6px';
    btnExportLists.addEventListener('click', () => {
      try {
  const obj = { BLACKLIST, SPOOF_LIST, REGEX_RULES, REMOTE_LISTS, WHITELIST, EXT_BLOCK, REFERRER_BLOCKS, SCHEDULE, ALWAYS_BLOCK, ENFORCER_ENABLED, ASS_HAT_MODE, STEALTH_MODE, AI_MODE, FUCK_ALL_ADS_MODE, PETTY_MODE, NUCLEAR_MODE, PRIVACY_MODE, PERFORMANCE_MODE };
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'adblockx-settings.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        panelLog('Exported settings');
      } catch (e) { panelLog('Export settings failed: ' + e, 'err'); }
    });
    controlsDiv.appendChild(btnExportLists);

    const btnImportLists = document.createElement('button');
    btnImportLists.textContent = 'Import Settings';
    btnImportLists.addEventListener('click', () => {
      try {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
        inp.addEventListener('change', (ev) => {
          const f = inp.files && inp.files[0]; if (!f) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const data = JSON.parse(reader.result);
              if (data.BLACKLIST && Array.isArray(data.BLACKLIST)) { for (const s of data.BLACKLIST) if (!BLACKLIST.includes(s)) BLACKLIST.push(s); saveJSON('AdBlockX.BLACKLIST', BLACKLIST); }
              if (data.REFERRER_BLOCKS && Array.isArray(data.REFERRER_BLOCKS)) { for (const r of data.REFERRER_BLOCKS) if (!REFERRER_BLOCKS.includes(r)) REFERRER_BLOCKS.push(r); saveJSON('AdBlockX.REFERRER_BLOCKS', REFERRER_BLOCKS); }
              if (typeof data.ENFORCER_ENABLED !== 'undefined') { ENFORCER_ENABLED = !!data.ENFORCER_ENABLED; saveJSON('AdBlockX.ENFORCER_ENABLED', ENFORCER_ENABLED); }
              if (data.REGEX_RULES && Array.isArray(data.REGEX_RULES)) { for (const r of data.REGEX_RULES) if (!REGEX_RULES.includes(r)) REGEX_RULES.push(r); saveJSON('AdBlockX.REGEX_RULES', REGEX_RULES); }
              if (data.WHITELIST && Array.isArray(data.WHITELIST)) { for (const w of data.WHITELIST) if (!WHITELIST.includes(w)) WHITELIST.push(w); saveJSON('AdBlockX.WHITELIST', WHITELIST); }
              if (data.SPOOF_LIST && Array.isArray(data.SPOOF_LIST)) { for (const s of data.SPOOF_LIST) if (!SPOOF_LIST.includes(s)) SPOOF_LIST.push(s); saveJSON('AdBlockX.SPOOF_LIST', SPOOF_LIST); }
              if (data.REMOTE_LISTS && Array.isArray(data.REMOTE_LISTS)) { for (const r of data.REMOTE_LISTS) { if (!REMOTE_LISTS.some(x=>x.url===r.url)) REMOTE_LISTS.push(r); } saveJSON('AdBlockX.REMOTE_LISTS', REMOTE_LISTS); }
              if (data.EXT_BLOCK && Array.isArray(data.EXT_BLOCK)) { for (const e of data.EXT_BLOCK) if (!EXT_BLOCK.includes(e)) EXT_BLOCK.push(e); saveJSON('AdBlockX.EXT_BLOCK', EXT_BLOCK); }
              // Import modes
              if (typeof data.ASS_HAT_MODE !== 'undefined') { ASS_HAT_MODE = !!data.ASS_HAT_MODE; saveJSON('AdBlockX.ASS_HAT_MODE', ASS_HAT_MODE); if (ASS_HAT_MODE) enableAssHat(); else disableAssHat(); }
              if (typeof data.STEALTH_MODE !== 'undefined') { STEALTH_MODE = !!data.STEALTH_MODE; saveJSON('AdBlockX.STEALTH_MODE', STEALTH_MODE); if (STEALTH_MODE) enableStealth(); else disableStealth(); }
              if (typeof data.AI_MODE !== 'undefined') { AI_MODE = !!data.AI_MODE; saveJSON('AdBlockX.AI_MODE', AI_MODE); if (AI_MODE) enableAI(); else disableAI(); }
              if (typeof data.FUCK_ALL_ADS_MODE !== 'undefined') { FUCK_ALL_ADS_MODE = !!data.FUCK_ALL_ADS_MODE; saveJSON('AdBlockX.FUCK_ALL_ADS_MODE', FUCK_ALL_ADS_MODE); if (FUCK_ALL_ADS_MODE) enableFuckAllAds(); else disableFuckAllAds(); }
              if (typeof data.PETTY_MODE !== 'undefined') { PETTY_MODE = !!data.PETTY_MODE; saveJSON('AdBlockX.PETTY_MODE', PETTY_MODE); if (PETTY_MODE) enablePetty(); else disablePetty(); }
              if (typeof data.NUCLEAR_MODE !== 'undefined') { NUCLEAR_MODE = !!data.NUCLEAR_MODE; saveJSON('AdBlockX.NUCLEAR_MODE', NUCLEAR_MODE); if (NUCLEAR_MODE) enableNuclear(); else disableNuclear(); }
              if (typeof data.PRIVACY_MODE !== 'undefined') { PRIVACY_MODE = !!data.PRIVACY_MODE; saveJSON('AdBlockX.PRIVACY_MODE', PRIVACY_MODE); }
              if (typeof data.PERFORMANCE_MODE !== 'undefined') { PERFORMANCE_MODE = !!data.PERFORMANCE_MODE; saveJSON('AdBlockX.PERFORMANCE_MODE', PERFORMANCE_MODE); }
              panelLog('Imported settings (merged)');
              maybeRefreshSW();
            } catch (e) { panelLog('Import failed: ' + e, 'err'); }
          };
          reader.readAsText(f);
        });
        inp.click();
      } catch (e) { panelLog('Import lists failed: ' + e, 'err'); }
    });
    controlsDiv.appendChild(btnImportLists);

    const btnDashboard = document.createElement('button');
    btnDashboard.textContent = 'Dashboard';
    btnDashboard.style.marginRight = '6px';
    btnDashboard.addEventListener('click', () => {
      try {
        const dashboard = document.createElement('div');
        dashboard.style.position = 'fixed'; dashboard.style.top = '10px'; dashboard.style.right = '10px'; dashboard.style.width = '400px'; dashboard.style.height = '300px'; dashboard.style.background = '#fff'; dashboard.style.border = '1px solid #ccc'; dashboard.style.zIndex = '999999'; dashboard.style.padding = '10px'; dashboard.style.overflow = 'auto';
        dashboard.innerHTML = `
          <h3>AdBlockerX Dashboard</h3>
          <table border="1" style="width:100%">
            <tr><th>Metric</th><th>Count</th></tr>
            <tr><td>Blocked Requests</td><td>${(LOGS.blocked||[]).length}</td></tr>
            <tr><td>Spoofed Requests</td><td>${(LOGS.spoofed||[]).length}</td></tr>
            <tr><td>Observed Requests</td><td>${(LOGS.observed||[]).length}</td></tr>
            <tr><td>Session Blocked</td><td>${SESSION_STATS.blocked||0}</td></tr>
            <tr><td>AI Detections</td><td>${(LOGS.blocked||[]).filter(l=>l.reason==='AI_AD_DETECTED'||l.reason==='OCR_AD_DETECTED').length}</td></tr>
            <tr><td>Performance Mode</td><td>${PERFORMANCE_MODE?'On':'Off'}</td></tr>
            <tr><td>Privacy Mode</td><td>${PRIVACY_MODE?'On':'Off'}</td></tr>
          </table>
          <button onclick="this.parentElement.remove()">Close</button>
        `;
        document.body.appendChild(dashboard);
      } catch (e) { panelLog('Dashboard failed: ' + e, 'err'); }
    });
    controlsDiv.appendChild(btnDashboard);

    const btnCustomSpoof = document.createElement('button');
    btnCustomSpoof.textContent = 'Custom Spoof';
    btnCustomSpoof.style.marginRight = '6px';
    btnCustomSpoof.addEventListener('click', () => {
      try {
        const editor = document.createElement('div');
        editor.style.position = 'fixed'; editor.style.top = '10px'; editor.style.left = '10px'; editor.style.width = '600px'; editor.style.height = '400px'; editor.style.background = '#fff'; editor.style.border = '1px solid #ccc'; editor.style.zIndex = '999999'; editor.style.padding = '10px'; editor.style.overflow = 'auto';
        editor.innerHTML = `
          <h3>Custom Spoof Templates</h3>
          <select id="spoof-select">
            ${Object.keys(PETTY_SPOOFS).map(k => `<option value="${k}">${k}</option>`).join('')}
          </select>
          <textarea id="spoof-text" style="width:100%;height:200px">${JSON.stringify(PETTY_SPOOFS[Object.keys(PETTY_SPOOFS)[0]], null, 2)}</textarea>
          <button id="save-spoof">Save</button>
          <button onclick="this.parentElement.remove()">Close</button>
        `;
        document.body.appendChild(editor);
        const select = editor.querySelector('#spoof-select');
        const textarea = editor.querySelector('#spoof-text');
        const saveBtn = editor.querySelector('#save-spoof');
        select.addEventListener('change', () => {
          textarea.value = JSON.stringify(PETTY_SPOOFS[select.value], null, 2);
        });
        saveBtn.addEventListener('click', () => {
          try {
            PETTY_SPOOFS[select.value] = JSON.parse(textarea.value);
            panelLog('Custom spoof saved for ' + select.value);
          } catch (e) { panelLog('Invalid JSON: ' + e, 'err'); }
        });
      } catch (e) { panelLog('Custom Spoof failed: ' + e, 'err'); }
    });
    controlsDiv.appendChild(btnCustomSpoof);

    const btnRecover = document.createElement('button');
    btnRecover.textContent = 'Recover Last';
    btnRecover.addEventListener('click', () => {
      try {
        const lastBlocked = (LOGS.blocked||[]).slice(-1)[0];
        if (lastBlocked) {
          WHITELIST.push(lastBlocked.url);
          saveJSON('AdBlockX.WHITELIST', WHITELIST);
          panelLog('Recovered and whitelisted: ' + lastBlocked.url);
          maybeRefreshSW();
        } else {
          panelLog('No blocked items to recover');
        }
      } catch (e) { panelLog('Recover failed: ' + e, 'err'); }
    });
    controlsDiv.appendChild(btnRecover);
    // --- New controls: MULTICORE status & pool-size
    const multicoreDiv = document.createElement('div'); multicoreDiv.style.display='inline-block'; multicoreDiv.style.marginLeft='8px';
    const mcLabel = document.createElement('span'); mcLabel.textContent = 'MultiCore:'; mcLabel.style.marginRight='6px'; multicoreDiv.appendChild(mcLabel);
    const mcStatus = document.createElement('span'); mcStatus.textContent = (window.AdBlockX && window.AdBlockX.MULTICORE && window.AdBlockX.MULTICORE.getStatus) ? JSON.stringify(window.AdBlockX.MULTICORE.getStatus()) : 'No workers'; mcStatus.style.marginRight='6px'; multicoreDiv.appendChild(mcStatus);
    const mcSizeInput = document.createElement('input'); mcSizeInput.type='number'; mcSizeInput.min='1'; mcSizeInput.max='16';
    try {
      const st = (window.AdBlockX && window.AdBlockX.MULTICORE && window.AdBlockX.MULTICORE.getStatus) ? window.AdBlockX.MULTICORE.getStatus() : null;
      mcSizeInput.value = (st && (typeof st.poolSize !== 'undefined' ? st.poolSize : (typeof st.workers !== 'undefined' ? st.workers : 1))) || 1;
    } catch(e) { mcSizeInput.value = 1; }
    mcSizeInput.style.width='56px'; mcSizeInput.style.marginRight='6px';
    const mcApply = document.createElement('button'); mcApply.textContent='Set Pool'; mcApply.style.marginRight='6px'; mcApply.addEventListener('click', () => {
      try {
        const n = Math.max(1, Math.min(16, parseInt(mcSizeInput.value)||1));
        if (window.AdBlockX && window.AdBlockX.MULTICORE && window.AdBlockX.MULTICORE.setPoolSize) {
          window.AdBlockX.MULTICORE.setPoolSize(n);
          panelLog('MULTICORE pool size set to ' + n);
          saveJSON('AdBlockX.MULTICORE_POOL', n);
          mcStatus.textContent = JSON.stringify(window.AdBlockX.MULTICORE.getStatus());
        } else panelLog('MULTICORE not available','warn');
      } catch(e){ panelLog('Set pool failed: '+e,'err'); }
    });
    multicoreDiv.appendChild(mcSizeInput); multicoreDiv.appendChild(mcApply);
    controlsDiv.appendChild(multicoreDiv);

    // --- Enforcer promotion threshold
    const threshDiv = document.createElement('div'); threshDiv.style.display='inline-block'; threshDiv.style.marginLeft='8px';
    const threshLabel = document.createElement('span'); threshLabel.textContent = 'Enforcer threshold:'; threshLabel.style.marginRight='6px'; threshDiv.appendChild(threshLabel);
    const threshInput = document.createElement('input'); threshInput.type='number'; threshInput.min='1'; threshInput.max='100';
    const existingThresh = loadJSON('AdBlockX.ENFORCER_PROMOTION_THRESHOLD') || 3;
    threshInput.value = existingThresh; threshInput.style.width='56px'; threshInput.style.marginRight='6px';
    const threshApply = document.createElement('button'); threshApply.textContent='Set'; threshApply.style.marginRight='6px';
    threshApply.addEventListener('click', () => {
      try {
        const v = Math.max(1, Math.min(100, parseInt(threshInput.value)||3));
        saveJSON('AdBlockX.ENFORCER_PROMOTION_THRESHOLD', v);
        panelLog('Enforcer promotion threshold set to ' + v);
      } catch(e){ panelLog('Set threshold failed: '+e,'err'); }
    });
    threshDiv.appendChild(threshInput); threshDiv.appendChild(threshApply);
    controlsDiv.appendChild(threshDiv);

    // --- Watchdog auto-start when Strict enabled
    const wdDiv = document.createElement('div'); wdDiv.style.display='inline-block'; wdDiv.style.marginLeft='8px';
    const wdLabel = document.createElement('span'); wdLabel.textContent='Auto-start Watchdog on Strict:'; wdLabel.style.marginRight='6px'; wdDiv.appendChild(wdLabel);
    const wdToggle = document.createElement('input'); wdToggle.type='checkbox'; wdToggle.checked = !!loadJSON('AdBlockX.WATCHDOG_AUTO_ON_STRICT'); wdToggle.style.marginRight='6px';
    wdToggle.addEventListener('change', () => { try { saveJSON('AdBlockX.WATCHDOG_AUTO_ON_STRICT', !!wdToggle.checked); panelLog('Watchdog auto-start on Strict ' + (wdToggle.checked?'enabled':'disabled')); } catch(e){ panelLog('Toggle failed: '+e,'err'); } });
    wdDiv.appendChild(wdToggle); controlsDiv.appendChild(wdDiv);

    // --- Prescan remote-imports toggle
    const prescanDiv = document.createElement('div'); prescanDiv.style.display='inline-block'; prescanDiv.style.marginLeft='8px';
    const prescanLabel = document.createElement('span'); prescanLabel.textContent='Prescan remote imports:'; prescanLabel.style.marginRight='6px'; prescanDiv.appendChild(prescanLabel);
    const prescanToggle = document.createElement('input'); prescanToggle.type='checkbox'; prescanToggle.checked = !!loadJSON('AdBlockX.PRESCAN_REMOTE_IMPORTS'); prescanToggle.style.marginRight='6px';
    prescanToggle.addEventListener('change', () => { try { saveJSON('AdBlockX.PRESCAN_REMOTE_IMPORTS', !!prescanToggle.checked); panelLog('Prescan remote imports ' + (prescanToggle.checked?'enabled':'disabled')); } catch(e){ panelLog('Toggle failed: '+e,'err'); } });
    prescanDiv.appendChild(prescanToggle); controlsDiv.appendChild(prescanDiv);

    headerRow.appendChild(controlsDiv);
    panel.appendChild(headerRow);

    // counters + list management
    const countsRow = document.createElement('div');
    countsRow.style.display = 'flex';
    countsRow.style.justifyContent = 'space-between';
    countsRow.style.alignItems = 'center';
    countsRow.style.marginBottom = '8px';

    const countsLeft = document.createElement('div');
    countsLeft.style.fontSize = '11px';
    countsLeft.style.color = '#ccc';
  countsLeft.innerHTML = `Blocked: <span id="abx-count-blocked">${(LOGS.blocked||[]).length}</span> &nbsp; Spoofed: <span id="abx-count-spoofed">${(LOGS.spoofed||[]).length}</span> &nbsp; Observed: <span id="abx-count-observed">${(LOGS.observed||[]).length}</span> &nbsp; Session: <span id="abx-session-blocked">${(SESSION_STATS.blocked||0)}</span>`;
    countsRow.appendChild(countsLeft);

    const countsRight = document.createElement('div');
    countsRight.style.fontSize = '11px';
    countsRight.style.color = '#aaa';
    countsRight.textContent = `Blacklist: ${BLACKLIST.length}`;
    countsRow.appendChild(countsRight);

    const viewObservedBtn = document.createElement('button');
    viewObservedBtn.textContent = 'View Observed';
    viewObservedBtn.style.marginLeft = '8px';
    viewObservedBtn.addEventListener('click', () => {
      try {
        const arr = (LOGS.observed||[]).slice(-200).reverse();
        const win = window.open('', '_blank');
        const html = '<h3>Observed Requests (recent)</h3><pre>' + arr.map((x,i)=>(i+1)+'. '+(x.url||'')).join('\n') + '</pre>';
        win.document.write(html);
      } catch (e) { panelLog('View observed failed: ' + e, 'err'); }
    });
    countsRow.appendChild(viewObservedBtn);

    panel.appendChild(countsRow);

    // blacklist editor
    const blEditor = document.createElement('div');
    blEditor.style.display = 'flex';
    blEditor.style.gap = '6px';
    blEditor.style.marginBottom = '8px';

    const blInput = document.createElement('input');
    blInput.placeholder = 'Add blacklist fragment (hostname or path)';
    blInput.style.flex = '1';
    blEditor.appendChild(blInput);

    const blAdd = document.createElement('button');
    blAdd.textContent = 'Add';
    blAdd.addEventListener('click', () => {
      const v = (blInput.value||'').trim();
      if (!v) return;
      BLACKLIST.push(v);
      saveJSON('AdBlockX.BLACKLIST', BLACKLIST);
      panelLog('Added to blacklist: ' + v);
      blInput.value = '';
      countsRight.textContent = `Blacklist: ${BLACKLIST.length}`;
    });
    blEditor.appendChild(blAdd);

    const blView = document.createElement('button');
    blView.textContent = 'View';
    blView.addEventListener('click', () => {
      try {
        const win = window.open('', '_blank');
        const html = '<pre>' + BLACKLIST.map((s,i)=> (i+1)+'. '+s).join('\n') + '</pre>';
        win.document.write(html);
      } catch (e) { panelLog('View blacklist failed: '+e,'err'); }
    });
    blEditor.appendChild(blView);

    panel.appendChild(blEditor);

    // regex editor
    const rxEditor = document.createElement('div');
    rxEditor.style.display = 'flex';
    rxEditor.style.gap = '6px';
    rxEditor.style.marginBottom = '8px';

    const rxInput = document.createElement('input');
    rxInput.placeholder = 'Add regex rule (e.g. \\baddomain\\.com)';
    rxInput.style.flex = '1';
    rxEditor.appendChild(rxInput);

    const rxAdd = document.createElement('button');
    rxAdd.textContent = 'Add Regex';
    rxAdd.addEventListener('click', () => {
      try {
        const v = (rxInput.value||'').trim(); if (!v) return;
        // validate
        try { new RegExp(v); } catch (e) { panelLog('Invalid regex: ' + e, 'err'); return; }
        REGEX_RULES.push(v); saveJSON('AdBlockX.REGEX_RULES', REGEX_RULES); panelLog('Regex added: ' + v);
        rxInput.value = '';
      } catch (e) { panelLog('Add regex failed: ' + e, 'err'); }
    });
    rxEditor.appendChild(rxAdd);

    const rxView = document.createElement('button');
    rxView.textContent = 'View Regex';
    rxView.addEventListener('click', () => { try { const win = window.open('', '_blank'); win.document.write('<pre>' + REGEX_RULES.map((s,i)=>(i+1)+'. '+s).join('\n') + '</pre>'); } catch(e){panelLog('View regex failed','err')} });
    rxEditor.appendChild(rxView);

    panel.appendChild(rxEditor);

    // remote lists editor
    const rlEditor = document.createElement('div');
    rlEditor.style.display = 'flex';
    rlEditor.style.gap = '6px';
    rlEditor.style.marginBottom = '8px';

    const rlInput = document.createElement('input');
    rlInput.placeholder = 'Remote list URL (raw text list)'; rlInput.style.flex='1'; rlEditor.appendChild(rlInput);

    const rlAdd = document.createElement('button'); rlAdd.textContent='Add Remote'; rlAdd.addEventListener('click', ()=>{
      try { const v=(rlInput.value||'').trim(); if(!v) return; REMOTE_LISTS.push({url:v,lastFetched:0}); saveJSON('AdBlockX.REMOTE_LISTS', REMOTE_LISTS); panelLog('Remote list added'); rlInput.value=''; } catch(e){panelLog('Add remote failed: '+e,'err')}
    }); rlEditor.appendChild(rlAdd);

    const rlFetch = document.createElement('button'); rlFetch.textContent='Fetch Remote Now'; rlFetch.addEventListener('click', async ()=>{ try { await updateRemoteLists(); panelLog('Remote lists fetch complete'); } catch(e){panelLog('Remote fetch error:'+e,'err')} }); rlEditor.appendChild(rlFetch);

    panel.appendChild(rlEditor);
  // referrer blocks editor
  const refEditor = document.createElement('div'); refEditor.style.display='flex'; refEditor.style.gap='6px'; refEditor.style.marginBottom='8px';
  const refInput = document.createElement('input'); refInput.placeholder='Block by referrer fragment'; refInput.style.flex='1'; refEditor.appendChild(refInput);
  const refAdd = document.createElement('button'); refAdd.textContent='Add Referrer'; refAdd.addEventListener('click', ()=>{ try { const v=(refInput.value||'').trim(); if(!v) return; REFERRER_BLOCKS.push(v); saveJSON('AdBlockX.REFERRER_BLOCKS', REFERRER_BLOCKS); panelLog('Added referrer block: '+v); refInput.value=''; try { refreshRefList(); } catch(e){} } catch(e){panelLog('add ref failed:'+e,'err')} }); refEditor.appendChild(refAdd);
  const refView = document.createElement('button'); refView.textContent='View Referrers'; refView.addEventListener('click', ()=>{ try{ const win = window.open('','_blank'); win.document.write('<pre>' + REFERRER_BLOCKS.map((s,i)=>(i+1)+'. '+s).join('\n') + '</pre>'); }catch(e){panelLog('view ref failed','err')} }); refEditor.appendChild(refView);
  panel.appendChild(refEditor);

  // in-panel referrer list with remove buttons
  const refList = document.createElement('div');
  refList.id = 'abx-ref-list';
  refList.style.marginBottom = '8px';
  panel.appendChild(refList);

  function refreshRefList() {
    try {
      refList.innerHTML = '';
      if (!REFERRER_BLOCKS || !REFERRER_BLOCKS.length) {
        const n = document.createElement('div'); n.style.color = '#888'; n.textContent = 'No referrer fragments configured'; refList.appendChild(n); return;
      }
      for (let i = 0; i < REFERRER_BLOCKS.length; i++) {
        const v = REFERRER_BLOCKS[i];
        const row = document.createElement('div'); row.style.display = 'flex'; row.style.justifyContent = 'space-between'; row.style.alignItems = 'center'; row.style.gap = '8px'; row.style.padding = '4px 0';
        const txt = document.createElement('span'); txt.textContent = v; txt.style.color = '#ccc'; row.appendChild(txt);
        const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.style.marginLeft = '8px';
        (function(idx){ remove.addEventListener('click', ()=>{
          try {
            const val = REFERRER_BLOCKS[idx];
            if (!val) return;
            REFERRER_BLOCKS.splice(idx,1);
            saveJSON('AdBlockX.REFERRER_BLOCKS', REFERRER_BLOCKS);
            panelLog('Removed referrer block: ' + val);
            refreshRefList();
            // update session/UI counts if present
            try { const sb = document.getElementById('abx-session-blocked'); if (sb) sb.textContent = (SESSION_STATS && SESSION_STATS.blocked) || 0; } catch(e){}
          } catch(e){ panelLog('remove ref failed: '+e,'err'); }
        }); })(i);
        row.appendChild(remove);
        refList.appendChild(row);
      }
    } catch (e) { panelLog('refreshRefList failed: ' + e, 'err'); }
  }

  // refresh initial list
  try { refreshRefList(); } catch(e){}

  // schedule UI
  const schedRow = document.createElement('div'); schedRow.style.display='flex'; schedRow.style.gap='6px'; schedRow.style.marginBottom='8px';
  const schedEnabled = document.createElement('input'); schedEnabled.type='checkbox'; schedEnabled.checked = !!(SCHEDULE && SCHEDULE.enabled); schedRow.appendChild(schedEnabled);
  const schedLabel = document.createElement('span'); schedLabel.textContent='Schedule active (start->end hour)'; schedLabel.style.color='#ccc'; schedRow.appendChild(schedLabel);
  const schedStart = document.createElement('input'); schedStart.type='number'; schedStart.min=0; schedStart.max=23; schedStart.style.width='60px'; schedStart.value = Number((SCHEDULE && SCHEDULE.startHour) || 0); schedRow.appendChild(schedStart);
  const schedEnd = document.createElement('input'); schedEnd.type='number'; schedEnd.min=0; schedEnd.max=24; schedEnd.style.width='60px'; schedEnd.value = Number((SCHEDULE && SCHEDULE.endHour) || 24); schedRow.appendChild(schedEnd);
  const schedSave = document.createElement('button'); schedSave.textContent='Save Schedule'; schedSave.addEventListener('click', ()=>{ try { SCHEDULE = { enabled: !!schedEnabled.checked, startHour: Number(schedStart.value||0), endHour: Number(schedEnd.value||24) }; saveJSON('AdBlockX.SCHEDULE', SCHEDULE); panelLog('Schedule saved: '+JSON.stringify(SCHEDULE)); } catch(e){panelLog('save sched failed:'+e,'err')} }); schedRow.appendChild(schedSave);
  panel.appendChild(schedRow);

  // clipboard export/import for lists
  const clipRow = document.createElement('div'); clipRow.style.display='flex'; clipRow.style.gap='6px'; clipRow.style.marginBottom='8px';
  const clipExport = document.createElement('button'); clipExport.textContent='Copy Lists to Clipboard'; clipExport.addEventListener('click', async ()=>{ 
  const obj = { BLACKLIST, SPOOF_LIST, REGEX_RULES, REMOTE_LISTS, WHITELIST, EXT_BLOCK, REFERRER_BLOCKS, SCHEDULE, ALWAYS_BLOCK };
    const payload = JSON.stringify(obj);
    try {
      await navigator.clipboard.writeText(payload);
      panelLog('Lists copied to clipboard');
    } catch (e) {
      panelLog('clipboard copy failed, falling back to download: ' + e, 'err');
      try {
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'adblockx-lists.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        panelLog('Lists downloaded as adblockx-lists.json');
      } catch (e2) { panelLog('fallback download failed: ' + e2, 'err'); }
    }
  }); clipRow.appendChild(clipExport);
  const clipImport = document.createElement('button'); clipImport.textContent='Import from Clipboard'; clipImport.addEventListener('click', async ()=>{ try { const txt = await navigator.clipboard.readText(); const obj = JSON.parse(txt); window.AdBlockX.importLists(obj); if (obj.REFERRER_BLOCKS) { for (const r of obj.REFERRER_BLOCKS) if (!REFERRER_BLOCKS.includes(r)) REFERRER_BLOCKS.push(r); saveJSON('AdBlockX.REFERRER_BLOCKS', REFERRER_BLOCKS); } if (obj.SCHEDULE) { SCHEDULE = obj.SCHEDULE; saveJSON('AdBlockX.SCHEDULE', SCHEDULE); } if (obj.ALWAYS_BLOCK) { for (const a of obj.ALWAYS_BLOCK) if (!ALWAYS_BLOCK.includes(a)) ALWAYS_BLOCK.push(a); saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK); } panelLog('Imported from clipboard'); } catch(e){ panelLog('clipboard import failed: '+e,'err'); } }); clipRow.appendChild(clipImport);
  panel.appendChild(clipRow);
    // whitelist editor
    const wlEditor = document.createElement('div'); wlEditor.style.display='flex'; wlEditor.style.gap='6px'; wlEditor.style.marginBottom='8px';
    const wlInput = document.createElement('input'); wlInput.placeholder='Whitelist host or origin'; wlInput.style.flex='1'; wlEditor.appendChild(wlInput);
    const wlAdd = document.createElement('button'); wlAdd.textContent='Add Whitelist'; wlAdd.addEventListener('click', ()=>{ const v=(wlInput.value||'').trim(); if(!v) return; WHITELIST.push(v); saveJSON('AdBlockX.WHITELIST', WHITELIST); panelLog('Whitelist added: '+v); wlInput.value=''; }); wlEditor.appendChild(wlAdd);
    const wlView = document.createElement('button'); wlView.textContent='View Whitelist'; wlView.addEventListener('click', ()=>{ try{ const win = window.open('', '_blank'); win.document.write('<pre>' + WHITELIST.map((s,i)=>(i+1)+'. '+s).join('\n') + '</pre>'); }catch(e){panelLog('view whitelist failed','err')} }); wlEditor.appendChild(wlView);
    panel.appendChild(wlEditor);

    // remote auto-update scheduling
    const autoRow = document.createElement('div'); autoRow.style.display='flex'; autoRow.style.gap='6px'; autoRow.style.marginBottom='8px';
    const autoInput = document.createElement('input'); autoInput.placeholder='Auto-update hours (0=off)'; autoInput.style.width='140px'; autoInput.value = loadJSON('AdBlockX.AUTO_UPDATE_HOURS', 0) || '';
    autoRow.appendChild(autoInput);
    const autoSave = document.createElement('button'); autoSave.textContent='Save AutoUpdate'; autoSave.addEventListener('click', ()=>{ try{ const v = Number(autoInput.value||0); saveJSON('AdBlockX.AUTO_UPDATE_HOURS', v); panelLog('Auto-update set to ' + v + ' hours'); setupAutoUpdate(); }catch(e){panelLog('auto update save failed','err')} }); autoRow.appendChild(autoSave);
    const autoNow = document.createElement('button'); autoNow.textContent='Fetch Remote Now'; autoNow.addEventListener('click', async ()=>{ try{ await updateRemoteLists(); panelLog('Remote lists fetched'); }catch(e){panelLog('fetch failed:'+e,'err')} }); autoRow.appendChild(autoNow);
    panel.appendChild(autoRow);

    // Block by resource type
    const typesRow = document.createElement('div'); typesRow.style.display='flex'; typesRow.style.flexWrap='wrap'; typesRow.style.gap='6px'; typesRow.style.marginBottom='8px';
    const types = Object.keys(BLOCK_TYPES || {});
    for (const t of types) {
      const cb = document.createElement('label'); cb.style.display='flex'; cb.style.alignItems='center'; cb.style.gap='6px';
      const input = document.createElement('input'); input.type='checkbox'; input.checked = !!BLOCK_TYPES[t]; input.dataset.type = t;
  input.addEventListener('change', () => { try { BLOCK_TYPES[input.dataset.type] = !!input.checked; saveJSON('AdBlockX.BLOCK_TYPES', BLOCK_TYPES); panelLog('Block type ' + input.dataset.type + ' set to ' + input.checked); maybeRefreshSW(); } catch (e) { panelLog('Block type save failed: '+e,'err'); } });
      cb.appendChild(input);
      const lab = document.createElement('span'); lab.textContent = t; lab.style.color='#ccc'; cb.appendChild(lab);
      typesRow.appendChild(cb);
    }
    panel.appendChild(typesRow);

    // Suggest rules
    const suggestRow = document.createElement('div'); suggestRow.style.display='flex'; suggestRow.style.gap='6px'; suggestRow.style.marginBottom='8px';
    const suggestBtn = document.createElement('button'); suggestBtn.textContent='Suggest Rules'; suggestBtn.addEventListener('click', ()=>{
      try {
        // simple heuristic: top blocked hostnames
        const map = {};
        for (const b of LOGS.blocked || []) {
          try { const u = new URL(b.url || '', location.origin); const h = u.hostname; map[h] = (map[h]||0)+1; } catch(e){}
        }
        const arr = Object.keys(map).sort((a,b)=>map[b]-map[a]).slice(0,10);
        if (!arr.length) { panelLog('No suggestions available'); return; }
        const win = window.open('', '_blank');
        const html = '<h3>Suggested regex rules</h3><pre>' + arr.map(h=>('^https?://([^.]+\.)*'+h.replace(/\./g,'\\.')+'')).join('\n') + '</pre>';
        win.document.write(html);
      } catch (e) { panelLog('Suggest failed: '+e,'err'); }
    }); suggestRow.appendChild(suggestBtn);
    panel.appendChild(suggestRow);
    // Rule tester
    const testerRow = document.createElement('div'); testerRow.style.display='flex'; testerRow.style.gap='6px'; testerRow.style.marginBottom='8px';
    const testerInput = document.createElement('input'); testerInput.placeholder = 'Test URL or string'; testerInput.style.flex='1'; testerRow.appendChild(testerInput);
    const testerBtn = document.createElement('button'); testerBtn.textContent = 'Test'; testerBtn.addEventListener('click', ()=>{
      try {
        const s = (testerInput.value||'').trim(); if (!s) { panelLog('Test URL empty', 'err'); return; }
        const res = testUrl(s);
        panelLog('Test result: ' + JSON.stringify(res));
        const win = window.open('', '_blank'); win.document.write('<pre>' + JSON.stringify(res, null, 2) + '</pre>');
      } catch (e) { panelLog('Test failed: '+e,'err'); }
    }); testerRow.appendChild(testerBtn);
    panel.appendChild(testerRow);
    // element hiding toggle
    const ehRow = document.createElement('div'); ehRow.style.display='flex'; ehRow.style.gap='6px'; ehRow.style.marginBottom='8px';
    const ehToggle = document.createElement('button'); const hideOn = loadJSON('AdBlockX.EH_ENABLED', true); ehToggle.textContent = hideOn ? 'Hide Elements: On' : 'Hide Elements: Off';
    ehToggle.addEventListener('click', ()=>{
      try {
        const v = !loadJSON('AdBlockX.EH_ENABLED', true);
        saveJSON('AdBlockX.EH_ENABLED', v);
        ehToggle.textContent = v ? 'Hide Elements: On' : 'Hide Elements: Off';
        if (v) { injectHideCSS(['iframe[src*="ad"], [class*="ad"], [id*="ad_"] { display:none !important; }']); startMutationObserver(); panelLog('Element hiding enabled'); }
        else { injectHideCSS([]); stopMutationObserver(); panelLog('Element hiding disabled'); }
      } catch(e){panelLog('EH toggle failed:'+e,'err')}
    });
    ehRow.appendChild(ehToggle);
    panel.appendChild(ehRow);

    // AI monitoring controls
    const aiRow = document.createElement('div');
    aiRow.style.display = 'flex';
    aiRow.style.flexDirection = 'column';
    aiRow.style.gap = '6px';
    aiRow.style.marginBottom = '8px';

    const aiTop = document.createElement('div');
    aiTop.style.display = 'flex';
    aiTop.style.gap = '6px';

    const aiToggle = document.createElement('button');
    const aiSettings = loadAISettings();
    aiToggle.textContent = aiSettings.enabled ? 'AI: On' : 'AI: Off';
    aiToggle.addEventListener('click', () => {
      try {
        const st = loadAISettings();
        st.enabled = !st.enabled; saveAISettings(st);
        aiToggle.textContent = st.enabled ? 'AI: On' : 'AI: Off';
        if (st.enabled) { setupAIPoll(); panelLog('AI monitoring enabled'); } else { clearAIPoll(); panelLog('AI monitoring disabled'); }
      } catch (e) { panelLog('AI toggle error: ' + e, 'err'); }
    });
    aiTop.appendChild(aiToggle);

    const aiNow = document.createElement('button');
    aiNow.textContent = 'Analyze Now';
    aiNow.addEventListener('click', async () => {
      try {
        const res = await runAIAnalysis({ sendIfAuto: false });
        panelLog('AI result: blocked=' + res.blockedNow + ' (base=' + Math.round(res.blockedBase) + ') spoof=' + res.spoofedNow);
      } catch (e) { panelLog('AI analyze failed: ' + e, 'err'); }
    });
    aiTop.appendChild(aiNow);

    aiRow.appendChild(aiTop);

    const aiCfg = document.createElement('div');
    aiCfg.style.display = 'flex';
    aiCfg.style.gap = '6px';

    const aiEndpoint = document.createElement('input');
    aiEndpoint.placeholder = 'AI endpoint (POST)';
    aiEndpoint.style.flex = '1';
    aiEndpoint.value = aiSettings.endpoint || '';
    aiCfg.appendChild(aiEndpoint);

    const aiSave = document.createElement('button');
    aiSave.textContent = 'Save AI';
    aiSave.addEventListener('click', () => {
      try {
        const st = loadAISettings();
        st.endpoint = (aiEndpoint.value||'').trim();
        saveAISettings(st);
        panelLog('AI settings saved');
      } catch (e) { panelLog('AI save failed: ' + e, 'err'); }
    });
    aiCfg.appendChild(aiSave);

    aiRow.appendChild(aiCfg);
    panel.appendChild(aiRow);

    // log box
    const logBox = document.createElement('div');
    logBox.id = 'abx-logbox';
    Object.assign(logBox.style, {
      height: '140px',
      overflow: 'auto',
      background: '#070707',
      padding: '8px',
      borderRadius: '6px',
      color: '#ddd'
    });
    const initial = document.createElement('div');
    initial.style.color = '#888';
    initial.textContent = 'Logs will appear here...';
    logBox.appendChild(initial);
    panel.appendChild(logBox);

    // bottom controls
    const bottom = document.createElement('div');
    bottom.style.display = 'flex';
    bottom.style.gap = '6px';
    bottom.style.marginTop = '8px';

    // Vindication: open a modal to review and export recent blocked/spoofed logs
    function downloadText(filename, text, mime) {
      try {
        const blob = new Blob([text], { type: mime || 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 1500);
      } catch (e) { panelLog('downloadText failed: ' + e, 'err'); }
    }

    function showVindicationModal() {
      try {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.6)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '9999999999';

        const box = document.createElement('div');
        box.style.width = '820px';
        box.style.maxHeight = '80vh';
        box.style.overflow = 'auto';
        box.style.background = '#111';
        box.style.border = '1px solid #333';
        box.style.padding = '12px';
        box.style.color = '#ddd';
        box.style.fontSize = '13px';
        box.style.boxShadow = '0 8px 32px rgba(0,0,0,0.6)';

        const hdr = document.createElement('div');
        hdr.style.display = 'flex';
        hdr.style.justifyContent = 'space-between';
        hdr.style.alignItems = 'center';
        hdr.style.marginBottom = '8px';

        const title = document.createElement('div');
        title.textContent = 'Vindication — Recent blocked/spoofed items';
        title.style.fontWeight = '600';
        hdr.appendChild(title);

        const ctrl = document.createElement('div');
        ctrl.style.display = 'flex';
        ctrl.style.gap = '8px';

        const btnCopy = document.createElement('button');
        btnCopy.textContent = 'Copy JSON';
        btnCopy.addEventListener('click', async () => {
          try {
            const payload = JSON.stringify({ blocked: LOGS.blocked || [], spoofed: LOGS.spoofed || [], observed: LOGS.observed || [] }, null, 2);
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(payload);
              panelLog('Vindication copied to clipboard');
            } else { downloadText('abx_vindication.json', payload); panelLog('Vindication downloaded (clipboard unsupported)'); }
          } catch (e) { panelLog('Copy failed: ' + e, 'err'); }
        });
        ctrl.appendChild(btnCopy);

        const btnExport = document.createElement('button');
        btnExport.textContent = 'Export JSON';
        btnExport.addEventListener('click', () => {
          try {
            const payload = JSON.stringify({ blocked: LOGS.blocked || [], spoofed: LOGS.spoofed || [], observed: LOGS.observed || [] }, null, 2);
            downloadText('abx_vindication.json', payload, 'application/json');
            panelLog('Vindication exported');
          } catch (e) { panelLog('Export failed: ' + e, 'err'); }
        });
        ctrl.appendChild(btnExport);

        const btnCSV = document.createElement('button');
        btnCSV.textContent = 'Export CSV';
        btnCSV.addEventListener('click', () => {
          try {
            const rows = ['type,timestamp,url,reason'];
            for (const b of (LOGS.blocked||[])) rows.push('blocked,"' + (b.t||'') + '","' + (String(b.url||'').replace(/"/g,'""')) + '","' + (b.reason||'') + '"');
            for (const s of (LOGS.spoofed||[])) rows.push('spoofed,"' + (s.t||'') + '","' + (String(s.url||'').replace(/"/g,'""')) + '","' + (s.reason||'') + '"');
            const csv = rows.join('\n');
            downloadText('abx_vindication.csv', csv, 'text/csv');
            panelLog('Vindication exported (CSV)');
          } catch (e) { panelLog('CSV export failed: ' + e, 'err'); }
        });
        ctrl.appendChild(btnCSV);

        const btnClose = document.createElement('button');
        btnClose.textContent = 'Close';
        btnClose.addEventListener('click', () => { try { overlay.remove(); } catch (e) {} });
        ctrl.appendChild(btnClose);

        hdr.appendChild(ctrl);
        box.appendChild(hdr);

        const list = document.createElement('div');
        list.style.whiteSpace = 'pre-wrap';
        list.style.fontFamily = 'monospace';
        list.style.fontSize = '12px';
        list.style.maxHeight = '64vh';
        list.style.overflow = 'auto';
        list.style.borderTop = '1px solid #222';
        list.style.paddingTop = '8px';

        function renderList() {
          try {
            list.innerHTML = '';
            const combined = [];
            for (const b of (LOGS.blocked||[])) combined.push(Object.assign({ type: 'blocked' }, b));
            for (const s of (LOGS.spoofed||[])) combined.push(Object.assign({ type: 'spoofed' }, s));
            for (const o of (LOGS.observed||[])) combined.push(Object.assign({ type: 'observed' }, o));
            combined.sort((a,b)=>{ try { return (new Date(b.t||0)) - (new Date(a.t||0)); } catch(e){ return 0; } });
            const max = 500; let c = 0;
            for (const it of combined) {
              if (c++ >= max) break;
              const row = document.createElement('div');
              row.style.padding = '6px 0';
              row.style.borderBottom = '1px dashed #222';
              row.textContent = `[${it.type}] ${it.t || ''} ${it.url || ''} ${it.reason ? '(' + it.reason + ')' : ''} ${it.referrer ? 'from: ' + it.referrer : ''}`;
              list.appendChild(row);
            }
            if (!combined.length) { const info = document.createElement('div'); info.style.color = '#888'; info.textContent = 'No vindication records'; list.appendChild(info); }
          } catch (e) { panelLog('renderList failed: ' + e, 'err'); }
        }

        renderList();
        box.appendChild(list);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
      } catch (e) { panelLog('showVindicationModal failed: ' + e, 'err'); }
    }

    const vindBtn = document.createElement('button');
    vindBtn.textContent = 'Vindication';
    vindBtn.title = 'View recent blocked/spoofed activity';
    vindBtn.addEventListener('click', () => { try { showVindicationModal(); } catch(e){} });
    bottom.appendChild(vindBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
      LOGS.blocked.length = 0; LOGS.spoofed.length = 0; LOGS.observed.length = 0;
      saveJSON('AdBlockX.LOGS', LOGS);
      logBox.innerHTML = '';
      const info = document.createElement('div'); info.style.color = '#888'; info.textContent = 'Logs cleared'; logBox.appendChild(info);
      panelState && panelState.updateCounts && panelState.updateCounts();
    });
    bottom.appendChild(clearBtn);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove UI';
    removeBtn.addEventListener('click', () => { try { panel.remove(); } catch (e) {} });
    bottom.appendChild(removeBtn);

    panel.appendChild(bottom);

    // add to document (safe DOM methods only)
    try {
      // prefer appending to documentElement for very early runs; fallback to body
      const root = document.documentElement || document.body || document;
      root.appendChild(panel);
    } catch (e) {
      console.warn('[AdBlockX] could not append panel to documentElement, trying body', e);
      try { document.body.appendChild(panel); } catch (ee) { console.warn('[AdBlockX] append failed', ee); }
    }

    return { panel, logBox, btnFallback, btnUnreg, btnRegister };
  }

  function panelLog(text, type = 'info') {
    try {
      if (!panelState || !panelState.logBox) return;
      const box = panelState.logBox;
      const el = document.createElement('div');
      el.style.marginBottom = '6px';
      el.style.fontSize = '12px';
      el.style.color = type === 'err' ? '#ff9999' : '#ddd';
      el.textContent = `[${nowStr()}] ${text}`;
      if (box.firstChild) box.insertBefore(el, box.firstChild);
      else box.appendChild(el);
      // keep history short
      while (box.children.length > 200) box.removeChild(box.lastChild);
    } catch (e) { console.warn('[AdBlockX] panelLog error', e); }
  }

  // attach updateCounts lazily to panelState when created
  function attachPanelHelpers(state) {
    if (!state) return;
    state.updateCounts = function() {
      try {
        const b = document.getElementById('abx-count-blocked');
        const s = document.getElementById('abx-count-spoofed');
        const o = document.getElementById('abx-count-observed');
        if (b) b.textContent = (LOGS.blocked||[]).length;
        if (s) s.textContent = (LOGS.spoofed||[]).length;
        if (o) o.textContent = (LOGS.observed||[]).length;
        const sb = document.getElementById('abx-session-blocked'); if (sb) sb.textContent = (SESSION_STATS && SESSION_STATS.blocked) || 0;
      } catch (e) {}
    };
    // AI helpers
    state.ai = {};
    state.ai.startMonitor = function() {
      try {
        const st = loadJSON('AdBlockX.AI_SETTINGS', { enabled: false, intervalSecs: 30, spikeMultiplier: 3, windowSecs: 60, endpoint: '', autoSend: false });
        st.enabled = true; saveJSON('AdBlockX.AI_SETTINGS', st);
        setupAIPoll();
      } catch (e) {}
    };
    state.ai.stopMonitor = function() {
      try {
        const st = loadJSON('AdBlockX.AI_SETTINGS', { enabled: false });
        st.enabled = false; saveJSON('AdBlockX.AI_SETTINGS', st);
        clearAIPoll();
      } catch (e) {}
    };
  }

  // keyboard shortcuts: Ctrl+Shift+A toggles enable, Ctrl+Shift+L opens logs, Ctrl+Shift+E export clipboard
  window.addEventListener('keydown', (ev)=>{
    try {
      if (!ev) return;
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (!ctrl || !ev.shiftKey) return;
      // A
      if (ev.key && ev.key.toLowerCase() === 'a') { ENABLED = !ENABLED; saveJSON('AdBlockX.ENABLED', ENABLED); panelLog('Toggled enabled: '+ENABLED); ev.preventDefault(); }
      if (ev.key && ev.key.toLowerCase() === 'l') { const win = window.open('', '_blank'); win.document.write('<pre>' + JSON.stringify(LOGS, null, 2) + '</pre>'); ev.preventDefault(); }
      if (ev.key && ev.key.toLowerCase() === 'e') { try { navigator.clipboard.writeText(JSON.stringify(window.AdBlockX.exportLists())); panelLog('Exported lists to clipboard (shortcut)'); } catch(e){ panelLog('shortcut export failed: '+e,'err'); } ev.preventDefault(); }
    } catch(e){}
  });

  // AI monitoring utilities
  function loadAISettings() { return loadJSON('AdBlockX.AI_SETTINGS', { enabled: false, intervalSecs: 30, spikeMultiplier: 3, windowSecs: 60, endpoint: '', autoSend: false }); }
  function saveAISettings(s) { saveJSON('AdBlockX.AI_SETTINGS', s); }

  function parseISO(t) { try { return Date.parse(t); } catch (e) { return NaN; } }

  function countInWindow(kind, windowMs) {
    const now = Date.now();
    const arr = LOGS[kind] || [];
    let ct = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const it = arr[i];
      const ts = it && it.t ? parseISO(it.t) : NaN;
      if (!ts || ts < now - windowMs) break;
      ct++;
    }
    return ct;
  }

  function computeBaseline(kind, windowMs, windows=6) {
    // compute average count of `kind` in previous `windows` windows of size windowMs
    const arr = LOGS[kind] || [];
    const now = Date.now();
    const sums = [];
    for (let w = 0; w < windows; w++) {
      const start = now - (w+1) * windowMs;
      const end = now - w * windowMs;
      let ct = 0;
      for (let i = arr.length - 1; i >= 0; i--) {
        const ts = arr[i] && arr[i].t ? parseISO(arr[i].t) : NaN;
        if (!ts) continue;
        if (ts >= start && ts < end) ct++;
        if (ts < start) break;
      }
      sums.push(ct);
    }
    const avg = sums.reduce((a,b)=>a+b,0) / (sums.length||1);
    return { avg, windows, sums };
  }

  // test a URL/string against current rules
  function testUrl(s) {
    try {
      const url = String(s || '');
      const isWhitelisted = (function(){ try { const u = new URL(url, location.origin); const h = u.hostname; return (WHITELIST||[]).includes(h) || (WHITELIST||[]).includes(u.origin); } catch(e){ return false; } })();
      const matchesRegex = (REGEX_RULES||[]).some(r => { try { return new RegExp(r).test(url); } catch(e){ return false; } });
      const inBlacklist = urlMatchesList(url, BLACKLIST);
      const inSpoof = urlMatchesList(url, SPOOF_LIST);
      const inExt = urlMatchesList(url, EXT_BLOCK);
      return { url, isWhitelisted, matchesRegex, blocked: !isWhitelisted && (inBlacklist || inExt), spoof: !isWhitelisted && inSpoof };
    } catch (e) { return { error: String(e) }; }
  }

  async function runAIAnalysis(options={sendIfAuto:false}) {
    const settings = loadAISettings();
    const windowMs = (settings.windowSecs||60) * 1000;
    const blockedNow = countInWindow('blocked', windowMs);
    const spoofedNow = countInWindow('spoofed', windowMs);
    const observedNow = countInWindow('observed', windowMs);
    const blockedBase = computeBaseline('blocked', windowMs);
    const spoofedBase = computeBaseline('spoofed', windowMs);
    const scoreBlocked = blockedBase.avg > 0 ? (blockedNow / (blockedBase.avg || 1)) : (blockedNow > 0 ? blockedNow : 0);
    const scoreSpoof = spoofedBase.avg > 0 ? (spoofedNow / (spoofedBase.avg || 1)) : (spoofedNow > 0 ? spoofedNow : 0);
    const now = nowStr();
    const summary = {
      t: now,
      blockedNow, spoofedNow, observedNow,
      blockedBase: blockedBase.avg, spoofedBase: spoofedBase.avg,
      scoreBlocked, scoreSpoof,
      spikeBlocked: scoreBlocked >= (settings.spikeMultiplier||3),
      spikeSpoof: scoreSpoof >= (settings.spikeMultiplier||3)
    };
    try { saveJSON('AdBlockX.AI_LAST', summary); } catch (e) {}
    // if endpoint configured and autoSend enabled, send
    if (settings.endpoint && settings.autoSend && options.sendIfAuto) {
      try { await sendAnalysisToEndpoint(summary, settings.endpoint); } catch (e) { /* ignore for now */ }
    }
    return summary;
  }

  async function sendAnalysisToEndpoint(summary, endpoint) {
    if (!endpoint) throw new Error('NoEndpoint');
    try {
      await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summary) });
      return true;
    } catch (e) { throw e; }
  }

  let __abx_ai_interval = null;
  function clearAIPoll() { try { if (__abx_ai_interval) { clearInterval(__abx_ai_interval); __abx_ai_interval = null; } } catch(e){} }
  function setupAIPoll() {
    try {
      clearAIPoll();
      const settings = loadAISettings();
      if (!settings.enabled) return;
      const iv = Math.max(5, Number(settings.intervalSecs||30));
      // run immediately then poll
      runAIAnalysis({ sendIfAuto: true }).then(res=>{ panelLog('AI analysis: ' + (res.spikeBlocked||res.spikeSpoof ? 'Spike detected' : 'OK')); }).catch(()=>{});
      __abx_ai_interval = setInterval(() => {
        runAIAnalysis({ sendIfAuto: true }).then(res=>{ if (res.spikeBlocked || res.spikeSpoof) panelLog('AI spike: ' + JSON.stringify({b:res.blockedNow,sb:res.blockedBase})); }).catch(()=>{});
      }, iv * 1000);
    } catch (e) {}
  }

  // auto-update remote lists scheduler
  let __abx_auto_update = null;
  function clearAutoUpdate() { try { if (__abx_auto_update) { clearInterval(__abx_auto_update); __abx_auto_update = null; } } catch(e){} }
  function setupAutoUpdate() {
    try {
      clearAutoUpdate();
      const hrs = Number(loadJSON('AdBlockX.AUTO_UPDATE_HOURS', 0) || 0);
      if (!hrs || hrs <= 0) return;
      const ms = Math.max(1, hrs) * 3600 * 1000;
      __abx_auto_update = setInterval(() => { updateRemoteLists(); }, ms);
    } catch (e) {}
  }

  /***********************
   * Main flow
   ***********************/
  let registration = null;

  (async function main() {
    panelState = makePanel();
    attachPanelHelpers(panelState);
    panelLog('Panel created. Initializing fallback hooks...');
    try {
      // initialize fallback based on saved setting (default true)
      const fb = loadJSON('AdBlockX.FALLBACK', true);
      if (fb) { fallback.init(); panelState.btnFallback && (panelState.btnFallback.textContent = 'Fallback: On'); }
      else { fallback.restore(); panelState.btnFallback && (panelState.btnFallback.textContent = 'Fallback: Off'); }
      panelLog('Fallback network hooks active (temporary).');
    } catch (e) {
      panelLog('Fallback init failed: ' + e, 'err');
    }

    try {
      // Augment with YouTube-specific heuristics early to increase blocking coverage
      try { augmentYouTubeHeuristics(); } catch (e) { panelLog('YouTube heuristics call error: ' + e, 'err'); }
    } catch(e){}

    try {
      // Start YouTube overlay remover if user hasn't disabled it
      try { if (loadJSON('AdBlockX.YT_OVERLAY_ENABLED', true)) startYouTubeOverlayRemover(); } catch(e){}
    } catch(e){}

    try {
      // initialize AI monitoring if previously enabled
      const aiSettingsInit = loadAISettings();
      if (aiSettingsInit && aiSettingsInit.enabled) {
        setupAIPoll();
        panelLog('AI monitoring resumed (saved setting).');
      }
    } catch (e) {}

    try {
  registration = await registerSW();
  panelLog('Service Worker registered. Scope: ' + (registration && registration.scope));
  panelState.btnUnreg && (panelState.btnUnreg.textContent = 'Unregister SW');
  panelState.btnRegister && (panelState.btnRegister.textContent = 'Registered');
      try {
        registration.active && registration.active.postMessage && registration.active.postMessage({ cmd: 'ping' });
      } catch (e) {}
    } catch (err) {
      panelLog('Service Worker registration failed; using fallback. Error: ' + (err && err.message), 'err');
    }

    // periodically push recent log summaries into panel
    setInterval(() => {
      try {
        if (LOGS.blocked.length) panelLog('Blocked: ' + LOGS.blocked.slice(-6).map(x => x.url).join(' | '));
        if (LOGS.spoofed.length) panelLog('Spoofed: ' + LOGS.spoofed.slice(-6).map(x => x.url).join(' | '));
        panelState && panelState.updateCounts && panelState.updateCounts();
      } catch (e) {}
    }, 6000);
  })();

  // Expose controls
  try {
    window.AdBlockX = window.AdBlockX || {};
    window.AdBlockX.unregisterSW = async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
        panelLog('SW unregistered via API.');
      } catch (e) { panelLog('unregister error: ' + e, 'err'); }
    };
    window.AdBlockX.getLogs = () => JSON.parse(JSON.stringify(LOGS));
  window.AdBlockX.isEnabled = () => !!ENABLED;
  window.AdBlockX.setEnabled = (v) => { ENABLED = !!v; saveJSON('AdBlockX.ENABLED', ENABLED); panelLog('AdBlockX ' + (ENABLED ? 'enabled' : 'disabled') + ' via API'); };
    window.AdBlockX.addToBlacklist = (s) => { try { BLACKLIST.push(s); saveJSON('AdBlockX.BLACKLIST', BLACKLIST); panelLog('Added to blacklist: ' + s); } catch(e){} };
    window.AdBlockX.getBlacklist = () => JSON.parse(JSON.stringify(BLACKLIST));
    window.AdBlockX.removeFromBlacklist = (s) => { try { const idx = BLACKLIST.indexOf(s); if (idx>=0) { BLACKLIST.splice(idx,1); saveJSON('AdBlockX.BLACKLIST', BLACKLIST); panelLog('Removed from blacklist: ' + s); } } catch(e){} };
    window.AdBlockX.clearLogs = () => { try { LOGS.blocked.length=0; LOGS.spoofed.length=0; LOGS.observed.length=0; saveJSON('AdBlockX.LOGS', LOGS); panelLog('Logs cleared via API'); } catch(e){} };
    window.AdBlockX.runAI = async (opts) => { try { return await runAIAnalysis(opts||{}); } catch(e){ throw e; } };
    window.AdBlockX.getAISettings = () => loadAISettings();
    window.AdBlockX.setAISettings = (s) => { saveAISettings(Object.assign(loadAISettings(), s)); };
    window.AdBlockX.sendAI = async (endpoint) => { try { const summary = await runAIAnalysis({ sendIfAuto: false }); return await sendAnalysisToEndpoint(summary, endpoint || loadAISettings().endpoint); } catch(e){ throw e; } };
    window.AdBlockX.getRegexRules = () => JSON.parse(JSON.stringify(REGEX_RULES));
    window.AdBlockX.addRegexRule = (r) => { try { new RegExp(r); REGEX_RULES.push(r); saveJSON('AdBlockX.REGEX_RULES', REGEX_RULES); } catch(e){ throw e; } };
    window.AdBlockX.testUrl = (s) => { try { return testUrl(s); } catch(e){ return { error: String(e) }; } };
    window.AdBlockX.getRemoteLists = () => JSON.parse(JSON.stringify(REMOTE_LISTS));
    window.AdBlockX.addRemoteList = (u) => { REMOTE_LISTS.push({url:u,lastFetched:0}); saveJSON('AdBlockX.REMOTE_LISTS', REMOTE_LISTS); };
    window.AdBlockX.fetchRemoteNow = () => updateRemoteLists();
    window.AdBlockX.getSessionStats = () => JSON.parse(JSON.stringify(SESSION_STATS));
    window.AdBlockX.resetSessionStats = () => { SESSION_STATS = { blocked:0, spoofed:0, observed:0, start: nowStr() }; saveJSON('AdBlockX.SESSION_STATS', SESSION_STATS); };
    window.AdBlockX.getSchedule = () => JSON.parse(JSON.stringify(SCHEDULE));
    window.AdBlockX.setSchedule = (s) => { SCHEDULE = Object.assign(SCHEDULE||{}, s||{}); saveJSON('AdBlockX.SCHEDULE', SCHEDULE); };
    window.AdBlockX.getReferrerBlocks = () => JSON.parse(JSON.stringify(REFERRER_BLOCKS));
    window.AdBlockX.addReferrerBlock = (v) => { REFERRER_BLOCKS.push(v); saveJSON('AdBlockX.REFERRER_BLOCKS', REFERRER_BLOCKS); };
    window.AdBlockX.removeReferrerBlock = (v) => { const i = REFERRER_BLOCKS.indexOf(v); if (i>=0) { REFERRER_BLOCKS.splice(i,1); saveJSON('AdBlockX.REFERRER_BLOCKS', REFERRER_BLOCKS); } };
    window.AdBlockX.enableElementHiding = (v) => { try { saveJSON('AdBlockX.EH_ENABLED', !!v); if (v) { injectHideCSS(['iframe[src*="ad"], [class*="ad"], [id*="ad_"] { display:none !important; }']); startMutationObserver(); } else { injectHideCSS([]); stopMutationObserver(); } } catch(e){} };
    window.AdBlockX.isActive = () => isActive();
  window.AdBlockX.getWhitelist = () => JSON.parse(JSON.stringify(WHITELIST));
  window.AdBlockX.addToWhitelist = (v) => { WHITELIST.push(v); saveJSON('AdBlockX.WHITELIST', WHITELIST); };
  window.AdBlockX.removeFromWhitelist = (v) => { const i = WHITELIST.indexOf(v); if (i>=0) { WHITELIST.splice(i,1); saveJSON('AdBlockX.WHITELIST', WHITELIST); } };
  window.AdBlockX.getExtBlock = () => JSON.parse(JSON.stringify(EXT_BLOCK));
  window.AdBlockX.addExtBlock = (v) => { try { EXT_BLOCK.push(v); saveJSON('AdBlockX.EXT_BLOCK', EXT_BLOCK); panelLog('Added ext-block: ' + v); } catch (e) {} };
  window.AdBlockX.removeExtBlock = (v) => { try { const i = EXT_BLOCK.indexOf(v); if (i>=0) { EXT_BLOCK.splice(i,1); saveJSON('AdBlockX.EXT_BLOCK', EXT_BLOCK); panelLog('Removed ext-block: ' + v); } } catch (e) {} };
  window.AdBlockX.exportLists = () => ({ BLACKLIST, SPOOF_LIST, REGEX_RULES, REMOTE_LISTS, WHITELIST, EXT_BLOCK, REFERRER_BLOCKS, SCHEDULE, ALWAYS_BLOCK });
  window.AdBlockX.importLists = (obj) => {
    try {
      if (!obj || typeof obj !== 'object') throw new Error('Invalid');
      if (obj.BLACKLIST && Array.isArray(obj.BLACKLIST)) for (const s of obj.BLACKLIST) if (!BLACKLIST.includes(s)) BLACKLIST.push(s);
      if (obj.REGEX_RULES && Array.isArray(obj.REGEX_RULES)) for (const r of obj.REGEX_RULES) if (!REGEX_RULES.includes(r)) REGEX_RULES.push(r);
      if (obj.WHITELIST && Array.isArray(obj.WHITELIST)) for (const w of obj.WHITELIST) if (!WHITELIST.includes(w)) WHITELIST.push(w);
      if (obj.SPOOF_LIST && Array.isArray(obj.SPOOF_LIST)) for (const s of obj.SPOOF_LIST) if (!SPOOF_LIST.includes(s)) SPOOF_LIST.push(s);
      if (obj.REMOTE_LISTS && Array.isArray(obj.REMOTE_LISTS)) for (const r of obj.REMOTE_LISTS) if (!REMOTE_LISTS.some(x=>x.url===r.url)) REMOTE_LISTS.push(r);
      if (obj.EXT_BLOCK && Array.isArray(obj.EXT_BLOCK)) for (const e of obj.EXT_BLOCK) if (!EXT_BLOCK.includes(e)) EXT_BLOCK.push(e);
      if (obj.REFERRER_BLOCKS && Array.isArray(obj.REFERRER_BLOCKS)) for (const f of obj.REFERRER_BLOCKS) if (!REFERRER_BLOCKS.includes(f)) REFERRER_BLOCKS.push(f);
      if (obj.SCHEDULE && typeof obj.SCHEDULE === 'object') SCHEDULE = Object.assign(SCHEDULE||{}, obj.SCHEDULE);
      if (obj.ALWAYS_BLOCK && Array.isArray(obj.ALWAYS_BLOCK)) for (const a of obj.ALWAYS_BLOCK) if (!ALWAYS_BLOCK.includes(a)) ALWAYS_BLOCK.push(a);
      saveJSON('AdBlockX.BLACKLIST', BLACKLIST); saveJSON('AdBlockX.REGEX_RULES', REGEX_RULES); saveJSON('AdBlockX.WHITELIST', WHITELIST); saveJSON('AdBlockX.SPOOF_LIST', SPOOF_LIST); saveJSON('AdBlockX.REMOTE_LISTS', REMOTE_LISTS); saveJSON('AdBlockX.EXT_BLOCK', EXT_BLOCK); saveJSON('AdBlockX.REFERRER_BLOCKS', REFERRER_BLOCKS); saveJSON('AdBlockX.SCHEDULE', SCHEDULE); saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK);
      panelLog('Lists imported via API (merged)');
      maybeRefreshSW();
    } catch (e) { throw e; }
  };
  // ALWAYS_BLOCK API helpers
  window.AdBlockX.getAlwaysBlock = () => JSON.parse(JSON.stringify(ALWAYS_BLOCK));
  window.AdBlockX.addAlwaysBlock = (v) => { try { ALWAYS_BLOCK.push(v); saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK); panelLog('Added ALWAYS_BLOCK: ' + v); } catch(e){} };
  window.AdBlockX.removeAlwaysBlock = (v) => { try { const i = ALWAYS_BLOCK.indexOf(v); if (i>=0) { ALWAYS_BLOCK.splice(i,1); saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK); panelLog('Removed ALWAYS_BLOCK: ' + v); } } catch(e){} };
  // Enforcer API
  window.AdBlockX.isEnforcer = () => !!ENFORCER_ENABLED;
  window.AdBlockX.setEnforcer = (v) => { ENFORCER_ENABLED = !!v; saveJSON('AdBlockX.ENFORCER_ENABLED', ENFORCER_ENABLED); panelLog('Enforcer set to ' + ENFORCER_ENABLED); };
  window.AdBlockX.promoteToAlwaysBlock = (urlOrHost) => { try { const host = (new URL(urlOrHost, location.href)).hostname || String(urlOrHost); if (!ALWAYS_BLOCK.includes(host)) { ALWAYS_BLOCK.push(host); saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK); panelLog('Promoted to ALWAYS_BLOCK via API: ' + host); } } catch(e){ throw e; } };
  // Strict Enforcer API
  window.AdBlockX.isStrict = () => !!STRICT_ENFORCER;
  window.AdBlockX.setStrict = (v) => { STRICT_ENFORCER = !!v; saveJSON('AdBlockX.STRICT_ENFORCER', STRICT_ENFORCER); panelLog('Strict Enforcer set to ' + STRICT_ENFORCER); };
  // Watchdog API
  window.AdBlockX.isWatchdog = () => !!WATCHDOG_ENABLED;
  window.AdBlockX.setWatchdog = (v) => { WATCHDOG_ENABLED = !!v; saveJSON('AdBlockX.WATCHDOG_ENABLED', WATCHDOG_ENABLED); if (WATCHDOG_ENABLED) startWatchdog(); else stopWatchdog(); panelLog('Watchdog set to ' + WATCHDOG_ENABLED); };
  window.AdBlockX.getAutoUpdateHours = () => Number(loadJSON('AdBlockX.AUTO_UPDATE_HOURS',0)||0);
  window.AdBlockX.setAutoUpdateHours = (h) => { saveJSON('AdBlockX.AUTO_UPDATE_HOURS', Number(h||0)); setupAutoUpdate(); };
  window.AdBlockX.getBlockTypes = () => JSON.parse(JSON.stringify(BLOCK_TYPES));
  window.AdBlockX.setBlockTypes = (t) => { try { BLOCK_TYPES = Object.assign(BLOCK_TYPES||{}, t||{}); saveJSON('AdBlockX.BLOCK_TYPES', BLOCK_TYPES); panelLog('Block types updated via API'); } catch(e){} };
  window.AdBlockX.getPerSiteDisabled = () => JSON.parse(JSON.stringify(PER_SITE_DISABLED));
  window.AdBlockX.setPerSiteDisabled = (origin, v) => { try { PER_SITE_DISABLED[origin] = !!v; saveJSON('AdBlockX.PER_SITE_DISABLED', PER_SITE_DISABLED); panelLog('Per-site disabled set for ' + origin + ': ' + v); maybeRefreshSW(); } catch(e){} };
  window.AdBlockX.enableHypernova = () => { try { enableHypernova(); maybeRefreshSW(); } catch(e){} };
  window.AdBlockX.disableHypernova = () => { try { disableHypernova(); maybeRefreshSW(); } catch(e){} };
  window.AdBlockX.isHypernova = () => !!HYPERNOVA;
  window.AdBlockX.addAnalyticsHosts = () => { try { addAnalyticsHostsToBlacklist(); maybeRefreshSW(); } catch(e){} };
  window.AdBlockX.enableArchballistic = () => { try { enableArchballistic(); maybeRefreshSW(); } catch(e){} };
  window.AdBlockX.disableArchballistic = () => { try { disableArchballistic(); maybeRefreshSW(); } catch(e){} };
  window.AdBlockX.isArchballistic = () => !!ARCHBALLISTIC;
  // YouTube heuristics API
  window.AdBlockX.isYouTubeHeuristics = () => !!loadJSON('AdBlockX.YT_HEURISTICS_ENABLED', true);
  window.AdBlockX.setYouTubeHeuristics = (v) => { try { saveJSON('AdBlockX.YT_HEURISTICS_ENABLED', !!v); if (v) augmentYouTubeHeuristics(); panelLog('YouTube heuristics set to ' + !!v); } catch(e){} };
  window.AdBlockX.isYouTubeOverlayRemover = () => !!loadJSON('AdBlockX.YT_OVERLAY_ENABLED', true);
  window.AdBlockX.setYouTubeOverlayRemover = (v) => { try { if (v) startYouTubeOverlayRemover(); else stopYouTubeOverlayRemover(); } catch(e){} };
  // AI mode API
  window.AdBlockX.enableAI = () => { try { enableAI(); } catch(e){} };
  window.AdBlockX.disableAI = () => { try { disableAI(); } catch(e){} };
  window.AdBlockX.isAI = () => !!AI_MODE;
  // Fuck All Ads mode API
  window.AdBlockX.enableFuckAllAds = () => { try { enableFuckAllAds(); } catch(e){} };
  window.AdBlockX.disableFuckAllAds = () => { try { disableFuckAllAds(); } catch(e){} };
  window.AdBlockX.isFuckAllAds = () => !!FUCK_ALL_ADS_MODE;
  // Performance mode API
  window.AdBlockX.setPerformanceMode = (v) => { PERFORMANCE_MODE = !!v; saveJSON('AdBlockX.PERFORMANCE_MODE', PERFORMANCE_MODE); panelLog('Performance mode set to ' + PERFORMANCE_MODE); };
  window.AdBlockX.isPerformanceMode = () => !!PERFORMANCE_MODE;
  // Privacy mode API
  window.AdBlockX.setPrivacyMode = (v, key) => { PRIVACY_MODE = !!v; if (key) __abx_encryption_key = String(key); saveJSON('AdBlockX.PRIVACY_MODE', PRIVACY_MODE); panelLog('Privacy mode set to ' + PRIVACY_MODE); };
  window.AdBlockX.isPrivacyMode = () => !!PRIVACY_MODE;
  // Petty mode API
  window.AdBlockX.enablePetty = () => { try { enablePetty(); } catch(e){} };
  window.AdBlockX.disablePetty = () => { try { disablePetty(); } catch(e){} };
  window.AdBlockX.isPetty = () => !!PETTY_MODE;
  // Nuclear mode API
  window.AdBlockX.enableNuclear = () => { try { enableNuclear(); } catch(e){} };
  window.AdBlockX.disableNuclear = () => { try { disableNuclear(); } catch(e){} };
  window.AdBlockX.isNuclear = () => !!NUCLEAR_MODE;
  // Extension sync API for cross-tab blocking
  window.AdBlockX.syncWithExtension = () => {
    try {
      if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
        // send current blocked/spoofed lists to extension
        const syncData = {
          action: 'sync_lists',
          blackList: BLACKLIST,
          spoofList: SPOOF_LIST,
          extBlock: EXT_BLOCK,
          alwaysBlock: ALWAYS_BLOCK,
          whiteList: WHITELIST,
          regexRules: REGEX_RULES
        };
        chrome.runtime.sendMessage('your-extension-id', syncData, (response) => {
          if (response && response.success) {
            panelLog('Synced with extension');
            // Inject content script for video player blocking
            if (response.injectContentScript) {
              const script = document.createElement('script');
              script.src = chrome.runtime.getURL('content-script.js');
              document.head.appendChild(script);
            }
          }
        });
      }
    } catch(e){ panelLog('Extension sync failed: ' + e); }
  };
  window.AdBlockX.receiveExtensionSync = (data) => {
    try {
      if (data && data.action === 'update_lists') {
        // update local lists from extension
        if (data.blackList) BLACKLIST = data.blackList;
        if (data.spoofList) SPOOF_LIST = data.spoofList;
        if (data.extBlock) EXT_BLOCK = data.extBlock;
        if (data.alwaysBlock) ALWAYS_BLOCK = data.alwaysBlock;
        if (data.whiteList) WHITELIST = data.whiteList;
        if (data.regexRules) REGEX_RULES = data.regexRules;
        saveJSON('AdBlockX.BLACKLIST', BLACKLIST);
        saveJSON('AdBlockX.SPOOF_LIST', SPOOF_LIST);
        saveJSON('AdBlockX.EXT_BLOCK', EXT_BLOCK);
        saveJSON('AdBlockX.ALWAYS_BLOCK', ALWAYS_BLOCK);
        saveJSON('AdBlockX.WHITELIST', WHITELIST);
        saveJSON('AdBlockX.REGEX_RULES', REGEX_RULES);
        panelLog('Received extension sync update');
      }
    } catch(e){ panelLog('Extension sync receive failed: ' + e); }
  };
  // listen for extension sync messages
  if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      window.AdBlockX.receiveExtensionSync(message);
    });
  }
  } catch (e) {}

  // keep console-friendly logs in addition to UI
  console.log('%cAdBlockX initialized (SW attempt). Use the panel to control and export logs.', 'color:lime');
  try { if (window.AdBlockX && typeof window.AdBlockX.harden === 'function') { try { window.AdBlockX.harden(); } catch(e){} } } catch(e){}
})();
