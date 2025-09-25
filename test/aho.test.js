const { expect } = require('chai');
const { Aho } = require('../lib/aho');

describe('Aho-Corasick matcher', ()=>{
  it('matches simple patterns', ()=>{
    const a = new Aho();
    a.add('abc', 'p1');
    a.add('bcd', 'p2');
    a.build();
    const res = a.match('xxabcdyy');
    expect(res).to.include('p1');
    expect(res).to.include('p2');
  });

  it('returns empty when no match', ()=>{
    const a = new Aho(); a.add('foo','f'); a.build(); const r = a.match('bar'); expect(r).to.be.an('array').that.is.empty;
  });
});
