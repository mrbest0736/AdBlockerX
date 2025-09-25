const assert = require('assert');
const {parseLine, parse, parseOptions} = require('../lib/abp');

describe('ABP parser', function() {
  it('parses empty and comment lines as null', function() {
    assert.strictEqual(parseLine(''), null);
    assert.strictEqual(parseLine('! a comment'), null);
    assert.strictEqual(parseLine('# another'), null);
  });

  it('parses cosmetic selectors', function() {
    const r = parseLine('example.com##.ad-banner');
    assert.strictEqual(r.type, 'cosmetic');
    assert.deepStrictEqual(r.domains, ['example.com']);
    assert.strictEqual(r.selector, '.ad-banner');
    const r2 = parseLine('##.site-ad');
    assert.strictEqual(r2.type, 'cosmetic');
    assert.strictEqual(r2.domains, null);
    assert.strictEqual(r2.selector, '.site-ad');
  });

  it('parses exception and block substring rules', function() {
    const ex = parseLine('@@||ads.example.com^');
    assert.strictEqual(ex.type, 'exception');
    // exception should be represented as a block-type with isRegex maybe true/false
    assert.ok(ex.raw.indexOf('ads.example.com') !== -1 || ex.isRegex);

    const bl = parseLine('||tracker.example.org^');
    assert.ok(bl);
    assert.ok(['block'].includes(bl.type));
  });

  it('parses regex rules', function() {
    const r = parseLine('/ads[0-9]+\.js/');
    assert.strictEqual(r.type, 'block');
    assert.ok(r.isRegex);
    assert.ok(r.re.test('ads123.js'));
  });

  it('parses options domain and resource types', function() {
    const r = parseLine('||example.com^$script,domain=example.com|~sub.example.com,third-party');
    assert.ok(r.options);
    assert.ok(r.options.resourceTypes && Array.isArray(r.options.resourceTypes));
    assert.ok(r.options.domains && Array.isArray(r.options.domains));
  });

  it('parse() handles multiple lines', function() {
    const txt = `! comment\n||ads.example.com^\n@@||good.example.com^\nexample.com##.ad`;
    const out = parse(txt);
    assert.strictEqual(out.length, 3);
    const types = out.map(x => x.type).sort();
    assert.deepStrictEqual(types, ['cosmetic','exception','block'].sort());
  });
});
