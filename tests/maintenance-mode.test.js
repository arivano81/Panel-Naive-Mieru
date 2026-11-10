#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { maintenanceProtection } = require('../panel/server/maintenance');

function run(enabled, method, requestPath, authenticated = true) {
  let next = false, response;
  maintenanceProtection(() => enabled)(
    { method, path: requestPath, session: { authenticated } },
    { status(code) { response = { code }; return { json(body) { response.body = body; } }; } },
    () => { next = true; },
  );
  return { next, response };
}

assert(run(true, 'GET', '/api/status').next, 'read-only APIs stay available');
assert(run(true, 'POST', '/api/maintenance').next, 'maintenance can always be disabled');
assert(run(true, 'POST', '/api/backup/export/encrypted').next, 'emergency backup stays available');
assert.strictEqual(run(true, 'POST', '/api/users').response.code, 423, 'mutations are locked');
assert.strictEqual(run(true, 'POST', '/api/federation/provision', false).response.code, 423,
  'federation cannot mutate users during maintenance');
assert(run(true, 'POST', '/api/federation/fetch', false).next, 'read-only federation fetch stays available');
assert(run(false, 'POST', '/api/users').next, 'normal operation is unchanged when disabled');
assert(run(true, 'POST', '/api/login', false).next, 'authentication remains available');
let mountedNext = false;
maintenanceProtection(() => true)(
  { method: 'POST', baseUrl: '/api', path: '/maintenance', session: { authenticated: true } },
  { status() { throw new Error('mounted maintenance route was blocked'); } },
  () => { mountedNext = true; },
);
assert(mountedNext, 'mounted Express middleware keeps its recovery route available');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'panel/server/index.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'panel/public/index.html'), 'utf8');
assert(server.includes("app.post('/api/maintenance', requireAuth") &&
  server.includes('bcrypt.compareSync(password, cfg.adminPassHash)'), 'toggle requires authentication and password');
assert(html.includes('id="maintenance-banner"') && html.includes('data-action="toggle-maintenance"'),
  'UI exposes persistent maintenance state and control');
console.log('Maintenance mode regression test passed');
