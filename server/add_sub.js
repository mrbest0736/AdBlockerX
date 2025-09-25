const DB = require('./db');
const fs = require('fs');
const path = require('path');

const entry = {
  id: 'test_manual_1',
  provider: 'test',
  providerSubscriptionId: 'manual_1',
  userId: 'testuser@example.com',
  status: 'active',
  plan: 'premium',
  startsAt: Date.now(),
  expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
  raw: { source: 'manual' }
};

DB.upsertSubscription(entry);
console.log('Upserted subscription for', entry.userId);
const subsPath = path.join(__dirname, 'subscriptions.json');
try{
  const s = fs.readFileSync(subsPath, 'utf8');
  console.log('\nsubscriptions.json content:\n');
  console.log(s);
}catch(e){ console.error('failed to read subscriptions.json', e); }
