#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'panel/server/index.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'panel/public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'panel/public/app.js'), 'utf8');

const checks = [
  [server, /allowLoopbackIP:\s*!!u\.mieruAllowLoopbackIP/, 'Mita receives per-user allowLoopbackIP'],
  [server, /allowPrivateIP:\s*!!u\.mieruAllowPrivateIP/, 'Mita receives per-user allowPrivateIP'],
  [html, /id="u-mieru-loopback"/, 'user form exposes loopback permission'],
  [html, /id="u-mieru-private"/, 'user form exposes private-network permission'],
  [app, /mieruAllowLoopbackIP:\s*el\('u-mieru-loopback'\)\.checked/, 'form submits loopback permission'],
  [app, /mieruAllowPrivateIP:\s*el\('u-mieru-private'\)\.checked/, 'form submits private-network permission'],
];

let failed = 0;
for (const [source, pattern, label] of checks) {
  const ok = pattern.test(source);
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
