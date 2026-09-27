#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
const backup = fs.readFileSync(path.join(__dirname, '../panel/server/backupRestore.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../panel/public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../panel/public/app.js'), 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('VLESS panel integration regression test');
ok(source.includes("const VALID_PROTOCOLS = ['naive', 'mieru', 'hy2', 'vless']"),
  'VLESS is in the explicit protocol allowlist');
ok(source.includes('vless_uuid: uuidv4()'), 'new users receive a separate VLESS UUID');
ok(source.includes('vless_uuid=COALESCE(excluded.vless_uuid, users.vless_uuid)'),
  'user updates preserve the existing VLESS UUID');
ok(/function applyXrayConfig\(\)/.test(source), 'panel has a dedicated Xray apply path');
ok(source.includes("execFileSync(XRAY_BIN, ['run', '-test', '-config', file]"),
  'candidate Xray config is tested before activation');
ok(source.includes('targetPath: XRAY_CONFIG') && source.includes('applyFileTransaction({'),
  'Xray uses the common transactional config writer');
ok(source.includes("execFileSync('sleep', ['1']") &&
   source.includes("execFileSync('systemctl', ['is-active', 'xray']") &&
   source.includes("state !== 'active'"),
  'Xray restart requires a stable exact active-service state');
ok(source.includes('xray: !!(xrayResult && xrayResult.rolledBack)'),
  'rollback state is exposed to apply-status');
ok(source.includes('applyXhttpStackTransaction()') && source.includes('applyMultiFileTransaction({ items:'),
  'XHTTP applies Xray and Caddy as one rollback unit');
ok(source.includes('const coupledXhttp = !!') && source.includes('if (!coupledXhttp)'),
  'disabled XHTTP preserves the established independent apply path');
ok(source.includes("app.get('/api/settings/vless'") &&
   source.includes("app.post('/api/settings/vless/rebuild'"),
  'authenticated VLESS status and rebuild endpoints exist');
ok(source.includes("app.post('/api/settings/vless/xhttp'") &&
   source.includes('applyXhttpStackTransaction({ allowDisabled: true })'),
  'authenticated XHTTP toggle uses the coupled transaction for enable and disable');
ok(source.includes('cfg = previous') && source.includes('rollbackError: result.rollbackError'),
  'failed XHTTP activation restores the panel config and reports rollback state');
ok(source.includes("app.post('/api/settings/vless/install'") && source.includes('XRAY_INSTALL_SCRIPT'),
  'authenticated opt-in Xray installation endpoint exists');
ok(source.includes("app.get('/api/users/:id/config/vless'"),
  'authenticated per-user VLESS link endpoint exists');
ok(source.includes("app.get('/api/users/:id/config/vless-xhttp'") &&
   source.includes('buildVlessXhttpLink'),
  'authenticated per-user XHTTP link endpoint exists');
ok(source.includes('if (cfg.stack.vlessXhttp)') && source.includes('XHTTP`));'),
  'base64 subscriptions append XHTTP only while the profile is enabled');
ok(source.includes("protos.includes('vless')") && source.includes('buildVlessRealityLink'),
  'subscriptions include VLESS only for explicitly enabled users');
ok(backup.includes('const BACKUP_SCHEMA = 4') &&
   backup.includes('vless_uuid: user.vless_uuid || null') &&
   backup.includes('vlessUploadBytes: user.vlessUploadBytes || 0'),
  'backup schema preserves VLESS identities and durable traffic');
ok(html.includes('id="p-vless"') && html.includes('id="card-vless"') &&
   html.includes('id="btn-dl-vless-link"'), 'panel exposes opt-in VLESS controls');
ok(app.includes("protocols.push('vless')") && app.includes('function applyVlessGate()'),
  'user editor gates VLESS on component installation');
ok(app.includes('function installVless()') && app.includes('function rebuildVless()') &&
   app.includes('function downloadVlessLink()'), 'panel supports install, rebuild, and client link actions');
ok(html.includes('id="s-vless-xhttp-enabled"') && html.includes('id="btn-dl-vless-xhttp-link"') &&
   app.includes('function saveVlessXhttp()') && app.includes('function downloadVlessXhttpLink()'),
  'panel exposes explicit XHTTP opt-in and per-user client link controls');
ok(source.includes("tagFor('vless-out')") && source.includes('bonusUrlToSingboxOutbound(link, tag)'),
  'universal sing-box config includes the managed local VLESS REALITY outbound');
ok(source.includes("tagFor('vless-xhttp-out')") && source.includes('bonusUrlToSingboxOutbound(xhttpLink, xhttpTag)'),
  'universal sing-box config includes managed XHTTP only through the validated link parser');
ok(source.includes('const identities = new Set(proxyOutbounds.map(singboxOutboundIdentity)') &&
   source.includes('identities.has(identity)'), 'matching bonus VLESS nodes are de-duplicated');
const identitySource = source.match(/function singboxOutboundIdentity\(outbound\) \{[\s\S]*?\n\}/);
const identity = identitySource && Function(`${identitySource[0]}; return singboxOutboundIdentity;`)();
const managed = { type: 'vless', tag: 'vless-out', uuid: 'AA', server: 'VPN.EXAMPLE', server_port: 8443 };
const bonusCopy = { ...managed, tag: 'bonus-1', uuid: 'aa', server: 'vpn.example' };
ok(identity && identity(managed) === identity(bonusCopy),
  'de-duplication identity ignores tag and normalizes VLESS case');
ok(identity && identity(managed) !== identity({ ...bonusCopy, uuid: 'bb' }),
  'different VLESS UUID remains a distinct bonus node');
ok(source.includes("case 'vless':") && html.includes('id="log-btn-vless"') &&
   /\[[^\]]*'vless'[^\]]*\]\.forEach\(s =>/.test(app),
  'Xray journal is available from the Logs page');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
