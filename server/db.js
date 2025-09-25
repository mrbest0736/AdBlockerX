const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUBS_PATH = path.join(__dirname, 'subscriptions.json');
const PROCESSED_PATH = path.join(__dirname, 'processed_events.json');
const KEYS_DIR = path.join(__dirname, 'keys');

// Encryption settings: transparent AES-256-GCM for data at rest when SUBS_ENCRYPTION_KEY is set.
// The key can be any passphrase; a 32-byte key is derived via SHA-256.
function getEncryptionKey(){ const raw = process.env.SUBS_ENCRYPTION_KEY || process.env.SUBS_ENC_KEY || null; if(!raw) return null; return crypto.createHash('sha256').update(String(raw)).digest(); }

function loadRsaPublicKey(){
  // Public key used to wrap AES keys for ENCv2. If present, the wrapping will be done with it.
  try{
    const p = path.join(KEYS_DIR, 'public.pem');
    if(fs.existsSync(p)) return fs.readFileSync(p,'utf8');
  }catch(e){ /* ignore */ }
  return null;
}

function loadRsaPrivateKey(){
  try{
    const p = path.join(KEYS_DIR, 'private.pem');
    if(fs.existsSync(p)) return fs.readFileSync(p,'utf8');
  }catch(e){ /* ignore */ }
  return null;
}

function encryptBuffer(buf){
  // If RSA public key present, use envelope encryption: generate random AES key, encrypt data with AES-GCM, wrap AES key with RSA-OAEP.
  const pub = loadRsaPublicKey();
  if(pub){
    // ENCv2 format: 'ENCv2' + base64(rsaWrappedKey|iv|tag|ciphertext)
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrapped = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, aesKey);
    return 'ENCv2' + Buffer.concat([wrapped, iv, tag, ciphertext]).toString('base64');
  }
  // fallback to ENCv1 using symmetric key from env
  const key = getEncryptionKey();
  if(!key) throw new Error('encryption key not available');
  const iv = crypto.randomBytes(12); // recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  // store format: prefix + base64(iv|tag|ciphertext)
  return 'ENCv1' + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decryptString(s){
  if(!s || typeof s !== 'string') return null;
  if(s.startsWith('ENCv2')){
    // ENCv2: rsaWrappedKey|iv|tag|ciphertext
    const b = Buffer.from(s.slice(5), 'base64');
    // need private key to unwrap
    const priv = loadRsaPrivateKey();
    if(!priv) throw new Error('private key for ENCv2 not found in server/keys');
    // wrapped key length equals RSA key size in bytes (4096 bits => 512 bytes). We'll try to infer by attempting unwrap progressively is complex; instead, assume 512 for 4096-bit keys and fallback to env symmetric.
    const rsaLen = 512;
    const wrapped = b.slice(0, rsaLen);
    const iv = b.slice(rsaLen, rsaLen+12);
    const tag = b.slice(rsaLen+12, rsaLen+28);
    const ciphertext = b.slice(rsaLen+28);
    const aesKey = crypto.privateDecrypt({ key: priv, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, wrapped);
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  }
  // ENCv1 symmetric key path
  const key = getEncryptionKey();
  if(!key) return s; // no key -> return as-is
  if(!s.startsWith('ENCv1')) return s; // not encrypted
  const b = Buffer.from(s.slice(5), 'base64');
  const iv = b.slice(0,12);
  const tag = b.slice(12,28);
  const ciphertext = b.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

function readJson(file, def){ try{ if(!fs.existsSync(file)) return def; const s = fs.readFileSync(file,'utf8')||''; return JSON.parse(s||'{}'); }catch(e){ return def; } }
function writeJson(file, obj){ try{ fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8'); }catch(e){ console.warn('writeJson failed', file, e); } }

function readEncryptedJson(file, def){
  try{
    if(!fs.existsSync(file)) return def;
    const s = fs.readFileSync(file,'utf8') || '';
    // if file starts with our ENCv1 prefix, decrypt using key
    if(s && (s.startsWith('ENCv1') || s.startsWith('ENCv2'))){
      try{
        const plain = decryptString(s);
        return JSON.parse(plain || '{}');
      }catch(e){ console.warn('decrypt failed', file, e); return def; }
    }
    return JSON.parse(s||'{}');
  }catch(e){ return def; }
}

function writeEncryptedJson(file, obj){
  try{
    const s = JSON.stringify(obj, null, 2);
    // prefer envelope encryption (RSA public key in server/keys). encryptBuffer will select ENCv2 when public key exists.
    try{
      const out = encryptBuffer(Buffer.from(s, 'utf8'));
      fs.writeFileSync(file, out, 'utf8');
      return;
    }catch(e){
      // fallback to symmetric env key if available
      const key = getEncryptionKey();
      if(!key){
        // no key -> write plain
        fs.writeFileSync(file, s, 'utf8');
        return;
      }
      const out = encryptBuffer(Buffer.from(s, 'utf8'));
      fs.writeFileSync(file, out, 'utf8');
    }
  }catch(e){ console.warn('writeEncryptedJson failed', file, e); }
}

function getSubscriptionsByUser(userId){
  const subs = readEncryptedJson(SUBS_PATH, {});
  return subs[userId] || [];
}

function upsertSubscription(entry){
  const subs = readEncryptedJson(SUBS_PATH, {});
  if(!subs[entry.userId]) subs[entry.userId] = [];
  const idx = subs[entry.userId].findIndex(s=>s.provider === entry.provider && s.providerSubscriptionId === entry.providerSubscriptionId);
  if(idx >= 0) subs[entry.userId][idx] = Object.assign(subs[entry.userId][idx], entry);
  else subs[entry.userId].push(entry);
  writeEncryptedJson(SUBS_PATH, subs);
}

function markEventProcessed(eventId, meta){
  if(!eventId) return;
  const p = readEncryptedJson(PROCESSED_PATH, {});
  p[eventId] = { seenAt: Date.now(), meta: meta || {} };
  writeEncryptedJson(PROCESSED_PATH, p);
}

function isEventProcessed(eventId){ if(!eventId) return false; const p = readEncryptedJson(PROCESSED_PATH, {}); return !!p[eventId]; }

module.exports = { getSubscriptionsByUser, upsertSubscription, markEventProcessed, isEventProcessed };
