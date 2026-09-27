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
ok(source.includes('WGCF_VERSION="2.2.22"'), 'wgcf release is pinned');
ok(source.includes('268d187e649870b603ad2e5c1b74a696251f6c2f6f075c726a174a0039b0b1e2'),
  'amd64 checksum from the official release is pinned');
ok(source.includes('e5ff08d3aae5374935211053b2d64d96daaa3f1aec8e9a1dab7418125585a011') &&
   source.includes('bd40e55dae299acfa20446973ff4fc5a9a116ecaa41431aeff5f86034391f900'),
  'supported ARM checksums are pinned');
ok(!source.includes('releases/latest'), 'installer never falls back to an unreviewed latest asset');
const checksumAt = source.indexOf('actual="$(sha256sum');
const installAt = source.indexOf('install -m 0755 "$tmp" /usr/local/bin/wgcf');
ok(checksumAt > 0 && checksumAt < installAt, 'checksum is verified before installation');
ok(source.includes('unsupported architecture for wgcf'), 'unknown architectures fail closed');
ok(source.includes('wgcf SHA-256 mismatch'), 'checksum mismatch has an explicit hard failure');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
