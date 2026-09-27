#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../panel/scripts/warp_egress.sh'), 'utf8');
let passed = 0;
let failed = 0;
function ok(value, message) {
  if (value) { passed++; console.log('  ✓', message); }
  else { failed++; console.error('  ✗', message); }
}

console.log('WARP dependency supply-chain regression test');
ok(source.includes('WGCF_VERSION="2.3.0"'), 'wgcf release is pinned');
ok(source.includes('01614e38c0eb5f3405232e71cfaf02d64d4809e4988ad8f5a8071af16d193405'),
  'amd64 checksum from the official release is pinned');
ok(source.includes('dcadadc42bcc410a4032a6d1c0490ea510e199f0aaaee397dc1aa0fbd27038e8') &&
   source.includes('903d18ed2a17c78652fa9b73c0a90e94f30e98c007f8db04b95c76941f9d73bf'),
  'supported ARM checksums are pinned');
ok(!source.includes('releases/latest'), 'installer never falls back to an unreviewed latest asset');
const checksumAt = source.indexOf('actual="$(sha256sum');
const installAt = source.indexOf('install -m 0755 "$tmp" /usr/local/bin/wgcf');
ok(checksumAt > 0 && checksumAt < installAt, 'checksum is verified before installation');
ok(source.includes('unsupported architecture for wgcf'), 'unknown architectures fail closed');
ok(source.includes('wgcf SHA-256 mismatch'), 'checksum mismatch has an explicit hard failure');
ok(/log "healthcheck OK[^\n]+" >&2\s*\n\s*echo "\$ip"/.test(source),
  'healthcheck keeps captured stdout to the machine-readable IP only');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
