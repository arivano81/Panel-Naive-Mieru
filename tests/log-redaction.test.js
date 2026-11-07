#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { redactLogText, redactLogArgument, installConsoleRedaction } =
  require('../panel/server/logRedaction');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'panel/server/index.js'), 'utf8');
const install = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const e2e = fs.readFileSync(path.join(root, 'tests/e2e.sh'), 'utf8');
let passed = 0;
let failed = 0;
function ok(value, message) {
  if (value) { passed++; console.log('  ✓', message); }
  else { failed++; console.error('  ✗', message); }
}

console.log('Sensitive log redaction regression test');
const uuid = '550e8400-e29b-41d4-a716-446655440000';
const token = '0123456789abcdef0123456789abcdef';
const sample = redactLogText(
  `GET /sub/${token}?password=hunter2&privateKey=base64secret ` +
  `Bearer eyJ.secret.signature vless://${uuid}@vpn.example naive+https://alice:p%40ss@vpn.example`);
for (const secret of [uuid, token, 'hunter2', 'base64secret', 'eyJ.secret.signature', 'p%40ss']) {
  ok(!sample.includes(secret), `redacts ${secret === uuid ? 'UUID' : 'secret material'} from text`);
}
ok(sample.includes('[REDACTED_UUID]') && sample.includes('[REDACTED_TOKEN]'),
  'retains useful typed placeholders');

const structured = redactLogArgument({ password: 'one', nested: { vlessUuid: uuid }, safe: 'kept' });
ok(structured.password === '[REDACTED]' && structured.nested.vlessUuid === '[REDACTED]' && structured.safe === 'kept',
  'structured console arguments redact sensitive keys while retaining context');
const captured = [];
const fakeConsole = { log: (...args) => captured.push(args), warn() {}, error() {}, info() {}, debug() {} };
installConsoleRedaction(fakeConsole);
fakeConsole.log(`token=${token}`, { privateKey: 'do-not-print' });
ok(!JSON.stringify(captured).includes(token) && !JSON.stringify(captured).includes('do-not-print'),
  'console wrapper redacts every argument before writing');

ok(server.includes('installConsoleRedaction();') &&
   server.includes('fs.appendFileSync(LOG_PANEL, redactLogText(m))'),
  'runtime console and Morgan access log both use centralized redaction');
ok(install.includes('exec 3>&1') && install.includes('print_banner >&3') &&
   install.includes('secret_info()'),
  'installer secrets bypass the persistent tee log');
ok(!e2e.includes('(?<=Generated password: )') &&
   e2e.includes('/root/vertaflux-install-report.txt'),
  'E2E recovery no longer depends on leaked log credentials');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
