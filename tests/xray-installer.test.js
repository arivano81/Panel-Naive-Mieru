#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const script = fs.readFileSync(path.join(__dirname, '../panel/scripts/install_xray.sh'), 'utf8');
const configMigrations = fs.readFileSync(path.join(__dirname, '../panel/server/configMigrations.js'), 'utf8');
const install = fs.readFileSync(path.join(__dirname, '../install.sh'), 'utf8');
const update = fs.readFileSync(path.join(__dirname, '../update.sh'), 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('Pinned Xray installer regression test');
ok(/XRAY_VERSION="v26\.3\.27"/.test(script), 'stable Xray version is pinned');
ok(/XRAY_ASSET="Xray-linux-64\.zip"/.test(script), 'amd64 release asset is pinned');
ok(script.includes('23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae'),
  'official SHA-256 is pinned');
ok(!/releases\/latest|api\.github\.com\/repos\/XTLS/.test(script), 'installer never resolves latest');
const verifyAt = script.indexOf('sha256sum -c');
ok(verifyAt > 0 && verifyAt < script.indexOf('unzip -q'), 'checksum is verified before extraction');
ok(verifyAt < script.indexOf('install -m 0755'), 'checksum is verified before binary installation');
ok(script.includes('run -test -config "$WORK/config.json"'), 'candidate config is tested by Xray');
ok(/User=xray/.test(script) && /NoNewPrivileges=true/.test(script), 'service uses dedicated user and hardening');
ok(/systemctl is-active --quiet xray/.test(script), 'service health is verified');
ok(/activation failed; restoring previous Xray state/.test(script), 'failed activation rolls back');
ok(/RIXXX VLESS REALITY/.test(script), 'firewall rule has a component-specific marker');
ok(/chmod 600 "\$REPORT"/.test(script), 'installation report is root-only');
ok(/config\.stack\.vless == null\) config\.stack\.vless = false/.test(configMigrations),
  'existing installs keep VLESS disabled by default');
for (const [name, source] of [['installer', install], ['updater', update]]) {
  ok(source.includes('xray_installed=true') && source.includes('installed:$xrayInstalled'),
    `${name} preserves installed Xray state in the component registry`);
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
