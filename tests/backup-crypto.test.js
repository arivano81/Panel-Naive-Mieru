#!/usr/bin/env node
'use strict';

const {
  ENCRYPTED_BACKUP_FORMAT, encryptBackup, decryptBackup,
} = require('../panel/server/backupCrypto');

let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}
function rejects(fn, pattern, message) {
  try { fn(); ok(false, message); }
  catch (error) { ok(pattern.test(error.message), message); }
}

console.log('Encrypted backup regression test');
const backup = {
  format: 'rixxx-panel-backup', schema: 4,
  config: { domain: 'vpn.example', adminPassHash: 'secret-hash' },
  users: [{ id: 'u1', username: 'alice', passHash: 'hash', password: 'client-secret' }],
};
let randomOffset = 0;
const deterministicRandom = size => {
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i++) out[i] = (randomOffset + i) & 0xff;
  randomOffset += size;
  return out;
};
const envelope = encryptBackup(backup, 'correct horse battery staple', deterministicRandom);
ok(envelope.format === ENCRYPTED_BACKUP_FORMAT && envelope.schema === 1,
  'encrypted envelope is explicitly versioned');
ok(!JSON.stringify(envelope).includes('client-secret') && !JSON.stringify(envelope).includes('secret-hash'),
  'plaintext user and administrator secrets are absent from the file');
ok(JSON.stringify(decryptBackup(envelope, 'correct horse battery staple')) === JSON.stringify(backup),
  'AES-256-GCM round-trip preserves the complete backup');
rejects(() => decryptBackup(envelope, 'this is the wrong passphrase'), /incorrect|modified/,
  'wrong passphrase is rejected before restore');

const tampered = JSON.parse(JSON.stringify(envelope));
const bytes = Buffer.from(tampered.ciphertext, 'base64');
bytes[0] ^= 1;
tampered.ciphertext = bytes.toString('base64');
rejects(() => decryptBackup(tampered, 'correct horse battery staple'), /incorrect|modified/,
  'authenticated encryption rejects modified ciphertext');
const weakerKdf = JSON.parse(JSON.stringify(envelope));
weakerKdf.kdf.N = 1024;
rejects(() => decryptBackup(weakerKdf, 'correct horse battery staple'), /unsupported KDF/,
  'attacker-controlled KDF downgrade is rejected');
rejects(() => encryptBackup(backup, 'too-short'), /12 to 1024/,
  'short encryption passphrases are rejected');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
