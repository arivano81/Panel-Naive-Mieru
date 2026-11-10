'use strict';

const crypto = require('crypto');

const ENCRYPTED_BACKUP_FORMAT = 'vertaflux-backup-encrypted';
const LEGACY_ENCRYPTED_BACKUP_FORMAT = 'rixxx-panel-backup-encrypted';
const ENCRYPTED_BACKUP_SCHEMA = 1;
// Base64 adds roughly one third; keep the envelope below Express' 25 MiB JSON
// limit even at the maximum accepted plaintext size.
const MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
const SCRYPT_PARAMS = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const aadFor = format => Buffer.from(`${format}:${ENCRYPTED_BACKUP_SCHEMA}`, 'utf8');

function requirePassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024)
    throw new Error('Backup passphrase must contain 12 to 1024 characters');
}

function decodeBase64(value, name, expectedLength) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    throw new Error(`Encrypted backup has an invalid ${name}`);
  const decoded = Buffer.from(value, 'base64');
  if (expectedLength && decoded.length !== expectedLength)
    throw new Error(`Encrypted backup has an invalid ${name} length`);
  if (decoded.toString('base64') !== value)
    throw new Error(`Encrypted backup has a non-canonical ${name}`);
  return decoded;
}

function encryptBackup(backup, passphrase, randomBytes = crypto.randomBytes) {
  requirePassphrase(passphrase);
  const plaintext = Buffer.from(JSON.stringify(backup), 'utf8');
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('Backup is too large to encrypt');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT_PARAMS);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadFor(ENCRYPTED_BACKUP_FORMAT));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: ENCRYPTED_BACKUP_FORMAT,
    schema: ENCRYPTED_BACKUP_SCHEMA,
    kdf: { name: 'scrypt', N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, salt: salt.toString('base64') },
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptBackup(envelope, passphrase) {
  requirePassphrase(passphrase);
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      ![ENCRYPTED_BACKUP_FORMAT, LEGACY_ENCRYPTED_BACKUP_FORMAT].includes(envelope.format) ||
      envelope.schema !== ENCRYPTED_BACKUP_SCHEMA)
    throw new Error('Not a supported encrypted panel backup');
  const kdf = envelope.kdf;
  const cipherInfo = envelope.cipher;
  if (!kdf || kdf.name !== 'scrypt' || kdf.N !== SCRYPT_PARAMS.N ||
      kdf.r !== SCRYPT_PARAMS.r || kdf.p !== SCRYPT_PARAMS.p)
    throw new Error('Encrypted backup uses unsupported KDF parameters');
  if (!cipherInfo || cipherInfo.name !== 'aes-256-gcm')
    throw new Error('Encrypted backup uses an unsupported cipher');
  const salt = decodeBase64(kdf.salt, 'salt', 16);
  const iv = decodeBase64(cipherInfo.iv, 'IV', 12);
  const tag = decodeBase64(cipherInfo.tag, 'authentication tag', 16);
  const ciphertext = decodeBase64(envelope.ciphertext, 'ciphertext');
  if (!ciphertext.length || ciphertext.length > MAX_PLAINTEXT_BYTES)
    throw new Error('Encrypted backup payload size is invalid');
  try {
    const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT_PARAMS);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aadFor(envelope.format));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new Error('Backup passphrase is incorrect or the encrypted file was modified');
  }
}

module.exports = {
  ENCRYPTED_BACKUP_FORMAT, LEGACY_ENCRYPTED_BACKUP_FORMAT, ENCRYPTED_BACKUP_SCHEMA, MAX_PLAINTEXT_BYTES,
  encryptBackup, decryptBackup,
};
