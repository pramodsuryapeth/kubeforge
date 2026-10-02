/**
 * Real encrypted secrets store (AES-256-GCM), backed by MongoDB via the
 * Credential model. This is what the "VAULT SERVICE" block in the
 * architecture doc maps to: nothing outside this module ever sees a
 * plaintext secret, secrets are decrypted just-in-time for the single SSH
 * connection attempt that needs them, and the Credential model's own
 * toJSON() strips the encrypted blob as a backstop even if it were ever
 * accidentally serialized.
 *
 * Swap this module for a real HashiCorp Vault / AWS Secrets Manager client
 * if you'd rather not manage the encryption key yourself — getCredential()
 * and storeCredential() are the only functions the rest of the app calls.
 */
const crypto = require('crypto');
const Credential = require('../models/Credential');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is not set. Generate one with `npm run generate-key` and put it in backend/.env',
    );
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return key;
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

function decrypt(blob) {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(blob.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(blob.authTag, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Stores (or overwrites) a credential under `ref`. `secret` is a password
 * or a full PEM private key depending on authType; `passphrase` is only
 * used for a passphrase-protected private key.
 */
async function storeCredential(ref, { username, authType, secret, passphrase }) {
  const encrypted = {
    ref,
    username,
    authType,
    secret: encrypt(secret),
    passphrase: passphrase ? encrypt(passphrase) : null,
  };
  await Credential.findOneAndUpdate({ ref }, encrypted, { upsert: true, new: true, setDefaultsOnInsert: true });
}

/** Just-in-time retrieval — decrypts only for the duration of the caller's use. */
async function getCredential(ref) {
  const doc = await Credential.findOne({ ref });
  if (!doc) return null;
  return {
    username: doc.username,
    authType: doc.authType,
    secret: decrypt(doc.secret),
    passphrase: doc.passphrase ? decrypt(doc.passphrase) : null,
  };
}

async function credentialExists(ref) {
  return Boolean(await Credential.exists({ ref }));
}

/** Safe for API responses — usernames and refs only, never secrets. */
async function listCredentialRefs() {
  const docs = await Credential.find({}).sort({ createdAt: -1 });
  return docs.map((d) => ({ ref: d.ref, username: d.username, authType: d.authType, createdAt: d.createdAt }));
}

module.exports = { storeCredential, getCredential, credentialExists, listCredentialRefs };
