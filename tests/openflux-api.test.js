#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createOpenFluxService, safeFailure } = require('../panel/server/openfluxService');
const root = path.resolve(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'panel/server/openfluxRoutes.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'panel/server/index.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'panel/public/index.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'panel/public/app.js'), 'utf8');
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
  lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false }),
  execFileSync: (file, args) => {
    calls.push([file, ...args]);
    if (file === 'journalctl') return 'normal line\nEncryptionKey = forbidden\npassword=forbidden\n';
    if (file === 'tar') return Buffer.from('archive');
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
service.rotate('alpha');
ok(calls.some(call => call.join('|') === 'bash|/scripts/profile.sh|rotate|alpha'),
  'key rotation delegates only to the transactional lifecycle CLI');
const logs = service.logs('alpha', 9999);
ok(logs.includes('normal line') && !logs.includes('forbidden') &&
  logs.match(/\[redacted sensitive line\]/g)?.length === 2, 'journal output is filtered before leaving the service');
ok(calls.some(call => call.join('|').includes('journalctl|-u|openflux-exit@alpha.service|-n|500|--no-pager')),
  'logs are scoped to one validated unit and a bounded line count');
ok(service.bundle('alpha').equals(Buffer.from('archive')), 'bundle is returned only as an archive buffer');
ok(calls.some(call => call.join('|') === 'tar|-C|/root/openflux-alpha-client|-czf|-|client.conf|openflux.key'),
  'archive contains only the two validated client files');
ok(!routes.includes('execSync') && !routes.includes('child_process'), 'HTTP routes cannot execute shell commands directly');
for (const route of [
  "app.get('/api/openflux', requireAuth",
  "app.post('/api/openflux/install', requireAuth",
  "app.post('/api/openflux/profiles', requireAuth",
  "app.post('/api/openflux/profiles/:id/bundle', requireAuth",
  "app.post('/api/openflux/profiles/:id/rotate', requireAuth",
  "app.post('/api/openflux/profiles/:id/:action', requireAuth",
  "app.get('/api/openflux/profiles/:id/logs', requireAuth",
  "app.delete('/api/openflux/profiles/:id', requireAuth",
]) ok(routes.includes(route), `${route.split(',')[0]} is authenticated`);
ok(routes.includes("new Set(['start', 'stop', 'restart', 'reset'])"), 'action endpoint has an explicit allowlist');
ok(!/caddy|mieru|hysteria|xray|warp|cascade/i.test(routes), 'OpenFlux routes cannot address the primary stack');
ok(server.includes('registerOpenFluxRoutes(app, requireAuth, openFluxService,'), 'isolated routes are registered by the panel');
ok(html.includes('id="page-openflux"') && html.includes('OpenFlux Experimental'),
  'OpenFlux is visually separated on an experimental page');
ok(html.includes('/root/openflux-&lt;id&gt;-client') && html.includes('Секрет не передаётся браузеру'),
  'UI explains the server-only client bundle boundary');
ok(ui.includes("case 'openflux':    loadOpenFlux()") && ui.includes("'/api/openflux/profiles'"),
  'page loads isolated profile state and creates profiles through its namespace');
ok(ui.includes("['start', 'stop', 'restart', 'reset'].includes(action)"), 'browser action dispatcher repeats the server allowlist');
ok(ui.includes("case 'openflux-logs'") && html.includes('id="openflux-logs"'), 'UI exposes the filtered per-profile journal');
ok(routes.includes('verifyAdminPassword(req.body.password)') && routes.includes("'Cache-Control', 'no-store'"),
  'secret bundle export requires password re-authentication and disables caching');
ok(routes.includes('requireAuth, secretExportLimiter') && server.includes('openFluxSecretLimiter = rateLimit'),
  'secret export password attempts have a dedicated rate limit');
ok(ui.includes("case 'openflux-bundle'") && ui.includes("prompt('Повторно введите пароль администратора панели:'"),
  'UI requires an explicit warning and administrator password before bundle export');
ok(routes.includes('service.rotate(req.params.id)') && ui.includes("case 'openflux-rotate'"),
  'key rotation is exposed only through its confirmed experimental control');
ok(!/protocols[^\n]*openflux/i.test(ui), 'UI never adds OpenFlux to shared user protocols');
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
