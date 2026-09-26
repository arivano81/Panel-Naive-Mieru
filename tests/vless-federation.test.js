#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (value, message) => {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
};

console.log('VLESS federation regression test');
const provision = source.slice(source.indexOf("app.post('/api/federation/provision'"),
  source.indexOf('// ── v1.11.0 (PR-3c): POST /api/federation/deprovision'));
const fetch = source.slice(source.indexOf("app.post('/api/federation/fetch'"),
  source.indexOf('// ── v1.10.0 (PR-3b): POST /api/federation/provision'));
const broadcast = source.slice(source.indexOf('async function broadcastProvision(user)'),
  source.indexOf('// ── v1.11.0 (PR-3c): broadcastDeprovision'));

ok(source.includes("const VALID_PROTOCOLS = ['naive', 'mieru', 'hy2', 'vless']"),
  'VLESS is accepted by the federation protocol allowlist');
ok(/v\.protocols\.includes\('vless'\)/.test(provision) && /xrayInstalled\(\)/.test(provision),
  'node checks its real Xray capability before accepting VLESS');
ok(/status\(409\).*unsupportedProtocols:[\s\S]*?'vless'/s.test(provision),
  'node returns an explicit VLESS capability conflict');
ok(/createUserAtomic\(user\)/.test(provision) && /applyAllConfigsAsync\(\)/.test(provision),
  'accepted federation user is persisted and applied through the shared pipeline');
ok(/buildUserUris\(user/.test(fetch), 'federation URI fetch uses the VLESS-aware shared builder');
ok(/buildProxyOutbounds\(user/.test(fetch),
  'federation sing-box fetch uses the VLESS-aware shared outbound builder');
ok(/unsupportedProtocols: failure && Array\.isArray/.test(broadcast),
  'hub preserves per-node unsupported protocol details');
ok(/const failure = await r\.json\(\)\.catch/.test(broadcast),
  'hub surfaces the node capability message instead of a generic HTTP code');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
