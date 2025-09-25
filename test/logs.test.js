const { expect } = require('chai');
const { queryLogs } = require('../lib/logs-query');

describe('abx-logs-query', ()=>{
  // helper to build dummy logs
  function makeLogs(n){
    const out = [];
    for(let i=0;i<n;i++){
      out.push({ id: 'log_'+i, t: new Date(1600000000000 + i*1000).toISOString(), type: i%3===0 ? 'blocked' : (i%3===1 ? 'spoofed' : 'observed'), url: `https://example.com/page${i}`, rule: i%2===0 ? '||ads.example.com^' : '/banner\.js/' });
    }
    return out;
  }

  it('returns total and first page', ()=>{
    const logs = makeLogs(250);
    const res = queryLogs(logs, { limit: 50, offset: 0 });
    expect(res).to.have.property('total', 250);
    expect(res.entries).to.have.length(50);
    // newest first
    expect(res.entries[0].id).to.equal('log_249');
  });

  it('applies offset correctly', ()=>{
    const logs = makeLogs(120);
    const p1 = queryLogs(logs, { limit: 20, offset: 0 });
    const p2 = queryLogs(logs, { limit: 20, offset: 20 });
    expect(p1.entries[0].id).to.not.equal(p2.entries[0].id);
    expect(p2.entries[0].id).to.equal('log_99'); // 120-1-20 = 99 as first of second page
  });

  it('filters by query string', ()=>{
    const logs = makeLogs(40);
    // pick a url that contains page7
    const r = queryLogs(logs, { q: 'page7', limit: 10 });
    expect(r.total).to.be.greaterThan(0);
    expect(r.entries.some(e => e.url.includes('page7'))).to.be.true;
  });

  it('filters by type', ()=>{
    const logs = makeLogs(30);
    const r = queryLogs(logs, { type: 'blocked', limit: 1000 });
    // roughly 1/3 blocked
    expect(r.total).to.be.greaterThan(0);
    expect(r.entries.every(e => e.type === 'blocked')).to.be.true;
  });

  it('handles empty logs gracefully', ()=>{
    const r = queryLogs([], { limit: 10 });
    expect(r.total).to.equal(0);
    expect(r.entries).to.have.length(0);
  });
});
