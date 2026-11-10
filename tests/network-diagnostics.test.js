#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { checkDnsTls, diagnosticTargets } = require('../panel/server/networkDiagnostics');

const config = { domain: 'vpn.example.com', serverIp: '203.0.113.10', naivePort: 443,
  exposePanel: true, panelDomain: 'panel.example.com', subBaseUrl: 'https://sub.example.com/sub/' };
assert.deepStrictEqual(diagnosticTargets(config).map(item => item.host),
  ['vpn.example.com', 'panel.example.com', 'sub.example.com']);

const resolver = {
  resolve4: async host => host === 'sub.example.com' ? ['198.51.100.20'] : ['203.0.113.10'],
  resolve6: async () => [],
};
(async () => {
  const result = await checkDnsTls(config, { resolver,
    tlsProbe: async host => ({ ok: host !== 'panel.example.com', daysRemaining: 42,
      error: host === 'panel.example.com' ? 'CERT_HAS_EXPIRED' : null }) });
  assert(result[0].dnsOk && result[0].certificate.ok, 'matching DNS and valid certificate pass');
  assert(!result[1].certificate.ok, 'certificate failure is reported without throwing');
  assert(!result[2].dnsOk, 'DNS pointing away from the configured server is reported');

  const root = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'panel/server/index.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'panel/public/app.js'), 'utf8');
  assert(server.includes('report.network = await checkDnsTls(cfg)') &&
    server.includes("app.get('/api/diagnostics', requireAuth, async"), 'shared diagnostics include the read-only network check');
  assert(ui.includes("el('diag-network')") && ui.includes('item.dnsOk && item.certificate?.ok'),
    'diagnostics UI displays combined DNS and certificate health');
  console.log('DNS and TLS diagnostics regression test passed');
})().catch(error => { console.error(error); process.exit(1); });
