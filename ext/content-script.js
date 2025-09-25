// Content script for AdBlockerX extension - handles video player ad blocking
(() => {
  'use strict';
  console.log('AdBlockerX content script loaded');

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'inject_blocker') {
      // Inject the main blocker script into the page
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('AdBlockerX.js');
      document.head.appendChild(script);
      sendResponse({ success: true });
    }
  });

  // Block ads in video players (e.g., YouTube, Vimeo)
  function blockVideoAds() {
    try {
      // YouTube specific
      const ytAds = document.querySelectorAll('.video-ads, .ytp-ad-module, [class*="ad-"], [id*="ad"]');
      ytAds.forEach(ad => ad.remove());

      // Generic video ad blocking
      const videos = document.querySelectorAll('video');
      videos.forEach(video => {
        if (video.src && (video.src.includes('ad') || video.src.includes('doubleclick'))) {
          video.remove();
        }
      });

      // Mutation observer for dynamic ads
      const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1 && (node.className.includes('ad') || node.id.includes('ad'))) {
              node.remove();
            }
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch(e) { console.warn('Video ad blocking failed', e); }
  }

  // Run on load and periodically
  blockVideoAds();
  setInterval(blockVideoAds, 5000);
})();