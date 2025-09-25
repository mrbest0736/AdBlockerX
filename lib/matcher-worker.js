const { parentPort } = require('worker_threads');
const { Aho } = require('./aho');

let RULES = { blocks: [], exceptions: [], cosmetics: [] };
let _aho = null;
let regexBlocks = []; // array of {re, raw, options}

function buildIndex() {
  try {
    _aho = new Aho();
    regexBlocks = [];
    let id = 0;
    for (const b of RULES.blocks) {
      if (b.isRegex) {
        try { regexBlocks.push({ re: b.re, raw: b.raw, options: b.options }); } catch (e) {}
      } else {
        try { _aho.add(b.pattern, id++); } catch (e) {}
      }
    }
    _aho.build();
  } catch (e) {
    _aho = null; regexBlocks = [];
  }
}

function domainMatches(domainRules, hostname) {
  try {
    if (!domainRules) return true;
    hostname = (hostname || '').toLowerCase();
    let allow = false;
    for (const d of domainRules) {
      const name = (d.name || '').toLowerCase();
      if (d.neg) { if (hostname.endsWith(name)) return false; } else { if (hostname.endsWith(name)) allow = true; }
    }
    return allow;
  } catch (e) { return false; }
}

function resourceTypeMatches(ruleOpt, rtype) {
  try {
    if (!ruleOpt || !ruleOpt.resourceTypes || !ruleOpt.resourceTypes.length) return true;
    return ruleOpt.resourceTypes.some(t => t === rtype || t === '*');
  } catch (e) { return true; }
}

function matchUrl({ url, rtype, hostname }) {
  try {
    hostname = hostname || '';
    // check exceptions first
    for (const ex of RULES.exceptions) {
      const ok = ex.isRegex ? (ex.re && ex.re.test(url)) : (url.indexOf(ex.pattern) !== -1);
      if (ok && domainMatches(ex.options && ex.options.domains, hostname) && resourceTypeMatches(ex.options, rtype)) {
        return { matched: false, exception: true, rule: ex.raw };
      }
    }
    // check regex blocks
    for (const rb of regexBlocks) {
      try { if (rb.re && rb.re.test(url) && domainMatches(rb.options && rb.options.domains, hostname) && resourceTypeMatches(rb.options, rtype)) {
        return { matched: true, exception: false, rule: rb.raw };
      } } catch (e) {}
    }
    // aho substring matches
    if (_aho) {
      const matches = _aho.match(url);
      if (matches && matches.length) {
        // find the corresponding rule by scanning RULES.blocks for nth non-regex
        let idx = matches[0]; let count = 0; for (let i = 0; i < RULES.blocks.length; i++) {
          const b = RULES.blocks[i];
          if (!b.isRegex) {
            if (count === idx) {
              if (domainMatches(b.options && b.options.domains, hostname) && resourceTypeMatches(b.options, rtype)) return { matched: true, exception: false, rule: b.raw };
            }
            count++;
          }
        }
      }
    }
    // fallback substring linear scan
    for (const b of RULES.blocks) {
      if (b.isRegex) continue;
      if (url.indexOf(b.pattern) !== -1 && domainMatches(b.options && b.options.domains, hostname) && resourceTypeMatches(b.options, rtype)) {
        return { matched: true, exception: false, rule: b.raw };
      }
    }
    return { matched: false };
  } catch (e) { return { matched: false }; }
}

parentPort.on('message', (msg) => {
  try {
    if (!msg || !msg.type) return;
    if (msg.type === 'loadRules') {
      RULES = msg.rules || { blocks: [], exceptions: [], cosmetics: [] };
      buildIndex();
      parentPort.postMessage({ type: 'loaded' });
    } else if (msg.type === 'match') {
      const id = msg.id;
      const res = matchUrl(msg.payload || {});
      parentPort.postMessage({ type: 'matchResult', id, result: res });
    }
  } catch (e) { /* ignore */ }
});
