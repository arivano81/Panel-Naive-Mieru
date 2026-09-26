#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { encodeBase32, decodeBase32, generateSecret, hotp, verifyTotp, otpauthUrl } = require('../panel/server/totp');
let passed = 0, failed = 0;
function ok(value, message) {
  if (value) { passed++; console.log('  ✓', message); }
  else { failed++; console.error('  ✗', message); }
}

console.log('Optional administrator TOTP regression test');
const raw = Buffer.from('12345678901234567890');
const secret = encodeBase32(raw);
ok(decodeBase32(secret).equals(raw), 'base32 secret encoding round-trips');
ok(hotp(secret, 1) === '287082', 'HOTP matches the RFC 4226 counter-1 vector');
ok(verifyTotp(secret, '287082', { now: 59000, window: 0 }) === 1,
  'TOTP validates the RFC time-step vector');
ok(verifyTotp(secret, '287082', { now: 59000, window: 0, lastCounter: 1 }) === null,
  'an already accepted login time-step cannot be replayed');
ok(verifyTotp(secret, '000000', { now: 59000, window: 1 }) === null,
  'wrong codes are rejected across the allowed clock window');
ok(verifyTotp('corrupt!', '123456') === null, 'a corrupt stored secret fails closed without throwing');
const generated = generateSecret(n => Buffer.alloc(n, 0xab));
ok(/^[A-Z2-7]{32}$/.test(generated), 'generated secrets contain 160 bits in canonical base32');
const uri = otpauthUrl({ secret: generated, account: 'admin@example.com' });
ok(uri.startsWith('otpauth://totp/') && uri.includes('secret=') && uri.includes('period=30'),
  'provisioning URI declares standard SHA1 six-digit 30-second TOTP');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'panel/server/index.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'panel/public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'panel/public/index.html'), 'utf8');
const recovery = fs.readFileSync(path.join(root, 'panel/scripts/recover_access.sh'), 'utf8');
ok(server.includes("app.post('/api/totp/setup', requireAuth") &&
   server.includes("app.post('/api/totp/enable', requireAuth") &&
   server.includes("app.post('/api/totp/disable', requireAuth"),
  'setup, confirmation and disable routes are authenticated and CSRF-covered');
ok(server.includes('const totpLimiter = rateLimit') &&
   (server.match(/requireAuth, totpLimiter/g) || []).length === 3,
  'all TOTP lifecycle mutations have a dedicated attempt limiter');
ok(server.includes('pendingTotpSecret') && server.includes("res.set('Cache-Control', 'no-store')"),
  'unconfirmed secret stays in the session and setup responses disable caching');
ok(server.includes('totpLastCounter') && server.includes("code: 'TOTP_REQUIRED'"),
  'login requires the optional factor and persists replay protection');
ok(/totpSecret, totpLastCounter, \.\.\.safe/.test(server),
  'configuration APIs omit the secret and replay counter');
ok(html.includes('id="login-totp-group"') && html.includes('id="card-totp"') &&
   ui.includes("case 'totp-enable'") && ui.includes("case 'totp-disable'"),
  'login and settings UI expose the complete opt-in lifecycle');
ok(recovery.includes('cfg.totpEnabled = false') && recovery.includes('X-CSRF-Token: $CSRF_TOKEN'),
  'root-only access recovery disables a lost factor and remains CSRF-compatible');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
