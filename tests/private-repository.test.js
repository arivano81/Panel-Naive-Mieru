#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const install = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const update = fs.readFileSync(path.join(root, 'update.sh'), 'utf8');
const html = fs.readFileSync(path.join(root, 'panel/public/index.html'), 'utf8');
let passed = 0, failed = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); passed++; }
  else { console.error('  ✗', message); failed++; }
}

console.log('Private fork source regression test');
for (const [name, source] of [['install.sh', install], ['update.sh', update]]) {
  ok(source.includes('github.com/arivano81/Panel-Naive-Mieru'), `${name} targets this fork`);
  ok(!source.includes('github.com/cwash797-cmd'), `${name} cannot replace the fork with parent code`);
  ok(source.includes('PANEL_GITHUB_TOKEN'), `${name} supports a read-only private-repo token`);
}
ok(update.includes('curl -H @-'), 'updater keeps the curl authorization header out of argv');
ok(html.includes('github.com/arivano81/Panel-Naive-Mieru'), 'panel GitHub links point to this fork');
ok(!html.includes('github.com/cwash797-cmd'), 'panel has no duplicate parent-project link');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
