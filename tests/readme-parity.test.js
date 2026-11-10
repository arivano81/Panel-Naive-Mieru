#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const ru = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const en = fs.readFileSync(path.join(root, 'README.en.md'), 'utf8');

const stableTopics = [
  ['TOTP', /TOTP/i], ['audit', /Audit/i], ['maintenance', /Maintenance mode/i],
  ['operation backups', /backups\/operations/], ['encrypted backup', /AES-256-GCM/],
  ['VLESS REALITY', /VLESS REALITY/], ['VLESS XHTTP', /XHTTP/],
  ['OpenFlux isolation', /OpenFlux[\s\S]{0,300}isolat/i], ['federation', /Federation/i],
  ['DNS and TLS diagnostics', /DNS and TLS/], ['client matrix', /compatibility matrix/i],
  ['panel-only update', /--panel-only/], ['doctor', /--doctor/], ['rollback', /--rollback/],
  ['supply chain', /supply-chain\.md/], ['access recovery', /recover_access\.sh/],
];
for (const [topic, pattern] of stableTopics) assert(pattern.test(en), `English README covers ${topic}`);
for (const token of ['TOTP', 'VLESS', 'OpenFlux', '--panel-only', '--doctor', '--rollback'])
  assert(ru.includes(token) && en.includes(token), `${token} remains documented in both languages`);
assert(/Режим обслуживания/.test(ru) && /Maintenance mode/i.test(en),
  'maintenance mode remains documented in both languages');
assert(!/Installed \*\*out of the box\*\*/.test(en),
  'English README does not claim that opt-in Hysteria2 is installed automatically');
console.log('Bilingual README feature parity regression test passed');
