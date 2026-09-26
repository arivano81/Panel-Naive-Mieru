#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'panel/package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'panel/package-lock.json'), 'utf8'));
const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
let passed = 0;
let failed = 0;
function ok(value, message) {
  if (value) { passed++; console.log('  ✓', message); }
  else { failed++; console.error('  ✗', message); }
}

console.log('Production dependency security regression test');
ok(/^\^?11\.1\.1$/.test(pkg.dependencies.uuid), 'direct uuid dependency includes the advisory fix');
ok(/^\^?4\.6\.0$/.test(pkg.dependencies['node-cron']), 'node-cron no longer pulls its vulnerable uuid copy');
ok(lock.packages['node_modules/uuid']?.version === '11.1.1', 'lockfile pins the reviewed uuid release');
ok(lock.packages['node_modules/node-cron']?.version === '4.6.0', 'lockfile pins the reviewed node-cron release');
ok(!lock.packages['node_modules/node-cron/node_modules/uuid'], 'vulnerable nested uuid is absent');
ok(ci.includes('npm audit --omit=dev --audit-level=moderate'),
  'CI blocks moderate and higher production advisories');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
