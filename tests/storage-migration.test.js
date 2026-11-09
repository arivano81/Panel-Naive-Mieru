#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'panel/scripts/migrate_storage.sh');
let passed = 0;

function ok(value, message) {
  if (!value) throw new Error(message);
  console.log('  ✓', message);
  passed++;
}

function run(fixture) {
  return spawnSync('bash', [script], {
    env: { ...process.env, VERTAFLUX_TEST_ROOT: fixture }, encoding: 'utf8'
  });
}

const source = fs.readFileSync(script, 'utf8');
ok(source.includes('check_dir /etc/rixxx-panel /etc/vertaflux') &&
   source.indexOf('check_dir /var/lib/rixxx-panel') < source.indexOf('migrate_dir /etc/rixxx-panel'),
   'both directory pairs are preflighted before mutation');
ok(source.includes('ln -s "$canonical" "$legacy"'), 'legacy paths remain compatibility links');
ok(source.includes('Canonical storage must be a real directory'), 'canonical symlinks and files are rejected');
const install = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const server = fs.readFileSync(path.join(root, 'panel/server/index.js'), 'utf8');
ok(install.includes('PANEL_CONFIG="/etc/vertaflux/config.json"') &&
   server.includes("const PANEL_CONFIG    = '/etc/vertaflux/config.json'"),
   'new installs and runtime use the canonical VertaFlux paths');

if (process.platform === 'win32') {
  console.log('  - functional fixture runs in Linux CI');
  console.log(`\nResult: ${passed} passed`);
  process.exit(0);
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vertaflux-storage-'));
fs.mkdirSync(path.join(fixture, 'etc/rixxx-panel'), { recursive: true });
fs.mkdirSync(path.join(fixture, 'var/lib/rixxx-panel'), { recursive: true });
fs.writeFileSync(path.join(fixture, 'etc/rixxx-panel/config.json'), '{}');
fs.writeFileSync(path.join(fixture, 'var/lib/rixxx-panel/db.sqlite'), 'db');

let result = run(fixture);
ok(result.status === 0, 'legacy storage migrates successfully');
ok(fs.existsSync(path.join(fixture, 'etc/vertaflux/config.json')) &&
   fs.existsSync(path.join(fixture, 'var/lib/vertaflux/db.sqlite')), 'data moves to canonical paths');
ok(fs.lstatSync(path.join(fixture, 'etc/rixxx-panel')).isSymbolicLink() &&
   fs.lstatSync(path.join(fixture, 'var/lib/rixxx-panel')).isSymbolicLink(), 'legacy paths remain compatibility links');
result = run(fixture);
ok(result.status === 0, 'migration is idempotent');

const conflict = fs.mkdtempSync(path.join(os.tmpdir(), 'vertaflux-storage-conflict-'));
for (const dir of ['etc/rixxx-panel', 'etc/vertaflux', 'var/lib/rixxx-panel']) {
  fs.mkdirSync(path.join(conflict, dir), { recursive: true });
}
result = run(conflict);
ok(result.status !== 0, 'conflicting real directories are rejected without merging');

console.log(`\nResult: ${passed} passed`);
