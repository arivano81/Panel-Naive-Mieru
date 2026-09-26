#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const policy = fs.readFileSync(path.join(root, 'SECURITY.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
let passed = 0;
let failed = 0;
function ok(value, message) {
  if (value) { passed++; console.log('  ✓', message); }
  else { failed++; console.error('  ✗', message); }
}

console.log('Security policy regression test');
ok(/Security → Advisories → Report a vulnerability/.test(policy),
  'private vulnerability reporting channel is explicit');
ok(/Do not publish[\s\S]*credentials[\s\S]*private keys/i.test(policy),
  'public secret disclosure is explicitly prohibited');
ok(/Restrict panel access to SSH\/loopback/.test(policy) && /Rotate the panel password/.test(policy),
  'administrator containment and credential rotation are actionable');
ok(/never silently reuse or replace the same version tag/.test(policy),
  'revocation cannot silently replace a compromised release');
ok(/remove downloadable artifacts/.test(policy) && /new version with new checksums/.test(policy),
  'release revocation covers artifacts and replacement checksums');
ok(readme.includes('[SECURITY.md](SECURITY.md)'), 'README exposes the security policy');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
