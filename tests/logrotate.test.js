#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'panel/scripts/install_logrotate.sh'), 'utf8');
const install = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const update = fs.readFileSync(path.join(root, 'update.sh'), 'utf8');
let passed = 0;
let failed = 0;

function ok(value, message) {
  if (value) {
    passed++;
    console.log('  ✓', message);
  } else {
    failed++;
    console.error('  ✗', message);
  }
}

console.log('Bounded file log rotation regression test');
ok(script.includes('/var/log/panel-naive-mieru.log') &&
   script.includes('/var/log/vertaflux-install.log') &&
   script.includes('/var/log/cascade-watchdog.log'),
  'all panel-owned file logs share one explicit rotation policy');
ok(script.includes('maxsize 10M') && script.includes('rotate 14') &&
   script.includes('compress') && script.includes('copytruncate'),
  'policy bounds size and generations without requiring process restarts');
ok(!script.includes('/var/log/caddy-naive/access.log'),
  'Caddy internal rolling log is not double-rotated');
ok(install.includes('logrotate') && install.includes('bash "$PANEL_DIR/scripts/install_logrotate.sh"'),
  'clean install provides logrotate and installs the policy');
ok(update.includes('bash "$PANEL_DIR/scripts/install_logrotate.sh"'),
  'updates repair or add the policy on existing servers');

if (process.platform !== 'win32') {
  const fixture = fs.mkdtempSync('/tmp/vertaflux-logrotate-test-');
  const run = () => spawnSync('bash', ['panel/scripts/install_logrotate.sh'], {
    cwd: root,
    env: { ...process.env, VERTAFLUX_LOGROTATE_ROOT: fixture },
    encoding: 'utf8',
  });
  const first = run();
  const target = path.join(fixture, 'etc/logrotate.d/vertaflux');
  const firstContent = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const second = run();
  ok(first.status === 0 && second.status === 0 && fs.existsSync(target),
    'functional fixture installs idempotently without system writes');
  ok(fs.readFileSync(target, 'utf8') === firstContent && (fs.statSync(target).mode & 0o777) === 0o644,
    'reinstall is byte-stable and keeps the canonical mode');
  fs.rmSync(fixture, { recursive: true, force: true });
} else {
  ok(true, 'functional fixture runs in Linux CI');
  ok(true, 'mode and idempotence are verified in Linux CI');
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
