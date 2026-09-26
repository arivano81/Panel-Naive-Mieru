#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const install = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const update = fs.readFileSync(path.join(root, 'update.sh'), 'utf8');
const html = fs.readFileSync(path.join(root, 'panel/public/index.html'), 'utf8');
let passed = 0, failed = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); passed++; }
  else { console.error('  ✗', message); failed++; }
}

console.log('Private fork source regression test');
for (const [name, source] of [['install.sh', install], ['update.sh', update]]) {
  ok(source.includes('github.com/arivano81/Panel-Naive-Mieru'), `${name} targets this fork`);
  ok(!source.includes('github.com/cwash797-cmd'), `${name} cannot replace the fork with parent code`);
  ok(source.includes('PANEL_GITHUB_TOKEN'), `${name} supports a read-only private-repo token`);
}
ok(update.includes('curl -H @-'), 'updater keeps the curl authorization header out of argv');
ok(html.includes('github.com/arivano81/Panel-Naive-Mieru'), 'panel GitHub links point to this fork');
ok(!html.includes('github.com/cwash797-cmd'), 'panel has no duplicate parent-project link');
for (const [name, source] of [['install.sh', install], ['update.sh', update]]) {
  ok(source.includes('COMPONENT_REGISTRY="/etc/rixxx-panel/components.json"'),
    `${name} uses the canonical component registry path`);
  ok(/write_component_registry\(\)/.test(source), `${name} defines component registry writer`);
  ok(source.includes('vless:{installed:false},openflux:{installed:false}'),
    `${name} reserves disabled VLESS/OpenFlux registry entries`);
}
ok(update.includes('--doctor)    MODE="doctor"'), 'updater parses --doctor mode');
ok(/function|do_doctor\(\)/.test(update) && update.includes('No configuration or service state was changed.'),
  '--doctor explicitly reports its read-only contract');
ok(update.includes("PRAGMA quick_check;"), '--doctor checks SQLite integrity');
ok(update.includes('validate --config "$CADDY_FILE"'), '--doctor validates Caddy config');
ok(update.includes('--rollback)') && update.includes('MODE="rollback"'),
  'updater parses --rollback mode');
ok(/validate_rollback_backup\(\)/.test(update), 'rollback validates snapshots before replacement');
ok(/safety=\$\(auto_backup \| tail -n1\)/.test(update), 'rollback creates a pre-change safety snapshot');
ok(update.includes('safety snapshot restored'), 'failed rollback automatically restores original state');
ok(update.includes('rixxx-panel-rollback-report.txt'), 'rollback writes a root-only outcome report');
ok(update.includes('"${DB_PATH}-wal" "${DB_PATH}-shm"'),
  'rollback removes newer SQLite WAL/SHM before activating the restored DB');

const migrations = spawnSync(process.execPath, [path.join(__dirname, 'database-migrations.test.js')],
  { stdio: 'inherit' });
ok(migrations.status === 0, 'explicit SQLite migration regression suite passes');
const configMigrations = spawnSync(process.execPath, [path.join(__dirname, 'config-migrations.test.js')],
  { stdio: 'inherit' });
ok(configMigrations.status === 0, 'explicit config migration regression suite passes');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
