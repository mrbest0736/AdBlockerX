// Minimal content script scaffold to host runtime in page context.
// The AdBlockerX runtime (AdBlockerX.js) can be adapted to run here by
// copying or bundling it into the extension.

(function(){
  if(window.__adblockx_webext) return;
  window.__adblockx_webext = { initialized: true };
  console.log('AdBlockerX content script scaffold loaded');
})();
