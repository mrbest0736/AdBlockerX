// Copied simplified ABP parser (adapted from project lib)
// Keep in sync with repository's `lib/abp.js` when improving the parser.

/* Minimal parser API:
 * parse(filtersArray) -> returns array of rule objects
 */

function parseOptions(optStr) {
  const opts = { resourceTypes: null, domains: null, thirdParty: null };
  if (!optStr) return opts;
  const parts = optStr.split(',').map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    const [k, v] = p.split('=', 2).map(s => s.trim());
    if (!v) {
      const token = k.toLowerCase();
      if (token === 'third-party' || token === 'thirdparty') opts.thirdParty = true;
      else {
        // treat as resource token
        opts.resourceTypes = opts.resourceTypes || [];
        opts.resourceTypes.push(token);
      }
    } else {
      if (k.toLowerCase() === 'domain') {
        const domains = v.split('|').map(d => d.trim()).filter(Boolean);
        opts.domains = domains.map(d => ({ name: d.startsWith('~') ? d.slice(1) : d, neg: d.startsWith('~') }));
      }
    }
  }
  return opts;
}

function parseLine(line){
  const raw = String(line||'').trim();
  if(!raw) return null;
  if(raw.startsWith('!') || raw.startsWith('#')) return null;
  const cosIdx = raw.indexOf('##');
  if(cosIdx !== -1){ const domainPart = raw.slice(0, cosIdx).trim(); const selector = raw.slice(cosIdx+2).trim(); const domains = domainPart ? domainPart.split(',').map(s=>s.trim()).filter(Boolean) : null; return { type: 'cosmetic', raw, selector, domains }; }
  let isException = false; let line2 = raw; if(line2.startsWith('@@')){ isException = true; line2 = line2.slice(2); }
  let pattern = line2; let options = null; const dollar = line2.indexOf('$'); if(dollar !== -1){ pattern = line2.slice(0,dollar); options = parseOptions(line2.slice(dollar+1)); }
  pattern = pattern.trim(); if(!pattern) return null;
  if(pattern.startsWith('/') && pattern.lastIndexOf('/')>0){ const last = pattern.lastIndexOf('/'); const body = pattern.slice(1,last); const flags = pattern.slice(last+1); try{ const re = new RegExp(body, flags); return { type: isException ? 'exception' : 'block', raw, pattern, isRegex:true, re, options }; }catch(e){} }
  return { type: isException ? 'exception' : 'block', raw, pattern, isRegex:false, options };
}

function parse(filters){ const out = []; for(const l of (filters||[])){ try{ const r = parseLine(l); if(r) out.push(r); }catch(e){} } return out; }

if(typeof module !== 'undefined' && module.exports) module.exports = { parse, parseLine, parseOptions };
