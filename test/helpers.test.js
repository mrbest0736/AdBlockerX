const { expect } = require('chai');

// Reimplemented helper functions similar to those in AdBlockerX.html
function loadJSON(key, fallback){
  try{
    const v = globalThis.__mock_storage && globalThis.__mock_storage[key];
    if(!v) return fallback;
    return JSON.parse(v);
  }catch(e){
    return fallback;
  }
}
function saveJSON(key, val){
  try{
    if(!globalThis.__mock_storage) globalThis.__mock_storage = {};
    globalThis.__mock_storage[key] = JSON.stringify(val);
  }catch(e){}
}

describe('helpers.loadJSON & saveJSON', ()=>{
  beforeEach(()=>{ globalThis.__mock_storage = {}; });

  it('returns fallback when key missing', ()=>{
    const res = loadJSON('NON_EXISTENT', 42);
    expect(res).to.equal(42);
  });

  it('parses stored JSON value', ()=>{
    saveJSON('K', {a:1});
    const res = loadJSON('K', null);
    expect(res).to.deep.equal({a:1});
  });

  it('returns fallback if stored value is invalid JSON', ()=>{
    globalThis.__mock_storage['BAD'] = '{not json';
    const res = loadJSON('BAD', 'fallback');
    expect(res).to.equal('fallback');
  });
});
