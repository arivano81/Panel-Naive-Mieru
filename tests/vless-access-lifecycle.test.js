#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  let i = source.indexOf('{', start), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`function not found: ${name}`);
}

console.log('VLESS access lifecycle regression test');
const sandbox = { Date, Number, Math };
vm.createContext(sandbox);
vm.runInContext(extract('measuredUsageMB'), sandbox);
vm.runInContext(extract('userAccessState'), sandbox);
vm.runInContext(extract('userAccessActive'), sandbox);
ok(sandbox.userAccessActive({ expiry: null }, 1000), 'no expiry remains active');
ok(sandbox.userAccessActive({ expiry: '2030-01-01T00:00:00.000Z' }, Date.parse('2029-01-01T00:00:00Z')),
  'future expiry remains active');
ok(!sandbox.userAccessActive({ expiry: '2020-01-01T00:00:00.000Z' }, Date.parse('2021-01-01T00:00:00Z')),
  'past expiry is suspended');
ok(sandbox.measuredUsageMB({ usedMB: 2, vlessUploadBytes: 1048576, vlessDownloadBytes: 2097152 }) === 5,
  'common measured usage adds non-VLESS and durable VLESS traffic once');
ok(!sandbox.userAccessActive({ quotaMB: 5, usedMB: 2, vlessUploadBytes: 1048576,
  vlessDownloadBytes: 2097152 }), 'quota boundary suspends access');
ok(sandbox.userAccessActive({ quotaMB: 6, usedMB: 2, vlessUploadBytes: 1048576,
  vlessDownloadBytes: 2097152 }), 'raising quota restores access');
ok(sandbox.userAccessActive({ quotaMB: 0, usedMB: 999999 }), 'zero quota remains unlimited');
ok(source.includes('users.filter(userAccessActive).filter'), 'Naive excludes suspended users');
ok(source.includes('allUsers.filter(userAccessActive).filter'), 'Mieru excludes suspended users');
ok((source.match(/\.filter\(userAccessActive\)/g) || []).length >= 4,
  'Naive, Mieru, Hy2 and VLESS share the expiry gate');
const cron = source.slice(source.indexOf('// ── Access-policy cron'), source.indexOf('// ── Traffic snapshot cron'));
ok(!cron.includes('deleteUser('), 'policy suspension never destroys the user record');
ok(cron.includes('applyAllConfigsAsync()'), 'policy transition rebuilds every installed protocol');
ok(cron.includes('Restoring user after policy change'), 'renewal/quota increase is observable and reapplied');
ok(source.includes('Math.max(Number(u.usedMB) || 0, s.usedMB || 0)'),
  'runtime counter reset cannot lower persisted measured usage');
ok(source.includes('hy2 = readHy2Traffic()'), 'traffic snapshot includes measured Hy2 usage');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
