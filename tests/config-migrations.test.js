#!/usr/bin/env node
'use strict';

const { LATEST_CONFIG_SCHEMA, runConfigMigrations } = require('../panel/server/configMigrations');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('Explicit config migration regression test');
const legacy = { domain: 'vpn.example.test', customOperatorField: { keep: true }, exposePanel: false };
const result = runConfigMigrations(legacy, { logger: { log() {} } });
ok(result.from === 0 && result.to === LATEST_CONFIG_SCHEMA, 'legacy config migrates through every version');
ok(legacy.schemaVersion === LATEST_CONFIG_SCHEMA, 'schemaVersion persisted in object');
ok(legacy.stack.naive && legacy.stack.mieru && !legacy.stack.hy2, 'new protocols stay opt-in');
ok(legacy.exposePanel === false, 'explicit false setting is preserved');
ok(legacy.customOperatorField.keep === true, 'unknown operator fields are preserved');
ok(Array.isArray(legacy.federationNodes), 'new collection fields receive safe defaults');
ok(legacy.warpPersist === false, 'dangerous boot persistence defaults off');
ok(legacy.stack.vless === false && legacy.vlessPort === 8443, 'VLESS remains opt-in on upgrade');

const second = runConfigMigrations(legacy, { logger: { log() {} } });
ok(!second.changed && second.applied.length === 0, 'migration is idempotent');

let futureRejected = false;
try { runConfigMigrations({ schemaVersion: LATEST_CONFIG_SCHEMA + 1 }, { logger: { log() {} } }); }
catch (error) { futureRejected = /newer than supported/.test(error.message); }
ok(futureRejected, 'unknown future config schema is refused');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
