#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createOperationBackup, operationBackupMiddleware, operationLabel } = require('../panel/server/operationBackup');

const server = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
const provision = server.slice(server.indexOf("app.post('/api/federation/provision'"),
  server.indexOf("app.post('/api/federation/deprovision'"));
assert(provision.indexOf('safeTokenEqual') < provision.indexOf("writeSafetyBackup('federation-keys')"),
  'federation writes a backup only after bearer-token authentication');

const req = (method, requestPath, body = {}) => ({ method, path: requestPath, body });
assert.strictEqual(operationLabel(req('POST', '/api/config', { domain: 'vpn.example' })), 'server-config');
assert.strictEqual(operationLabel(req('POST', '/api/config', { language: 'en' })), '');
assert.strictEqual(operationLabel(req('POST', '/api/users')), 'user-keys');
assert.strictEqual(operationLabel(req('PUT', '/api/users/id')), 'user-keys');
assert.strictEqual(operationLabel(req('POST', '/api/settings/naive-port')), 'protocol-config');
assert.strictEqual(operationLabel(req('POST', '/api/settings/vless/reality-target')), 'protocol-config');
assert.strictEqual(operationLabel(req('POST', '/api/openflux/profiles/demo/rotate')), 'openflux-keys');
assert.strictEqual(operationLabel(req('POST', '/api/settings/language')), '');
assert.strictEqual(operationLabel({ method: 'POST', baseUrl: '/api', path: '/users', body: {} }), 'user-keys',
  'mounted Express middleware reconstructs the full API path');

const directory = fs.mkdtempSync(path.join(__dirname, '.operation-backup-'));
const payload = { format: 'vertaflux-backup', schema: 4, config: { domain: 'vpn.example' }, users: [] };
const file = createOperationBackup(payload, 'server-config', { directory, retain: 2, now: new Date('2026-11-10T12:00:00Z') });
assert.deepStrictEqual(JSON.parse(fs.readFileSync(file)), payload, 'snapshot is a restorable portable backup');
if (process.platform !== 'win32')
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'snapshot is root-only');

let next = false, response;
operationBackupMiddleware(() => { throw new Error('disk full'); })({
  ...req('POST', '/api/users'), session: { authenticated: true },
}, {
  status(code) { response = { code }; return this; }, json(body) { response.body = body; },
}, () => { next = true; });
assert(!next && response.code === 503 && /no changes were made/.test(response.body.error),
  'mutation is blocked when its safety snapshot cannot be written');

next = false;
operationBackupMiddleware(() => { throw new Error('must not run'); })(req('POST', '/api/users'), {
  status() { throw new Error('unauthenticated request was intercepted'); }, json() {},
}, () => { next = true; });
assert(next, 'unauthenticated requests continue to the normal authorization gate without writing backups');

fs.rmSync(directory, { recursive: true, force: true });

console.log('Operation safety backup regression test passed');
