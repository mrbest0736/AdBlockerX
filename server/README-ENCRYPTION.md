# Server encryption and sensitive files

This document explains the repository's on-disk encryption options for `server/subscriptions.json` and `server/processed_events.json`, identifies sensitive files, and provides step-by-step guidance for using symmetric, envelope, and post-quantum encryption modes (ENCv1 / ENCv2 / ENCv3). It also includes migration steps and practical PowerShell commands for local testing.

---

## Sensitive files in this repo

Treat these files as secrets. Do not commit real secret values into the repository.

- `server/keys/private.pem` — RSA private key (if used). Highly sensitive.
- `server/keys/pqc_private.bin` — (future) private key for PQC KEM — highly sensitive.
- `.env` — local environment file (should be gitignored). May contain `SUBS_ENCRYPTION_KEY`, `LICENSING_JWT_SECRET`, Stripe secret keys, etc.
- `server/subscriptions.json` and `server/processed_events.json` — persistent data; may contain PII (email addresses) and should be encrypted at rest.
- Any backup files or export CSVs that include subscription rows (e.g., `/admin/export`) — treat as sensitive.

---

## Supported on-disk formats and how they're used

### ENCv1 — Symmetric AES-256-GCM (backward compatible)

- Key: derived by `SHA-256(SUBS_ENCRYPTION_KEY)` where `SUBS_ENCRYPTION_KEY` (or `SUBS_ENC_KEY`) is an environment variable.
- When `SUBS_ENCRYPTION_KEY` is set and there is no wrapping public key present, files are written in ENCv1 format.
- File format (ASCII): `ENCv1` + base64(iv | tag | ciphertext)

Pros: simple to use, no key files required.
Cons: symmetric key must be distributed/rotated securely.

### ENCv2 — Envelope encryption (RSA-OAEP wrapping + AES-256-GCM)

- When `server/keys/public.pem` exists, the server writes ENCv2 files.
- Each write generates a random AES-256 data key; the payload is encrypted with AES-GCM; the AES key is wrapped with the RSA public key using OAEP.
- File format (ASCII): `ENCv2` + base64(wrappedKey | iv | tag | ciphertext)
- Current code assumes RSA-4096 (wrapped key length 512 bytes). If you use a different RSA size, please ask and I can add a small length header.

Pros: separation of data encryption key from wrapping key; easier key rotation; private key can be stored in an HSM or cloud KMS.
Cons: RSA is not quantum-resistant.

### ENCv3 — Post-quantum envelope (planned)

- ENCv3 would replace RSA-OAEP with a PQC KEM (e.g., Kyber) to encapsulate the AES data key.
- File format suggestion: `ENCv3` + base64(kemEncapsulation | iv | tag | ciphertext)
- Requires a PQC KEM library/binding (native) or a cloud KMS that offers PQC key material.

Pros: post-quantum secure key encapsulation.
Cons: requires native bindings or provider support and careful testing.

---

## Quick start (PowerShell examples)

1. Symmetric (ENCv1)

```powershell
# temporary for dev/test only
$env:SUBS_ENCRYPTION_KEY = 'dev-passphrase-change-me'
node server/add_sub.js   # or run the server
```

2.Envelope (ENCv2) — generate RSA keys and use them

```powershell
# generate RSA-4096 keys (creates server/keys/private.pem and public.pem)
node server/generate_rsa_keys.js

# verify keys exist
ls server\keys

# run a small test that writes and reads encrypted files
node server/add_sub.js
```

Notes: `server/add_sub.js` is a dev helper that calls the DB upsert API and will cause the code to write `server/subscriptions.json` in the active encryption mode.

---

## Migration (re-encrypt existing files)

If you have existing plain or ENCv1 files and want to move to ENCv2:

1. BACKUP your files (always). Example:

```powershell
copy server\subscriptions.json server\subscriptions.json.bak
copy server\processed_events.json server\processed_events.json.bak
```

2.Generate or put your new wrapping key pair in `server/keys/public.pem` and `server/keys/private.pem` (private protected).

3.Run a migration helper script (I can add `scripts/recrypt.js` for you). The helper will:

detect existing file format (plain / ENCv1 / ENCv2)
decrypt using available credentials (env key or private.pem)
re-encrypt using the public key as ENCv2

If you want the migration helper now, I can add it and run it locally (or provide command examples for you to run).

---

## Key rotation

- When rotating wrapping keys, create the new key pair and re-encrypt files using the new public key.
- Keep old private key available during the migration until all files are re-encrypted.
- After successful migration and verification, securely delete the old private key.

---

## Post-quantum (PQC) options — practical approaches

Option A: Use a cloud KMS that supports PQC key material

- Offload wrapping/unwrapping to the cloud provider.
- You get key protection, rotation, and audit; check provider docs for PQC availability.

Option B: Use a native PQC KEM binding locally (e.g., liboqs Kyber)

- Install a Node binding that provides KEM primitives (native install required).
- Implement ENCv3 which stores the KEM encapsulation alongside AES-GCM payload.
- I added `server/generate_pqc_keys.js` as a stub that checks for PQC bindings; it prints instructions when none are available.

I can help implement ENCv3 once you pick a provider or a native binding.

---

## Implementation notes & limitations

- The code currently parses ENCv2 using a fixed wrapped-key length assumption (512 bytes for RSA-4096). If you need multiple RSA sizes supported, I will add a length header to the file format.
- ENCv2 read requires `server/keys/private.pem`. If private key is not present the code throws a clear error.
- The repository now ignores `server/keys/` in `.gitignore`. Keep keys out of the repo.

---

## Next steps I can take for you

Choose one and I will implement it:

1. Add `scripts/recrypt.js` and run it locally against a backup to convert plain/ENCv1 files to ENCv2.
2. Update ENCv2 format to include a short prefix that indicates wrapped-key length so variable RSA sizes are supported.
3. Implement ENCv3 PQC envelope using a chosen PQC binding (you'll need to accept installing native deps) or by wiring a cloud KMS.

---

If you'd like me to proceed with one of the next steps, tell me which and I'll implement it and run a local test (generate keys, re-encrypt a sample file, and verify).
