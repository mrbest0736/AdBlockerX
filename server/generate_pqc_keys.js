const fs = require('fs');
const path = require('path');

console.log('PQC key generation helper');
console.log('This script attempts to use a local PQC library (liboqs bindings) to generate a KEM keypair.');
console.log('If you do not have a PQC binding installed, this script will print instructions.');

function checkModules(){
  const candidates = ['liboqs','oqs','node-liboqs','pqcrypto'];
  for(const c of candidates){
    try{ require.resolve(c); return c; }catch(e){}
  }
  return null;
}

const mod = checkModules();
if(!mod){
  console.error('No PQC bindings found in Node. To enable post-quantum KEM (e.g., Kyber), install a native binding such as the OQS Node bindings.');
  console.error('Example (Linux/macOS):');
  console.error('  npm install liboqs');
  console.error('Or follow the project-specific installation instructions for your chosen package.');
  process.exit(2);
}

console.log('Found PQC module:', mod);
console.log('Please implement key generation using the module APIs. This helper is a stub because bindings vary by package.');
console.log('Once you have a PQC keypair, place the public key as server/keys/pqc_public.bin and private key as server/keys/pqc_private.bin (protect the private key).');
