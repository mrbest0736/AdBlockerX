// Helper to perform server-side log queries used by electron-main.js
// Exports: queryLogs(logsArray, opts) -> { total, entries }
function queryLogs(LOGS, opts){
  opts = opts || {};
  const limit = Math.max(1, Math.min(typeof opts.limit === 'number' ? opts.limit : (parseInt(opts.limit) || 100), 5000));
  const offset = Math.max(0, parseInt(opts.offset) || 0);
  const q = opts.q ? String(opts.q).toLowerCase() : '';
  const type = opts.type || 'all';
  const filtered = [];
  for(let i = LOGS.length - 1; i >= 0; --i){
    const item = LOGS[i];
    try{
      if(type && type !== 'all' && item.type !== type) continue;
      if(q){
        const s = q;
        const url = (item.url||'').toLowerCase();
        const rule = (item.rule||'').toLowerCase();
        const typ = (item.type||'').toLowerCase();
        if(!(url.includes(s) || rule.includes(s) || typ.includes(s))) continue;
      }
      filtered.push(item);
    }catch(e){ continue; }
  }
  const total = filtered.length;
  const entries = filtered.slice(offset, offset + limit);
  return { total, entries };
}

module.exports = { queryLogs };
