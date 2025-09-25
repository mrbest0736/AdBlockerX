const assert = require('assert');
const axios = require('axios');
describe('licensing server (dev)', function(){
  it('returns health and can simulate purchase', async function(){
    this.timeout(5000);
    const base = process.env.LICENSING_URL || 'http://127.0.0.1:5001';
    const h = await axios.get(base + '/health');
    assert.ok(h.data && h.data.ok);
    const ck = await axios.get(base + '/checkout/paddle');
    assert.ok(ck.data && ck.data.checkoutUrl);
  });
});
