const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const outDir = path.join(__dirname, 'keys');
if(!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log('Generating RSA-4096 key pair into', outDir);
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

fs.writeFileSync(path.join(outDir, 'private.pem'), privateKey, { mode: 0o600 });
fs.writeFileSync(path.join(outDir, 'public.pem'), publicKey, { mode: 0o644 });

console.log('Keys written: private.pem (600), public.pem (644)');
console.log('WARNING: keep private.pem secure. Consider encrypting it with SUBS_ENCRYPTION_KEY or store in a secrets manager.');
