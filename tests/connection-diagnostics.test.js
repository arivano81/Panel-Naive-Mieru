#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildUserConnectionDiagnostics } = require('../panel/server/connectionDiagnostics');

const user = { id: 'u1', username: 'alice', password: 'secret', vless_uuid: 'uuid',
  protocols: '["naive","vless"]' };
const diagnostics = { services: { caddy: 'active', xray: 'active' },
  ports: { naive: true, vless: true },
  network: [{ role: 'VPN', dnsOk: true, certificate: { ok: true } }] };
const ready = buildUserConnectionDiagnostics(user, { stack: { vless: true } }, diagnostics,
  { active: true, reason: null });
assert(ready.ready && ready.protocols.every(item => item.ready), 'healthy server-side path is ready');
assert(!JSON.stringify(ready).includes('secret') && !JSON.stringify(ready).includes('uuid'),
  'diagnostics never expose passwords or UUIDs');

const withXhttp = buildUserConnectionDiagnostics(user,
  { stack: { vless: true, vlessXhttp: true } },
  { ...diagnostics, ports: { ...diagnostics.ports, vlessXhttp: false } },
  { active: true, reason: null });
assert(withXhttp.protocols.find(item => item.name === 'vless')?.ready &&
  !withXhttp.protocols.find(item => item.name === 'vless-xhttp')?.ready,
  'REALITY and XHTTP readiness are diagnosed independently');

const blocked = buildUserConnectionDiagnostics(user, { stack: { vless: true } },
  { ...diagnostics, services: { caddy: 'inactive', xray: 'active' } },
  { active: false, reason: 'quota' });
assert(!blocked.ready && blocked.access.reason === 'quota' && blocked.protocols.every(item => !item.ready),
  'access policy and service failures are classified');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'panel/server/index.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'panel/public/app.js'), 'utf8');
assert(server.includes("app.get('/api/users/:id/connection-diagnostics', requireAuth, async"),
  'authenticated read-only endpoint exists');
assert(ui.includes('async function diagnoseUserConnection()') && ui.includes("case 'diagnose-user'"),
  'diagnostics page exposes the per-user check');
console.log('Per-user connection diagnostics regression test passed');
