const mongoose = require('mongoose');

const EncryptedBlobSchema = new mongoose.Schema({
  ciphertext: { type: String, required: true },
  iv: { type: String, required: true },
  authTag: { type: String, required: true },
}, { _id: false });

const CredentialSchema = new mongoose.Schema(
  {
    ref: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    authType: { type: String, enum: ['password', 'ssh-key'], required: true },
    secret: { type: EncryptedBlobSchema, required: true },
    passphrase: { type: EncryptedBlobSchema, default: null },
  },
  { timestamps: true },
);

// Never let the encrypted blob leak into an API response even by accident —
// callers should use cryptoVault.listCredentialRefs() for listings, but this
// is a hard backstop at the model level.
CredentialSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.secret;
    delete ret.passphrase;
    return ret;
  },
});

module.exports = mongoose.model('Credential', CredentialSchema);
