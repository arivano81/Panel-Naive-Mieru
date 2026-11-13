#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'panel/public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'panel/public/app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'panel/server/index.js'), 'utf8');

assert(html.includes('data-page="clients"') && html.includes('id="page-clients"') &&
  app.includes("clients:     t('nav.clients')"), 'panel exposes the client compatibility section');
for (const client of ['Karing', 'Shadowrocket', 'sing-box', 'NekoBox', 'Xray', 'Mihomo', 'OpenFlux'])
  assert(html.includes(client), `${client} is classified in the matrix`);
assert(html.includes('E2E') && html.includes('FORMAT') && html.includes('ISOLATED'),
  'matrix distinguishes tunnel, format-only and isolated-profile evidence');
assert(/forced === 'karing'[\s\S]*forced === 'nekobox'[\s\S]*forced === 'exclave'[\s\S]*forced === 'throne'/.test(server),
  'sing-box-family compatibility matches the actual subscription router');
assert(server.includes("return 'shadowrocket'") && server.includes("return 'karing'"),
  'both emitted subscription formats remain wired');
console.log('Client compatibility matrix regression test passed');
