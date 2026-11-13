#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const ru = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const en = fs.readFileSync(path.join(root, 'README.en.md'), 'utf8');

function headingSlug(value) {
  return value.replace(/<[^>]+>/g, '').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}_ \-]/gu, '').replace(/ /g, '-');
}
function verifyLocalLinks(name, source) {
  const headings = new Set([...source.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => headingSlug(m[1])));
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (/^https?:/.test(link)) continue;
    const [relative, anchor] = link.split('#');
    assert(!relative || fs.existsSync(path.join(root, relative)), `${name} local link exists: ${relative}`);
    assert(relative || !anchor || headings.has(decodeURIComponent(anchor)),
      `${name} heading exists: #${anchor}`);
  }
}

const stableTopics = [
  ['TOTP', /TOTP/i], ['audit', /Audit/i], ['maintenance', /Maintenance mode/i],
  ['operation backups', /backups\/operations/], ['encrypted backup', /AES-256-GCM/],
  ['VLESS REALITY', /VLESS REALITY/], ['VLESS XHTTP', /XHTTP/],
  ['OpenFlux isolation', /OpenFlux[\s\S]{0,300}isolat/i], ['federation', /Federation/i],
  ['DNS and TLS diagnostics', /DNS and TLS/], ['client matrix', /compatibility matrix/i],
  ['panel-only update', /--panel-only/], ['doctor', /--doctor/], ['rollback', /--rollback/],
  ['supply chain', /supply-chain\.md/], ['access recovery', /recover_access\.sh/],
  ['per-user connection check', /Client connection check/],
];
for (const [topic, pattern] of stableTopics) assert(pattern.test(en), `English README covers ${topic}`);
for (const token of ['TOTP', 'VLESS', 'OpenFlux', '--panel-only', '--doctor', '--rollback'])
  assert(ru.includes(token) && en.includes(token), `${token} remains documented in both languages`);
assert(/Режим обслуживания/.test(ru) && /Maintenance mode/i.test(en),
  'maintenance mode remains documented in both languages');
assert(!/Installed \*\*out of the box\*\*/.test(en),
  'English README does not claim that opt-in Hysteria2 is installed automatically');
assert(!/Experimental OpenFlux|Экспериментальный OpenFlux/.test(ru + en),
  'OpenFlux is documented as an isolated working component, not a test attachment');
assert(/### 3\.1 [^\n]+[\s\S]*### 3\.2 [^\n]+[\s\S]*### 3\.3 [^\n]+[\s\S]*### 3\.4 [^\n]+[\s\S]*### 3\.5 [^\n]+[\s\S]*### 3\.6 [^\n]+/.test(ru),
  'Russian operations guide has a continuous protocol subsection sequence');
assert(!/^#{2,4} .*\bv\d+\.\d+/mi.test(ru + en),
  'README headings describe current tasks instead of historical release fragments');
verifyLocalLinks('Russian README', ru);
verifyLocalLinks('English README', en);
console.log('Bilingual README feature parity regression test passed');
