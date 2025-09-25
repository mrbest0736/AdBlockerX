const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const PORT = process.env.LICENSING_PORT || 5001;
const JWT_SECRET = process.env.LICENSING_JWT_SECRET || 'dev_secret_change_me';
const DB = require('./db');
// load .env in development if present
try{ require('dotenv').config(); }catch(e){}

// If you want real production subscriptions via Stripe, set these environment variables:
// STRIPE_SECRET_KEY - your Stripe secret (sk_live_...)
// STRIPE_PRICE_<PLAN>_<INTERVAL> - price IDs for each plan/interval. Example:
//   STRIPE_PRICE_PREMIUM_MONTHLY=price_1Hxxx...
//   STRIPE_PRICE_PREMIUM_YEARLY=price_1Hyyy...
// The /checkout/stripe endpoint will use these to create a Checkout Session.

// Optional Stripe integration: initialize only when the secret key is provided.
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

// pricing configuration: amounts are in cents (integer) and represent a suggested default
// Edit these values to reflect your real product pricing or integrate with Stripe/Paddle prices.
// pricing configuration: amounts are in cents (integer).
// Support both `monthly` and `yearly` billing intervals. Adjust values as needed.
const PRICE_BY_PLAN = {
  basic: {
    monthly: { amount_cents: 0, currency: 'USD', interval: 'monthly' },
    yearly:  { amount_cents: 0, currency: 'USD', interval: 'yearly' }
  },
  premium: {
    monthly: { amount_cents: 499, currency: 'USD', interval: 'monthly' },
    yearly:  { amount_cents: 499 * 12, currency: 'USD', interval: 'yearly' }
  },
  pro: {
    monthly: { amount_cents: 999, currency: 'USD', interval: 'monthly' },
    yearly:  { amount_cents: 999 * 12, currency: 'USD', interval: 'yearly' }
  }
};

// persistent subscriptions file (helpers)
const SUBS_PATH = path.join(__dirname, 'subscriptions.json');
function loadSubs(){ try{ if(!fs.existsSync(SUBS_PATH)) return {}; const s = fs.readFileSync(SUBS_PATH,'utf8')||''; return JSON.parse(s||'{}'); }catch(e){ console.warn('loadSubs failed', e); return {}; } }
function saveSubs(obj){ try{ fs.writeFileSync(SUBS_PATH, JSON.stringify(obj, null, 2), 'utf8'); }catch(e){ console.warn('saveSubs failed', e); } }

const app = express();
// capture raw body for webhook signature verification
app.use(bodyParser.json({ verify: function (req, res, buf) { req.rawBody = buf && buf.toString(); } }));

// health
app.get('/health', (req,res)=> res.json({ ok: true }));

// minimal webhook receiver for Paddle (dev mode) and Stripe (dev mode)
// These endpoints accept a POST with { provider, event, data } for development convenience.
// use DB functions for subscriptions and processed events
function isProcessed(eventId){ if(!eventId) return false; return DB.isEventProcessed(eventId); }
function markProcessed(eventId, meta){ if(!eventId) return; try{ DB.markEventProcessed(eventId, meta); }catch(e){} }

// verify signatures (Stripe HMAC-SHA256). For Stripe provide STRIPE_WEBHOOK_SECRET env var.
function verifySignature(provider, req){
  try{
    if(provider === 'stripe' && process.env.STRIPE_WEBHOOK_SECRET){
      const header = req.get('stripe-signature') || req.get('Stripe-Signature');
      if(!header) return { ok:false, err: 'missing signature header' };
      // header format: t=timestamp,v1=signature
      const pairs = header.split(',').map(s=>s.split('='));
      const map = Object.fromEntries(pairs.map(([k,v])=>[k,v]));
      const t = map.t;
      const v1 = map.v1;
      if(!t || !v1) return { ok:false, err: 'invalid signature header' };
      const payload = (req.rawBody || '');
      const signed = `${t}.${payload}`;
      const expected = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(signed).digest('hex');
      const sigBuf = Buffer.from(expected, 'hex');
      const v1Buf = Buffer.from(v1, 'hex');
      if(sigBuf.length !== v1Buf.length) return { ok:false, err: 'signature length mismatch' };
      if(!crypto.timingSafeEqual(sigBuf, v1Buf)) return { ok:false, err: 'signature mismatch' };
      // timestamp tolerance (5 minutes)
      const age = Math.abs(Date.now()/1000 - Number(t));
      if(age > 60*5) return { ok:false, err: 'timestamp outside tolerance' };
      return { ok:true };
    }
    // optional Paddle HMAC verification if PADDLE_WEBHOOK_SECRET provided (dev-friendly)
    if(provider === 'paddle' && process.env.PADDLE_WEBHOOK_SECRET){
      const header = req.get('paddle-signature') || req.get('Paddle-Signature');
      if(!header) return { ok:false, err: 'missing paddle signature header' };
      const payload = (req.rawBody || '');
      const expected = crypto.createHmac('sha256', process.env.PADDLE_WEBHOOK_SECRET).update(payload).digest('hex');
      const sigBuf = Buffer.from(expected, 'hex');
      const vBuf = Buffer.from(header, 'hex');
      if(sigBuf.length !== vBuf.length) return { ok:false, err: 'signature length mismatch' };
      if(!crypto.timingSafeEqual(sigBuf, vBuf)) return { ok:false, err: 'signature mismatch' };
      return { ok:true };
    }
    // if no verification configured, allow in dev mode
    return { ok:true, dev: true };
  }catch(e){ return { ok:false, err: String(e) }; }
}

