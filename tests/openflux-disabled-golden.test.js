#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const caddy = require('../panel/server/caddyTemplate');
const { buildXrayRealityConfig } = require('../panel/server/xrayConfig');

const source = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}
function extractFn(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function not found: ${name}`);
  const openParen = source.indexOf('(', start);
  let parenDepth = 0, cursor = openParen;
  for (; cursor < source.length; cursor++) {
    if (source[cursor] === '(') parenDepth++;
    else if (source[cursor] === ')' && --parenDepth === 0) { cursor++; break; }
  }
  const body = source.indexOf('{', cursor);
  let depth = 0;
  for (let i = body; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${name}`);
}

const users = [{
  username: 'golden-user', password: 'strong-password',
  protocols: '["naive","mieru","hy2"]', quotaMB: 0, usedMB: 0, expiry: null,
  bonus_links: '[]', vlessUploadBytes: 0, vlessDownloadBytes: 0,
}];
const base = {
  adminEmail: 'admin@example.com', domain: 'vpn.example.com', serverIp: '203.0.113.10',
  naivePort: 443, mieruPortStart: 2012, mieruPortEnd: 2013, hy2Port: 8443,
  fakeSiteDir: '/var/www/fake-site', probeMode: 'off', mtu: 1400, udpEnabled: false,
  trafficPattern: 'NOOP', stack: { naive: true, mieru: true, hy2: true, vless: true },
};
const disabled = { ...base, stack: { ...base.stack }, openflux: { enabled: false } };

console.log('OpenFlux disabled golden isolation test');
const renderCaddy = cfg => caddy.render({ ...cfg, logFile: '/var/log/caddy-naive/access.log' }, users);
ok(Buffer.from(renderCaddy(base)).equals(Buffer.from(renderCaddy(disabled))),
  'Caddyfile is byte-identical when disabled OpenFlux state is present');

const reality = {
  port: 8444, serverName: 'www.example.com', target: 'www.example.com:443',
  privateKey: 'A'.repeat(43), publicKey: 'B'.repeat(43), shortId: 'a1b2c3d4',
};
const vlessUsers = [{ id: '550e8400-e29b-41d4-a716-446655440000', email: 'golden-user' }];
const renderXray = cfg => JSON.stringify(buildXrayRealityConfig(reality, vlessUsers,
  cfg.stack.vlessXhttp ? cfg.vlessXhttp : null), null, 2);
ok(Buffer.from(renderXray(base)).equals(Buffer.from(renderXray(disabled))),
  'Xray config is byte-identical when disabled OpenFlux state is present');

const sandbox = {
  cfg: { ...base, stack: { ...base.stack } }, getAllUsers: () => users,
  encodeURIComponent, parseInt, Number, String, Array, Date, JSON, Buffer, Set,
  crypto: require('crypto'), console,
  pickMieruPort: (requested, start) => Number.isInteger(Number(requested)) ? Number(requested) : start,
  xrayInstalled: () => false,
};
vm.createContext(sandbox);
for (const name of [
  'measuredUsageMB', 'userAccessState', 'userAccessActive', 'getStableTrafficSeed',
  'buildTrafficPattern', 'buildMitaStateContent', 'yamlQuote', 'buildHy2AuthBlock',
  'normalizeBonusLinks', 'parseUserRow', 'applyServerFlag', 'buildMierusLink',
  'buildHy2Link', 'buildShadowrocketHttpsLink', 'buildUserUris',
]) vm.runInContext(extractFn(name), sandbox);
sandbox.__user = users[0];
function renderCore() {
  return {
    mieru: vm.runInContext('buildMitaStateContent()', sandbox),
    hy2: vm.runInContext('buildHy2AuthBlock(getAllUsers())', sandbox),
    subscription: vm.runInContext('buildUserUris(__user, {})', sandbox).join('\n'),
  };
}
const before = renderCore();
sandbox.cfg.openflux = { enabled: false };
const after = renderCore();
for (const key of ['mieru', 'hy2', 'subscription']) {
  ok(Buffer.from(before[key]).equals(Buffer.from(after[key])),
    `${key} output is byte-identical with disabled OpenFlux state`);
}

const coreSlices = [caddy.render.toString(), buildXrayRealityConfig.toString(),
  ...['buildMitaStateContent', 'buildHy2AuthBlock', 'buildUserUris'].map(extractFn)].join('\n');
ok(!/openflux/i.test(coreSlices), 'core generators contain no OpenFlux branch or dependency');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
