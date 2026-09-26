#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyFileTransaction } = require('../panel/server/fileTransaction');

let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'file-tx-'));
const target = path.join(tmp, 'service.conf');

console.log('Transactional file apply regression test');

console.log('\n[1] successful transaction keeps new content and backup');
fs.writeFileSync(target, 'old');
let result = applyFileTransaction({
  targetPath: target,
  content: 'new',
  validate: file => ({ ok: fs.readFileSync(file, 'utf8') === 'new' }),
  apply: () => ({ ok: true }),
  health: () => ({ ok: true }),
});
ok(result.ok, 'transaction completed');
ok(fs.readFileSync(target, 'utf8') === 'new', 'new config is active');
ok(fs.readFileSync(target + '.last-good', 'utf8') === 'old', 'previous config is retained');

console.log('\n[2] validation failure never replaces the target');
fs.writeFileSync(target, 'known-good');
result = applyFileTransaction({
  targetPath: target,
  content: 'invalid',
  validate: () => ({ ok: false, error: 'bad syntax' }),
});
ok(!result.ok && result.phase === 'validate', 'validation failure is reported');
ok(fs.readFileSync(target, 'utf8') === 'known-good', 'target remains byte-identical');
ok(!fs.existsSync(target + '.new'), 'temporary file is removed');

console.log('\n[3] failed apply restores and reapplies the old config');
let applyCalls = 0;
result = applyFileTransaction({
  targetPath: target,
  content: 'breaks-service',
  validate: () => ({ ok: true }),
  apply: () => { applyCalls++; return { ok: false, error: 'service failed' }; },
  rollbackApply: () => { applyCalls++; return { ok: true }; },
});
ok(!result.ok && result.rolledBack, 'failed service apply is rolled back');
ok(fs.readFileSync(target, 'utf8') === 'known-good', 'old config restored');
ok(applyCalls === 2, 'service apply called once for new and once for restored config');

console.log('\n[4] failed first install removes the newly-created target');
const fresh = path.join(tmp, 'fresh.conf');
result = applyFileTransaction({
  targetPath: fresh,
  content: 'new-install',
  apply: () => ({ ok: true }),
  health: () => ({ ok: false, error: 'not healthy' }),
  rollbackApply: () => ({ ok: true }),
});
ok(!result.ok && result.rolledBack, 'first-install health failure is rolled back');
ok(!fs.existsSync(fresh), 'failed new target is removed');

console.log('\n[5] post-write permission failure restores the old target');
fs.writeFileSync(target, 'known-good');
applyCalls = 0;
let permissionCalls = 0;
result = applyFileTransaction({
  targetPath: target,
  content: 'candidate',
  afterWrite: () => {
    permissionCalls++;
    if (permissionCalls === 1) throw new Error('chmod failed');
  },
  apply: () => { applyCalls++; return true; },
  rollbackApply: () => true,
});
ok(!result.ok && result.rolledBack, 'permission failure triggers rollback');
ok(fs.readFileSync(target, 'utf8') === 'known-good', 'old target is restored');
ok(applyCalls === 0, 'candidate is not applied after permission failure');

console.log('\n[6] two previous working generations are retained');
const retained = path.join(tmp, 'retained.conf');
fs.writeFileSync(retained, 'v1');
for (const content of ['v2', 'v3', 'v4']) {
  result = applyFileTransaction({ targetPath: retained, content });
  ok(result.ok, `${content} applied`);
}
ok(fs.readFileSync(retained, 'utf8') === 'v4', 'latest content is active');
ok(fs.readFileSync(retained + '.last-good', 'utf8') === 'v3', 'last-good keeps generation v3');
ok(fs.readFileSync(retained + '.previous-good', 'utf8') === 'v2', 'previous-good keeps generation v2');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
