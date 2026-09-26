#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createOpenFluxService, safeFailure } = require('../panel/server/openfluxService');
const root = path.resolve(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'panel/server/openfluxRoutes.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'panel/server/index.js'), 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('OpenFlux isolated API regression test');
const calls = [];
const exists = new Set(['/bin/openflux', '/scripts/profile.sh', '/scripts/install.sh']);
const service = createOpenFluxService({
  paths: { binary: '/bin/openflux', lifecycleScript: '/scripts/profile.sh', installScript: '/scripts/install.sh' },
  existsSync: file => exists.has(file),
  execFileSync: (file, args) => {
    calls.push([file, ...args]);
    if (args[1] === 'list') return '[{"id":"alpha","active":false}]';
    return '{"ok":true}';
  },
});
ok(service.installed(), 'installation state requires the binary and lifecycle CLI');
ok(service.release.version === '0.0.5', 'status exposes the pinned supported version');
ok(service.list()[0].id === 'alpha', 'profile list is parsed as structured JSON');
service.create({ id: 'alpha', port: 18445, host: 'vpn.example.com' });
ok(calls.some(call => call.join('|') === 'bash|/scripts/profile.sh|create|alpha|18445|vpn.example.com'),
  'profile input is passed as execFile arguments without a shell');
service.action('alpha', 'start');
ok(calls.some(call => call.join('|') === 'bash|/scripts/profile.sh|start|alpha'),
  'actions can address only the isolated lifecycle CLI');
ok(!routes.includes('execSync') && !routes.includes('child_process'), 'HTTP routes cannot execute shell commands directly');
for (const route of [
  "app.get('/api/openflux', requireAuth",
  "app.post('/api/openflux/install', requireAuth",
  "app.post('/api/openflux/profiles', requireAuth",
  "app.post('/api/openflux/profiles/:id/:action', requireAuth",
  "app.delete('/api/openflux/profiles/:id', requireAuth",
]) ok(routes.includes(route), `${route.split(',')[0]} is authenticated`);
ok(routes.includes("new Set(['start', 'stop', 'restart'])"), 'action endpoint has an explicit allowlist');
ok(!/caddy|mieru|hysteria|xray|warp|cascade/i.test(routes), 'OpenFlux routes cannot address the primary stack');
ok(server.includes('registerOpenFluxRoutes(app, requireAuth, openFluxService)'), 'isolated routes are registered by the panel');
ok(!safeFailure({ stderr: 'one\ntwo\nthree\nfour' }).includes('one'), 'external failure output is length-bounded to its tail');

const absent = createOpenFluxService({
  paths: { binary: '/missing', lifecycleScript: '/scripts/profile.sh', installScript: '/scripts/install.sh' },
  existsSync: file => file !== '/missing',
  execFileSync: () => { throw new Error('must not run'); },
});
ok(Array.isArray(absent.list()) && absent.list().length === 0, 'status is safe before opt-in installation');
try { absent.action('alpha', 'start'); ok(false, 'absent component must reject activation'); }
catch (error) { ok(error.status === 409, 'absent component rejects activation without side effects'); }

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
