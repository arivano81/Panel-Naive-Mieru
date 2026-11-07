#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const script = read('panel/scripts/reconfigure_xray_reality.sh');
const installer = read('panel/scripts/install_xray.sh');
const server = read('panel/server/index.js');
const html = read('panel/public/index.html');
const app = read('panel/public/app.js');
const css = read('panel/public/style.css');
const update = read('update.sh');
let passed = 0, failed = 0;
const ok = (value, message) => value
  ? (console.log('  ✓', message), passed++)
  : (console.error('  ✗', message), failed++);

console.log('Operator-owned REALITY target safety test');
const syntax = spawnSync('bash', ['-n', 'panel/scripts/reconfigure_xray_reality.sh'],
  { cwd: root, encoding: 'utf8' });
ok(process.platform !== 'linux' || syntax.status === 0, 'target migration script has valid Bash syntax');
ok(!installer.includes('www.cloudflare.com') && !server.includes('www.cloudflare.com') &&
   !html.includes('www.cloudflare.com'), 'production VLESS paths have no popular third-party default');
ok(script.includes('"$SERVER_NAME" == "$PRIMARY_DOMAIN"') &&
   installer.includes('XRAY_SERVER_NAME must equal the configured primary domain'),
  'installation and migration accept only the configured primary domain');
ok(script.includes('-verify_hostname "$SERVER_NAME"') && script.includes('-checkend 86400'),
  'migration verifies the local certificate identity and remaining validity');
ok(script.includes('"${1:-}" == "--check"') && script.indexOf('MODE" == check') < script.indexOf('mkdir -p "$BACKUP"'),
  'read-only preflight exits before creating backups or changing live files');
ok(script.includes("select(.tag == \"vless-reality-in\")") &&
   !script.includes('x25519') && !script.includes('vless_uuid'),
  'migration changes only target metadata and never rotates keys or client UUIDs');
ok(script.includes('cp -a "$XRAY_CONFIG"') && script.includes('rollback()') &&
   script.includes('previous configuration restored'), 'migration backs up and rolls back failed Xray activation');
ok(script.includes('CADDY_PID=') && script.includes('caddy-naive changed during') &&
   !/systemctl (?:restart|reload|stop|start) caddy-naive/.test(script),
  'migration proves caddy-naive stays active with the same PID');
ok(server.includes("app.post('/api/settings/vless/reality-target'") &&
   server.includes('XRAY_TARGET_SCRIPT'), 'authenticated panel route delegates to the isolated migration');
ok(html.includes('data-action="change-vless-target"') &&
   app.includes('async function changeVlessTarget()'), 'installed VLESS card exposes the safe target change');

const panelOnly = update.slice(update.indexOf('do_panel_only()'), update.indexOf('do_update()'));
ok(update.includes('--panel-only) MODE="panel-only"') && panelOnly.includes('update_panel') &&
   !/systemctl (?:restart|reload|stop|start)/.test(panelOnly),
  'panel-only updater cannot issue a proxy service restart');
ok(panelOnly.includes('proxy_snapshot') && panelOnly.includes('PIDs unchanged'),
  'panel-only update verifies every proxy PID before reporting success');
ok(css.includes('@media (max-width: 520px)') && css.includes('.page-header { align-items: stretch; flex-direction: column; }'),
  'narrow user-page header stacks the add button inside the viewport');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
