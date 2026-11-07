#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const script = fs.readFileSync(path.join(__dirname, '../panel/scripts/install_xray.sh'), 'utf8');
const configMigrations = fs.readFileSync(path.join(__dirname, '../panel/server/configMigrations.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
const install = fs.readFileSync(path.join(__dirname, '../install.sh'), 'utf8');
const update = fs.readFileSync(path.join(__dirname, '../update.sh'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/ci.yml'), 'utf8');
const binaryCanary = fs.readFileSync(path.join(__dirname, 'xray-binary-canary.sh'), 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('Pinned Xray installer regression test');
ok(/XRAY_VERSION="v26\.3\.27"/.test(script), 'stable Xray version is pinned');
ok(workflow.includes("if: matrix.release == '13'") && workflow.includes('bash tests/xray-binary-canary.sh'),
  'Debian 13 CI runs the real pinned-binary canary');
ok(binaryCanary.includes('run -test -config "$WORK/config.json"'),
  'binary canary validates the generated config with real Xray');
ok(binaryCanary.includes('--socks5-hostname 127.0.0.1:18080') &&
   binaryCanary.includes('vless-reality-canary') &&
   binaryCanary.includes("serverName: 'www.example.com'") &&
   binaryCanary.includes("target: 'www.example.com:443'") &&
   !binaryCanary.includes('openssl s_server'),
  'Debian 13 canary carries a local HTTP origin through a real VLESS REALITY client/server and trusted TLS target');
for (const [name, source] of [['installer', script], ['binary canary', binaryCanary]]) {
  ok(source.includes('(PrivateKey|Private key)') && source.includes('Password \\(PublicKey\\)'),
    `${name} accepts the current and legacy X25519 labels`);
}
ok(/XRAY_ASSET="Xray-linux-64\.zip"/.test(script), 'amd64 release asset is pinned');
ok(/SERVER_NAME="\$\{XRAY_SERVER_NAME:-\}"/.test(script) &&
   script.includes('XRAY_SERVER_NAME must equal the configured primary domain'),
  'installer requires the operator-owned primary domain instead of a third-party target');
ok(script.includes('23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae'),
  'official SHA-256 is pinned');
ok(!/releases\/latest|api\.github\.com\/repos\/XTLS/.test(script), 'installer never resolves latest');
const verifyAt = script.indexOf('sha256sum -c');
ok(verifyAt > 0 && verifyAt < script.indexOf('unzip -q'), 'checksum is verified before extraction');
ok(verifyAt < script.indexOf('install -m 0755'), 'checksum is verified before binary installation');
ok(script.includes('run -test -config "$WORK/config.json"'), 'candidate config is tested by Xray');
ok(/User=xray/.test(script) && /NoNewPrivileges=true/.test(script), 'service uses dedicated user and hardening');
ok(/chown root:xray "\$XRAY_DIR"/.test(script) && /chmod 0750 "\$XRAY_DIR"/.test(script),
  'service user can traverse the protected config directory');
ok(/service_stable=0/.test(script) && /systemctl is-active xray/.test(script),
  'service health requires a stable exact active state');
ok(script.includes('loopback Stats API port 10085 is already in use'),
  'installer refuses a Stats API port collision');
ok(/activation failed; restoring previous Xray state/.test(script), 'failed activation rolls back');
ok(/RIXXX VLESS REALITY/.test(script), 'firewall rule has a component-specific marker');
ok(/chmod 600 "\$REPORT"/.test(script), 'installation report is root-only');
ok(/config\.stack\.vless == null\) config\.stack\.vless = false/.test(configMigrations),
  'existing installs keep VLESS disabled by default');
ok(update.includes('/usr/local/bin/xray run -test -config /etc/xray/config.json'),
  'doctor validates installed Xray config read-only');
ok(update.includes('systemctl is-active --quiet xray'), 'doctor checks Xray service health');
ok(server.includes("execFileSync('sleep', ['1']") && server.includes("state !== 'active'"),
  'panel apply rejects an immediate systemd restart loop');
ok(server.includes("['run', '-test', '-format', 'json', '-config', file]"),
  'panel validates the transaction .json.new candidate with an explicit format');
for (const [name, source] of [['installer', install], ['updater', update]]) {
  ok(source.includes('xray_installed=true') && source.includes('installed:$xrayInstalled'),
    `${name} preserves installed Xray state in the component registry`);
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
