// ConX - AdBlockerX Control and Validation System
// Ensures strict protocols and comprehensive ad blocking validation

(function() {
  'use strict';

  const ConX = {
    version: '1.0.0',
    initialized: false,
    stats: {
      requestsBlocked: 0,
      requestsAllowed: 0,
      bypassAttempts: 0,
      lastActivity: Date.now(),
      domains: new Set(),
      suspiciousPatterns: []
    },

    // Strict protocol definitions
    PROTOCOLS: {
      NETWORK_LEVEL: {
        enabled: true,
        strictMode: true,
        blockAllAds: true,
        allowList: ['content-delivery-networks', 'essential-services']
      },
      RUNTIME_LEVEL: {
        enabled: true,
        strictMode: true,
        hookAllRequests: true,
        validateIntegrity: true
      },
      VALIDATION_LEVEL: {
        enabled: true,
        continuousMonitoring: true,
        anomalyDetection: true,
        protocolEnforcement: true
      }
    },

    // Comprehensive ad domain patterns
    AD_PATTERNS: [
      // Core ad networks
      /doubleclick\.net/i,
      /googlesyndication\.com/i,
      /googleadservices\.com/i,
      /amazon-adsystem\.com/i,
      /facebook\.com\/tr\//i,
      /outbrain\.com/i,
      /taboola\.com/i,
      /criteo\.com/i,
      /pubmatic\.com/i,
      /openx\.net/i,

      // Analytics and tracking
      /googletagmanager\.com/i,
      /googletagservices\.com/i,
      /google-analytics\.com/i,
      /scorecardresearch\.com/i,
      /quantserve\.com/i,
      /hotjar\.com/i,

      // Social media ads
      /ads-twitter\.com/i,
      /pinterest\.com/i,
      /linkedin\.com/i,
      /ads\.linkedin\.com/i,

      // Search engine ads
      /bing\.com/i,
      /yahoo\.com/i,
      /advertising\.com/i,

      // Generic ad patterns
      /\/ads?\//i,
      /\/advertisement/i,
      /banner/i,
      /popup/i,
      /interstitial/i,
      /\b(ad|ads|advert)\b/i
    ],

    // Initialize ConX system
    init: function() {
      if (this.initialized) return;
      console.log('%c[ConX] Initializing Control System v' + this.version, 'color:#ff4444;font-weight:bold;');

      this.setupNetworkMonitoring();
      this.setupRuntimeValidation();
      this.setupAnomalyDetection();
      this.enforceProtocols();

      this.initialized = true;
      this.stats.lastActivity = Date.now();

      // Report initialization
      this.reportStatus('initialized');
    },

    // Network-level monitoring and blocking
    setupNetworkMonitoring: function() {
      const self = this;

      // Monitor fetch requests
      const originalFetch = window.fetch;
      window.fetch = function(...args) {
        const url = args[0] instanceof Request ? args[0].url : args[0];

        if (self.shouldBlockRequest(url)) {
          self.stats.requestsBlocked++;
          self.stats.domains.add(self.extractDomain(url));
          console.log('%c[ConX] BLOCKED (fetch): ' + url, 'color:#ff0000;');

          // Return blocked response
          return Promise.resolve(new Response('', {
            status: 204,
            statusText: 'No Content (ConX Blocked)'
          }));
        }

        self.stats.requestsAllowed++;
        return originalFetch.apply(this, args);
      };

      // Monitor XMLHttpRequest
      const originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...args) {
        if (self.shouldBlockRequest(url)) {
          self.stats.requestsBlocked++;
          self.stats.domains.add(self.extractDomain(url));
          console.log('%c[ConX] BLOCKED (XHR): ' + url, 'color:#ff0000;');

          // Mark for blocking in send()
          this._conxBlocked = true;
        }

        return originalOpen.call(this, method, url, ...args);
      };

      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function(...args) {
        if (this._conxBlocked) {
          // Abort blocked requests
          setTimeout(() => {
            if (this.readyState !== 4) {
              this.abort();
            }
          }, 0);
          return;
        }

        return originalSend.apply(this, args);
      };
    },

    // Runtime validation and integrity checks
    setupRuntimeValidation: function() {
      const self = this;

      // Periodic integrity checks
      setInterval(function() {
        self.validateIntegrity();
      }, 30000); // Every 30 seconds

      // Monitor for bypass attempts
      this.monitorBypassAttempts();
    },

    // Anomaly detection system
    setupAnomalyDetection: function() {
      const self = this;

      // Monitor for suspicious patterns
      const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach(function(node) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                self.checkForAdElements(node);
              }
            });
          }
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    },

    // Protocol enforcement
    enforceProtocols: function() {
      const self = this;

      // Strict CSP enforcement for ad-related content
      const meta = document.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none';";
      document.head.appendChild(meta);

      // Block common ad injection methods
      Object.defineProperty(window, 'googletag', {
        get: function() { return null; },
        set: function() { return null; },
        configurable: false
      });

      // Monitor and block dynamic script injection
      const originalCreateElement = document.createElement;
      document.createElement = function(tagName, options) {
        const element = originalCreateElement.call(this, tagName, options);

        if (tagName.toLowerCase() === 'script') {
          const originalSetAttribute = element.setAttribute;
          element.setAttribute = function(name, value) {
            if (name === 'src' && self.shouldBlockScript(value)) {
              console.log('%c[ConX] BLOCKED SCRIPT: ' + value, 'color:#ff0000;');
              return;
            }
            return originalSetAttribute.call(this, name, value);
          };
        }

        return element;
      };
    },

    // Core validation functions
    shouldBlockRequest: function(url) {
      if (!url || typeof url !== 'string') return false;

      // Check against ad patterns
      for (const pattern of this.AD_PATTERNS) {
        if (pattern.test(url)) {
          return true;
        }
      }

      // Check for suspicious query parameters
      const suspiciousParams = ['ad', 'ads', 'advert', 'banner', 'popup', 'track', 'pixel'];
      try {
        const urlObj = new URL(url);
        for (const param of urlObj.searchParams.keys()) {
          if (suspiciousParams.some(suspicious => param.toLowerCase().includes(suspicious))) {
            this.stats.suspiciousPatterns.push(param);
            return true;
          }
        }
      } catch (e) {
        // Invalid URL, allow
      }

      return false;
    },

    shouldBlockScript: function(src) {
      return this.shouldBlockRequest(src);
    },

    checkForAdElements: function(element) {
      // Check for common ad element patterns
      const adSelectors = [
        '[id*="ad"]', '[class*="ad"]', '[id*="banner"]', '[class*="banner"]',
        '[id*="popup"]', '[class*="popup"]', '[id*="modal"]', '[class*="modal"]',
        'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]'
      ];

      for (const selector of adSelectors) {
        if (element.matches && element.matches(selector)) {
          console.log('%c[ConX] DETECTED AD ELEMENT: ' + selector, 'color:#ff6600;');
          element.style.display = 'none';
          break;
        }
      }
    },

    validateIntegrity: function() {
      // Check if our hooks are still in place
      const hooksIntact =
        window.fetch !== window.originalFetch &&
        XMLHttpRequest.prototype.open !== window.originalXHROpen;

      if (!hooksIntact) {
        console.warn('%c[ConX] INTEGRITY COMPROMISED - Reinitializing...', 'color:#ff0000;');
        this.init();
      }
    },

    monitorBypassAttempts: function() {
      const self = this;

      // Monitor for attempts to restore original functions
      const originalAddEventListener = window.addEventListener;
      window.addEventListener = function(type, listener, options) {
        if (type === 'load' || type === 'DOMContentLoaded') {
          // Check if listener tries to bypass our system
          const originalListener = listener;
          listener = function(event) {
            try {
              // Monitor for suspicious activity
              if (window.fetch === window.originalFetch) {
                self.stats.bypassAttempts++;
                console.warn('%c[ConX] BYPASS ATTEMPT DETECTED', 'color:#ff0000;');
              }
            } catch (e) {}
            return originalListener.call(this, event);
          };
        }
        return originalAddEventListener.call(this, type, listener, options);
      };
    },

    // Utility functions
    extractDomain: function(url) {
      try {
        return new URL(url).hostname;
      } catch (e) {
        return url;
      }
    },

    reportStatus: function(action) {
      console.log('%c[ConX] Status Report:', 'color:#4444ff;font-weight:bold;');
      console.log('Action:', action);
      console.log('Stats:', this.stats);
      console.log('Protocols:', this.PROTOCOLS);

      // Send to extension background if available
      if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'ConX:status',
          stats: this.stats,
          action: action
        });
      }
    },

    // Public API
    getStats: function() {
      return { ...this.stats };
    },

    forceRevalidation: function() {
      this.validateIntegrity();
      this.reportStatus('revalidation');
    }
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      ConX.init();
    });
  } else {
    ConX.init();
  }

  // Expose ConX globally for debugging and control
  window.ConX = ConX;

})();