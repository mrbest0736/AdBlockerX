// Basic background service worker for AdBlockX prototype extension
// Note: This is a minimal sketch demonstrating webRequest blocking and
// declarativeNetRequest rule updates. It's not a full production extension.

const defaultBlockHosts = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.pagead2.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://*.amazon-adsystem.com/*',
  '*://*.facebook.com/tr/*',
  '*://*.facebook.net/*',
  '*://*.outbrain.com/*',
  '*://*.taboola.com/*',
  '*://*.criteo.com/*',
  '*://*.pubmatic.com/*',
  '*://*.openx.net/*',
  '*://*.adsystem.amazon.com/*',
  '*://*.googletagmanager.com/*',
  '*://*.googletagservices.com/*',
  '*://*.google-analytics.com/*',
  '*://*.scorecardresearch.com/*',
  '*://*.quantserve.com/*',
  '*://*.hotjar.com/*',
  '*://*.ads-twitter.com/*',
  '*://*.t.co/*',
  '*://*.pinterest.com/*',
  '*://*.linkedin.com/*',
  '*://*.ads.linkedin.com/*',
  '*://*.bing.com/*',
  '*://*.microsoft.com/*',
  '*://*.yahoo.com/*',
  '*://*.aol.com/*',
  '*://*.advertising.com/*',
  '*://*.thetrade.com/*'
];

// Add simple blocking rules via declarativeNetRequest (fast, supported in MV3)
async function installDefaultRules() {
  try {
    // Define rule IDs that will be used (expanded for more rules)
    const ruleIds = [];
    for (let i = 1000; i < 1000 + defaultBlockHosts.length; i++) ruleIds.push(i);
    for (let i = 2001; i <= 2008; i++) ruleIds.push(i);
    for (let i = 3001; i <= 3003; i++) ruleIds.push(i);
    
    // Remove existing rules with these IDs first
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ruleIds });
    
    const rules = defaultBlockHosts.map((pattern, idx) => ({
      id: 1000 + idx,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: pattern }
    }));
    // Aggressive YouTube rules (additional). Use urlFilter anchors and query matching
    const ytRules = [
      { id: 2001, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||youtube.com/get_midroll', resourceTypes: ['xmlhttprequest','sub_frame','script'] } },
      { id: 2002, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||youtube.com/api/stats/ads', resourceTypes: ['xmlhttprequest'] } },
      { id: 2003, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||youtubei.googleapis.com^', resourceTypes: ['xmlhttprequest','script'] } },
      { id: 2004, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||youtube.com/watch?*v=*ad*', resourceTypes: ['main_frame'] } },
      { id: 2005, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||youtube.com/get_video_info', resourceTypes: ['xmlhttprequest'] } },
      { id: 2006, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||googlevideo.com/*ad*', resourceTypes: ['media','other'] } },
      // block ad-tagged query params commonly used for ad beacons
      { id: 2007, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'adformat=', resourceTypes: ['xmlhttprequest','script','image'] } },
      { id: 2008, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'ad_break', resourceTypes: ['xmlhttprequest','script'] } }
    ];

    // Allow rules to avoid breaking media/content hosts: prefer allow higher-priority rules
    const allowRules = [
      // allow static image/video CDN paths (i.ytimg and googlevideo content paths)
      { id: 3001, priority: 2, action: { type: 'allow' }, condition: { urlFilter: '||i.ytimg.com/vi/', resourceTypes: ['image'] } },
      { id: 3002, priority: 2, action: { type: 'allow' }, condition: { urlFilter: '||r[0-9]---sn', resourceTypes: ['media','other'] } },
      { id: 3003, priority: 2, action: { type: 'allow' }, condition: { urlFilter: '||googlevideo.com/videoplayback', resourceTypes: ['media'] } }
    ];

    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules.concat(ytRules).concat(allowRules) });
    console.log('AdBlockX extension: default rules installed');
  } catch (e) { console.error('installDefaultRules failed', e); }
}

chrome.runtime.onInstalled.addListener(() => {
  installDefaultRules();
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'AdBlockX:getStatus') {
    sendResponse({ installed: true, rulesInstalled: true });
  } else if (msg.action === 'enableNetworkRules') {
    installDefaultRules();
    sendResponse({ success: true });
  } else if (msg.action === 'disableNetworkRules') {
    // Remove all dynamic rules
    chrome.declarativeNetRequest.getDynamicRules().then(rules => {
      const ruleIds = rules.map(rule => rule.id);
      chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ruleIds });
    });
    sendResponse({ success: true });
  }
  return true;
});

console.log('AdBlockX extension background initialized');
