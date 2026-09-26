#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyMultiFileTransaction } = require('../panel/server/multiFileTransaction');

let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rixxx-multi-'));
const a = path.join(dir, 'xray.json');
const b = path.join(dir, 'Caddyfile');
fs.writeFileSync(a, 'old-xray');
fs.writeFileSync(b, 'old-caddy');

let applied = [];
let result = applyMultiFileTransaction({ items: [
  { targetPath: a, content: 'new-xray', validate: () => true, apply: () => { applied.push('xray'); return true; } },
  { targetPath: b, content: 'new-caddy', validate: () => true, apply: () => { applied.push('caddy'); return true; } },
] });
ok(result.ok && fs.readFileSync(a, 'utf8') === 'new-xray' && fs.readFileSync(b, 'utf8') === 'new-caddy',
  'both validated files commit together');
ok(applied.join(',') === 'xray,caddy', 'services apply in dependency order');

fs.writeFileSync(a, 'stable-xray');
fs.writeFileSync(b, 'stable-caddy');
applied = [];
result = applyMultiFileTransaction({ items: [
  { targetPath: a, content: 'bad-xray', validate: () => true,
    apply: () => { applied.push('xray-new'); return true; }, rollbackApply: () => { applied.push('xray-old'); return true; } },
  { targetPath: b, content: 'bad-caddy', validate: () => true,
    apply: () => ({ ok: false, error: 'caddy refused config' }),
    rollbackApply: () => { applied.push('caddy-old'); return true; } },
] });
ok(!result.ok && result.rolledBack, 'second service failure triggers a full rollback');
ok(fs.readFileSync(a, 'utf8') === 'stable-xray' && fs.readFileSync(b, 'utf8') === 'stable-caddy',
  'rollback restores both original files');
ok(applied.includes('caddy-old') && applied.includes('xray-old'), 'both old services are reapplied');

fs.writeFileSync(a, 'safe-xray');
result = applyMultiFileTransaction({ items: [
  { targetPath: a, content: 'candidate-xray', validate: () => true },
  { targetPath: b, content: 'candidate-caddy', validate: () => ({ ok: false, error: 'invalid caddy' }) },
] });
ok(!result.ok && result.phase === 'validate' && fs.readFileSync(a, 'utf8') === 'safe-xray',
  'all candidates validate before any live file changes');

fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
