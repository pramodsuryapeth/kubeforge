const express = require('express');
const { storeCredential, listCredentialRefs } = require('../services/cryptoVault');

const router = express.Router();

// GET /api/vault/credentials — refs + usernames only, never secrets
router.get('/', async (req, res, next) => {
  try {
    const credentials = await listCredentialRefs();
    res.json({ credentials });
  } catch (err) {
    next(err);
  }
});

// POST /api/vault/credentials — register/overwrite a credential
router.post('/', async (req, res, next) => {
  try {
    const { ref, username, authType, secret, passphrase } = req.body || {};
    if (!ref || !username || !authType || !secret) {
      return res.status(400).json({ error: 'ref, username, authType and secret are all required' });
    }
    if (!['password', 'ssh-key'].includes(authType)) {
      return res.status(400).json({ error: 'authType must be "password" or "ssh-key"' });
    }

    await storeCredential(ref, { username, authType, secret, passphrase });
    res.status(201).json({ ref, username, authType }); // secret is never echoed back
  } catch (err) {
    if (err.message.includes('CREDENTIAL_ENCRYPTION_KEY')) {
      return res.status(500).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
