const assert = require('assert');
const { Worker } = require('worker_threads');
const path = require('path');

describe('matcher worker', function(){
  it('loads rules and matches substring and regex', function(done){
    this.timeout(5000);
    const w = new Worker(path.join(__dirname, '..', 'lib', 'matcher-worker.js'));
    w.on('message', (m)=>{
      try{
        if(m && m.type === 'loaded'){
          // ask for a match
          const id = 1;
          w.postMessage({ type: 'match', id, payload: { url: 'https://example.com/ads/banner.js', rtype: 'script', hostname: 'example.com' } });
        } else if(m && m.type === 'matchResult'){
          try{ assert.ok(m.result); }catch(e){ done(e); }
          w.terminate().then(()=>done());
        }
      }catch(e){ done(e); }
    });
    w.on('error', done);
    // load rules: one substring block and one regex block
    const rules = { blocks: [ { isRegex:false, pattern:'/ads/', raw:'/ads/' }, { isRegex:true, re: /banner\.js/, raw:'/banner.js/' } ], exceptions: [], cosmetics: [] };
    // small delay to ensure worker starts
    setTimeout(()=>{ try{ w.postMessage({ type: 'loadRules', rules }); }catch(e){ done(e); } }, 100);
  });
});
