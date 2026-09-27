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
  ok(source.includes('vless:{installed:$xrayInstalled') && source.includes('openflux:{installed:$openfluxInstalled'),
    `${name} detects VLESS while reserving a disabled OpenFlux registry entry`);
}
ok(update.includes('--doctor)    MODE="doctor"'), 'updater parses --doctor mode');
ok(/function|do_doctor\(\)/.test(update) && update.includes('No configuration or service state was changed.'),
  '--doctor explicitly reports its read-only contract');
ok(update.includes("PRAGMA quick_check;"), '--doctor checks SQLite integrity');
ok(update.includes('validate --config "$CADDY_FILE"'), '--doctor validates Caddy config');
ok(update.includes('mita inactive as expected (no Mieru users)') &&
   update.includes("(.users // []) | type == \"array\" and length == 0"),
  '--doctor accepts the intentional stopped Mita state only for an empty user list');
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
const multiFileTransaction = spawnSync(process.execPath, [path.join(__dirname, 'multi-file-transaction.test.js')],
  { stdio: 'inherit' });
ok(multiFileTransaction.status === 0, 'coupled config transaction regression suite passes');
const backupRestore = spawnSync(process.execPath, [path.join(__dirname, 'backup-restore.test.js')],
  { stdio: 'inherit' });
ok(backupRestore.status === 0, 'clean-install backup restore regression suite passes');
const vlessAdapter = spawnSync(process.execPath, [path.join(__dirname, 'vless-reality-adapter.test.js')],
  { stdio: 'inherit' });
ok(vlessAdapter.status === 0, 'VLESS REALITY adapter regression suite passes');
const xrayInstaller = spawnSync(process.execPath, [path.join(__dirname, 'xray-installer.test.js')],
  { stdio: 'inherit' });
ok(xrayInstaller.status === 0, 'pinned Xray installer regression suite passes');
const vlessIntegration = spawnSync(process.execPath, [path.join(__dirname, 'vless-panel-integration.test.js')],
  { stdio: 'inherit' });
ok(vlessIntegration.status === 0, 'VLESS panel integration regression suite passes');
const xrayStats = spawnSync(process.execPath, [path.join(__dirname, 'xray-stats.test.js')],
  { stdio: 'inherit' });
ok(xrayStats.status === 0, 'Xray per-user traffic regression suite passes');
const vlessLifecycle = spawnSync(process.execPath, [path.join(__dirname, 'vless-access-lifecycle.test.js')],
  { stdio: 'inherit' });
ok(vlessLifecycle.status === 0, 'VLESS access lifecycle regression suite passes');
const vlessEgress = spawnSync(process.execPath, [path.join(__dirname, 'vless-egress-routing.test.js')],
  { stdio: 'inherit' });
ok(vlessEgress.status === 0, 'VLESS egress routing regression suite passes');
const cascadeCanary = spawnSync(process.execPath, [path.join(__dirname, 'cascade-systemd-canary.test.js')],
  { stdio: 'inherit' });
ok(cascadeCanary.status === 0, 'two-node VLESS cascade reboot canary contract passes');
const vlessFederation = spawnSync(process.execPath, [path.join(__dirname, 'vless-federation.test.js')],
  { stdio: 'inherit' });
ok(vlessFederation.status === 0, 'VLESS federation regression suite passes');
const openfluxAdapter = spawnSync(process.execPath, [path.join(__dirname, 'openflux-adapter.test.js')],
  { stdio: 'inherit' });
ok(openfluxAdapter.status === 0, 'isolated OpenFlux adapter regression suite passes');
const openfluxInstaller = spawnSync(process.execPath, [path.join(__dirname, 'openflux-installer.test.js')],
  { stdio: 'inherit' });
ok(openfluxInstaller.status === 0, 'opt-in OpenFlux installer regression suite passes');
const openfluxLifecycle = spawnSync(process.execPath, [path.join(__dirname, 'openflux-profile-lifecycle.test.js')],
  { stdio: 'inherit' });
ok(openfluxLifecycle.status === 0, 'isolated OpenFlux profile lifecycle regression suite passes');
const openfluxUninstall = spawnSync(process.execPath, [path.join(__dirname, 'openflux-uninstall.test.js')],
  { stdio: 'inherit' });
