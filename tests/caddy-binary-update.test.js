#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const script = fs.readFileSync(path.join(__dirname, '../panel/scripts/update_caddy_binary.sh'), 'utf8');
let passed = 0;
function ok(value, message) { if (!value) throw new Error(message); console.log('  ✓', message); passed++; }

ok(script.includes('validate --config "$CONFIG" --adapter caddyfile'), 'candidate validates the production Caddyfile');
ok(script.includes("grep -Fx 'http.handlers.forward_proxy'"), 'candidate must contain the forward_proxy module');
ok(script.indexOf('sha256sum -c --status') < script.indexOf('mv "${BIN}.new" "$BIN"'),
  'checksum verification precedes binary replacement');
ok(script.includes('cp -a "$BIN" "$BACKUP/caddy-naive"') && script.includes('rollback'),
  'current binary is backed up and rollback is defined');
ok(script.includes("setcap 'cap_net_bind_service=+ep'"), 'replacement and rollback retain privileged-port capability');
ok(!/systemctl (restart|stop|start) (mita|hysteria-server|xray)/.test(script), 'update can address only Caddy');
ok(script.includes("'.components.caddyNaive.version = $version'"), 'successful update synchronizes component metadata');

console.log(`\nResult: ${passed} passed`);
