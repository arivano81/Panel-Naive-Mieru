#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
let passed = 0, failed = 0;
function ok(value, message) {
  if (value) { passed++; console.log('  ✓', message); }
  else { failed++; console.error('  ✗', message); }
}

console.log('Current sing-box universal-config compatibility test');
const start = source.indexOf('function buildSingboxConfig(user, opts = {})');
const end = source.indexOf("\napp.get('/api/users/:id/config/hy2'", start);
const builder = source.slice(start, end);
ok(start > 0 && end > start, 'universal config builder is located');
ok(builder.includes("servers: [{ type: 'local', tag: 'local' }]") &&
   !builder.includes("address: 'tls://") && !builder.includes("address: 'https://"),
  'DNS uses the typed 1.14 server schema, not removed legacy addresses');
ok(!builder.includes("type: 'dns'") && !builder.includes("protocol: 'dns'"),
  'removed DNS outbound and legacy DNS route interception are absent');
ok(!builder.includes('geoip:') && !builder.includes('geosite:'),
  'removed built-in GeoIP and Geosite fields are absent');
ok(builder.includes("ip_is_private: true, action: 'route', outbound: 'direct'"),
  'private addresses retain an explicit modern direct-route action');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