ok(openfluxUninstall.status === 0, 'isolated OpenFlux uninstall regression suite passes');
const openfluxApi = spawnSync(process.execPath, [path.join(__dirname, 'openflux-api.test.js')],
  { stdio: 'inherit' });
ok(openfluxApi.status === 0, 'isolated OpenFlux API regression suite passes');
const openfluxGolden = spawnSync(process.execPath, [path.join(__dirname, 'openflux-disabled-golden.test.js')],
  { encoding: 'utf8' });
if (openfluxGolden.stdout) process.stdout.write(openfluxGolden.stdout);
if (openfluxGolden.stderr) process.stderr.write(openfluxGolden.stderr);
ok(openfluxGolden.status === 0, 'disabled OpenFlux golden isolation suite passes');
const openfluxSystemdCanary = spawnSync(process.execPath, [path.join(__dirname, 'openflux-systemd-canary.test.js')],
  { encoding: 'utf8' });
if (openfluxSystemdCanary.stdout) process.stdout.write(openfluxSystemdCanary.stdout);
if (openfluxSystemdCanary.stderr) process.stderr.write(openfluxSystemdCanary.stderr);
ok(openfluxSystemdCanary.status === 0, 'Debian 13 OpenFlux systemd canary contract passes');
const sessionCsrf = spawnSync(process.execPath, [path.join(__dirname, 'security-session-csrf.test.js')],
  { encoding: 'utf8' });
if (sessionCsrf.stdout) process.stdout.write(sessionCsrf.stdout);
if (sessionCsrf.stderr) process.stderr.write(sessionCsrf.stderr);
ok(sessionCsrf.status === 0, 'session rotation and CSRF regression suite passes');
const adminAudit = spawnSync(process.execPath, [path.join(__dirname, 'admin-audit.test.js')],
  { encoding: 'utf8' });
if (adminAudit.stdout) process.stdout.write(adminAudit.stdout);
if (adminAudit.stderr) process.stderr.write(adminAudit.stderr);
ok(adminAudit.status === 0, 'administrator audit regression suite passes');
const totpSecurity = spawnSync(process.execPath, [path.join(__dirname, 'totp-security.test.js')],
  { encoding: 'utf8' });
if (totpSecurity.stdout) process.stdout.write(totpSecurity.stdout);
if (totpSecurity.stderr) process.stderr.write(totpSecurity.stderr);
ok(totpSecurity.status === 0, 'optional administrator TOTP regression suite passes');
const logrotate = spawnSync(process.execPath, [path.join(__dirname, 'logrotate.test.js')],
  { encoding: 'utf8' });
if (logrotate.stdout) process.stdout.write(logrotate.stdout);
if (logrotate.stderr) process.stderr.write(logrotate.stderr);
ok(logrotate.status === 0, 'bounded file log rotation regression suite passes');
const logRedaction = spawnSync(process.execPath, [path.join(__dirname, 'log-redaction.test.js')],
  { encoding: 'utf8' });
if (logRedaction.stdout) process.stdout.write(logRedaction.stdout);
if (logRedaction.stderr) process.stderr.write(logRedaction.stderr);
ok(logRedaction.status === 0, 'sensitive log redaction regression suite passes');
const securityPolicy = spawnSync(process.execPath, [path.join(__dirname, 'security-policy.test.js')],
  { encoding: 'utf8' });
if (securityPolicy.stdout) process.stdout.write(securityPolicy.stdout);
if (securityPolicy.stderr) process.stderr.write(securityPolicy.stderr);
ok(securityPolicy.status === 0, 'security reporting and release revocation policy suite passes');
const installerSourceCwd = spawnSync(process.execPath, [path.join(__dirname, 'installer-source-cwd.test.js')],
  { encoding: 'utf8' });
if (installerSourceCwd.stdout) process.stdout.write(installerSourceCwd.stdout);
if (installerSourceCwd.stderr) process.stderr.write(installerSourceCwd.stderr);
ok(installerSourceCwd.status === 0, 'bundled private source working-directory regression suite passes');
const dependencySecurity = spawnSync(process.execPath, [path.join(__dirname, 'dependency-security.test.js')],
  { encoding: 'utf8' });
if (dependencySecurity.stdout) process.stdout.write(dependencySecurity.stdout);
if (dependencySecurity.stderr) process.stderr.write(dependencySecurity.stderr);
ok(dependencySecurity.status === 0, 'production dependency security regression suite passes');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