function processWebhookPayload(provider, payload){
  // normalized record: userId required in payload.data.userId for this scaffold
  const data = payload.data || {};
  const userId = data.userId || data.email || data.customerEmail || 'guest_' + Math.random().toString(36).slice(2,8);
  const providerSubscriptionId = data.subscriptionId || data.subscription || data.id || ('sub_' + Math.random().toString(36).slice(2,8));
  const status = payload.type || data.status || 'active';
  const now = Date.now();
  // support billing interval: monthly or yearly
  const billingInterval = (data.billingInterval || data.interval || 'monthly').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
  const expiresAt = data.expiresAt || data.expires || (status === 'active' ? (billingInterval === 'yearly' ? now + 1000*60*60*24*365 : now + 1000*60*60*24*30) : now);
  // if event indicates cancellation, set status accordingly
  let entry;
  if(payload.type === 'subscription_cancelled' || payload.type === 'subscription_cancelled_by_user' || payload.type === 'subscription_cancelled_by_vendor'){
    entry = { id: provider + '_' + providerSubscriptionId, provider, providerSubscriptionId, userId, status: 'canceled', plan: data.plan || 'premium', billingInterval, startsAt: data.startsAt || now, expiresAt: Date.now(), raw: payload };
  } else {
    entry = { id: provider + '_' + providerSubscriptionId, provider, providerSubscriptionId, userId, status, plan: data.plan || 'premium', billingInterval, startsAt: data.startsAt || now, expiresAt, raw: payload };
  }
  // upsert into DB
  try{ DB.upsertSubscription(entry); }catch(e){ console.warn('db upsert failed', e); }
  return entry;
}

app.post('/webhook/:provider', (req,res)=>{
  const provider = req.params.provider;
  const payload = req.body || {};
  // verify signature if configured
  const vs = verifySignature(provider, req);
  if(!vs.ok){ console.warn('signature verify failed', vs.err); return res.status(400).json({ ok:false, error: vs.err }); }
  // determine event id for idempotency
  const eventId = payload.id || payload.eventId || (payload.data && (payload.data.id || payload.data.subscriptionId)) || null;
  if(eventId && isProcessed(eventId)){
    return res.json({ ok:true, alreadyProcessed: true, eventId });
  }
  try{
    const entry = processWebhookPayload(provider, payload);
    if(eventId) markProcessed(eventId, { provider, path: req.path });
    return res.json({ ok: true, entry });
  }catch(e){ console.warn('webhook error', e); return res.status(500).json({ ok: false }); }
});

// admin export: return subscriptions as CSV
app.get('/admin/export', (req,res)=>{
  try{
    const subs = loadSubs();
    const rows = ['userId,provider,providerSubscriptionId,status,plan,billingInterval,startsAt,expiresAt'];
    for(const userId of Object.keys(subs)){
      for(const s of subs[userId]){
        rows.push([userId, s.provider, s.providerSubscriptionId, s.status, s.plan, s.billingInterval || '', s.startsAt || '', s.expiresAt || ''].map(v=>String(v).replace(/,/g,'')).join(','));
      }
    }
    res.set('Content-Type','text/csv');
    res.send(rows.join('\n'));
  }catch(e){ res.status(500).json({ ok:false }); }
});

