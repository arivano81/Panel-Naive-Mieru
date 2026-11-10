#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'panel/scripts/update_xray_binary.sh'), 'utf8');
let passed = 0;
function ok(value, message) { if (!value) throw new Error(message); console.log('  ✓', message); passed++; }

ok(script.includes('run -test -config "$CONFIG"'), 'candidate validates the existing production config');
ok(script.indexOf('sha256sum -c --status') < script.indexOf('mv "${BIN}.new" "$BIN"'),
  'checksum verification precedes binary replacement');
ok(script.includes('cp -a "$BIN" "$BACKUP/xray"') && script.includes('rollback'),
  'current binary is backed up and rollback is defined');
ok(!script.includes('x25519') && !script.includes('PRIVATE_KEY') && !script.includes('SHORT_ID'),
  'binary update cannot rotate REALITY identity');
ok(script.includes("'.components.vless.version = $version'") && script.includes("'.version = $version'"),
  'successful update synchronizes public metadata and component registry');
ok(script.includes("die 'metadata update failed; previous binary and metadata restored'"),
  'metadata failure rolls the binary and metadata back together');
ok(script.includes('INSTALLER="$SCRIPT_DIR/install_xray.sh"'),
  'pin lookup works in both source and deployed script directories');
ok(script.includes('REGISTRY=/etc/rixxx-panel/components.json'),
  'update uses the active component registry');
ok(!/systemctl (restart|stop|start) (caddy-naive|mita|hysteria-server)/.test(script),
  'update can address only Xray');

console.log(`\nResult: ${passed} passed`);
