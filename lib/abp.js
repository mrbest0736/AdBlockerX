
const RE_RESOURCE_MAP = {
  'image': 'image',
  'script': 'script',
  'stylesheet': 'stylesheet',
  'object': 'object',
  'xmlhttprequest': 'xhr',
  'subdocument': 'subdocument',
  'document': 'document',
  'other': 'other'
};

function parseOptions(optStr) {
  const opts = { resourceTypes: null, domains: null, thirdParty: null };
  if (!optStr) return opts;
  const parts = String(optStr).split(',').map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    const [k, v] = p.split('=', 2).map(s => s.trim());
    if (typeof v === 'undefined' || v === '') {
      const token = (k || '').toLowerCase();
      if (token === 'third-party' || token === 'thirdparty') opts.thirdParty = true;
      else if (token === '~third-party' || token === '~thirdparty') opts.thirdParty = false;
      else if (RE_RESOURCE_MAP[token]) { opts.resourceTypes = opts.resourceTypes || []; opts.resourceTypes.push(RE_RESOURCE_MAP[token]); }
    } else {
      const key = (k || '').toLowerCase();
      if (key === 'domain') {
        const domains = String(v).split('|').map(d => d.trim()).filter(Boolean);
        opts.domains = domains.map(d => ({ name: d.startsWith('~') ? d.slice(1) : d, neg: d.startsWith('~') }));
      } else if (key === 'third-party' || key === 'thirdparty') {
        opts.thirdParty = (v !== '0' && v !== 'false');
      }
    }
  }
  return opts;
}

function parseLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  if (raw.startsWith('!')) return null;
  if (raw.startsWith('#') && !raw.startsWith('##') && !raw.startsWith('#@#')) return null;

  if (raw.includes('##') || raw.includes('#@#')) {
    const exc = raw.indexOf('#@#') !== -1;
    const parts = raw.split(exc ? '#@#' : '##');
    const domainPart = (parts[0] || '').trim();
    const selector = (parts[1] || '').trim();
    const domains = domainPart ? domainPart.split(',').map(s => s.trim()).filter(Boolean) : null;
    return { type: 'cosmetic', domains: domains || null, selector, exception: exc, raw };
  }

  let line2 = raw; let isException = false;
  if (line2.startsWith('@@')) { isException = true; line2 = line2.slice(2).trim(); }

  let opts = null; const dollar = line2.indexOf('$');
  if (dollar !== -1) { opts = parseOptions(line2.slice(dollar + 1)); line2 = line2.slice(0, dollar).trim(); }
  if (!line2) return null;

  if (line2.startsWith('/') && line2.lastIndexOf('/') > 0) {
    const last = line2.lastIndexOf('/'); const body = line2.slice(1, last); const flags = line2.slice(last + 1);
    try { const re = new RegExp(body, flags); return { type: isException ? 'exception' : 'block', isRegex: true, re, options: opts, raw }; } catch (e) { return null; }
  }

  const startsWithAnchor = line2.startsWith('|'); const endsWithAnchor = line2.endsWith('|');
  if (startsWithAnchor) line2 = line2.slice(1); if (endsWithAnchor) line2 = line2.slice(0, -1);

  if (line2.includes('*') || line2.includes('^')) {
    let reStr = line2.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&');
    reStr = reStr.replace(/\\\*/g, '.*');
    reStr = reStr.replace(/\\\^/g, '(?:[\\/?&:#]|$)');
    if (startsWithAnchor) reStr = '^' + reStr; if (endsWithAnchor) reStr = reStr + '$';
    try { const re = new RegExp(reStr); return { type: isException ? 'exception' : 'block', isRegex: true, re, options: opts, raw }; } catch (e) { return null; }
  }

  return { type: isException ? 'exception' : 'block', isRegex: false, pattern: line2, startsWithAnchor, endsWithAnchor, options: opts, raw };
}

function parse(text) { return (String(text || '')).split(/\r?\n/).map(l => parseLine(l)).filter(Boolean); }

module.exports = { parse, parseLine, parseOptions };