// dev-only: create a simulated checkout link for provider
app.get('/checkout/:provider', async (req,res)=>{
  const provider = req.params.provider;
  // in production, redirect to Paddle or Stripe Checkout
  // If Stripe is selected and configured, create a real Checkout Session
  if(provider === 'stripe' && stripe){
    // client should provide plan and interval query params
    const plan = (req.query.plan || 'premium').toLowerCase();
    const interval = (req.query.interval || 'monthly').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
    const envKey = `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;
    const priceId = process.env[envKey];
    if(!priceId) return res.status(400).json({ ok:false, error: `Missing ${envKey} env var` });
    try{
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        // success will be handled by webhook - but also redirect to a simple page
        success_url: `${req.protocol}://${req.get('host')}/licensing-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.protocol}://${req.get('host')}/licensing-cancel`
      });
      return res.json({ ok: true, checkoutUrl: session.url });
    }catch(e){ return res.status(500).json({ ok:false, error: String(e) }); }
  }
  // otherwise return a dev simulate URL
  const simulateUrl = `${req.protocol}://${req.get('host')}/simulate-purchase?provider=${provider}`;
  res.json({ ok: true, checkoutUrl: simulateUrl });
});

// dev helper: simulate a purchase by creating a subscription and redirecting to success
app.get('/simulate-purchase', (req,res)=>{
  const provider = req.query.provider || 'paddle';
  const userId = req.query.userId || `testuser@example.com`;
  const interval = (req.query.interval || 'monthly').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
  const subscriptionId = `${provider}_` + Math.random().toString(36).slice(2,9);
  const payload = { type: 'subscription_created', data: { userId, subscriptionId, status: 'active', billingInterval: interval, expiresAt: Date.now() + (interval === 'yearly' ? 1000*60*60*24*365 : 1000*60*60*24*30) } };
  // call webhook handler internally
  try{ req.body = payload; module.exports && app.handle(req, res, ()=>{}); }catch(e){}
  // store into subs directly for simplicity
  const subs = loadSubs();
  if(!subs[userId]) subs[userId] = [];
  subs[userId].push({ id: provider + '_' + subscriptionId, provider, providerSubscriptionId: subscriptionId, userId, status: 'active', plan: 'premium', billingInterval: interval, startsAt: Date.now(), expiresAt: Date.now() + (interval === 'yearly' ? 1000*60*60*24*365 : 1000*60*60*24*30), raw: payload });
  saveSubs(subs);
  // redirect to a simple success page (could be app-specific deep link)
  res.redirect(`/licensing-success?userId=${encodeURIComponent(userId)}`);
});

// simple success page
app.get('/licensing-success', (req,res)=>{
  const userId = req.query.userId || 'unknown';
  res.send(`<html><body><h2>Purchase simulated</h2><p>User: ${userId}</p><p>Return to the app and click Restore Purchase.</p></body></html>`);
});

// entitlement endpoint: returns canonical subscription(s) and a short-lived JWT for client
app.get('/entitlement/:userId', (req,res)=>{
  const userId = req.params.userId;
  const subs = loadSubs();
  const records = subs[userId] || [];
  // pick active ones, sort by expiresAt desc
  const active = records.filter(r=> r.status === 'active' || (r.expiresAt && r.expiresAt > Date.now())).sort((a,b)=> (b.expiresAt||0) - (a.expiresAt||0));
  const canonical = active.length ? active[0] : null;
  // attach pricing info for the plan & billing interval if known
  if(canonical && canonical.plan && PRICE_BY_PLAN[canonical.plan]){
    const interval = (canonical.billingInterval || 'monthly').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
    canonical.price = PRICE_BY_PLAN[canonical.plan][interval] || PRICE_BY_PLAN[canonical.plan].monthly;
  }
  const token = jwt.sign({ userId, sub: canonical ? canonical.id : null, exp: Math.floor(Date.now()/1000) + (60*60) }, JWT_SECRET);
  return res.json({ ok: true, canonical, token });
});

// restore endpoint: accept provider and proof and return entitlement if found
app.post('/entitlement/restore', (req,res)=>{
  const { provider, proof } = req.body || {};
  // dev-mode: accept proof.userId and lookup
  try{
    const subs = loadSubs();
    const userId = (proof && proof.userId) || proof || 'guest';
    const records = subs[userId] || [];
    const active = records.filter(r=> r.status === 'active' || (r.expiresAt && r.expiresAt > Date.now())).sort((a,b)=> (b.expiresAt||0) - (a.expiresAt||0));
    const canonical = active.length ? active[0] : null;
    // attach price info if available
    if(canonical && canonical.plan && PRICE_BY_PLAN[canonical.plan]){
      const interval = (canonical.billingInterval || 'monthly').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
      canonical.price = PRICE_BY_PLAN[canonical.plan][interval] || PRICE_BY_PLAN[canonical.plan].monthly;
    }
    const token = jwt.sign({ userId, sub: canonical ? canonical.id : null, exp: Math.floor(Date.now()/1000) + (60*60) }, JWT_SECRET);
    return res.json({ ok: true, canonical, token });
  }catch(e){ return res.status(500).json({ ok: false }); }
});

app.listen(PORT, ()=> console.log('Licensing server running on port', PORT));

module.exports = app;
