#!/usr/bin/env node
'use strict';

const { compareVersions, createUpdateChecker } = require('../panel/server/updateCheck');
const assert = require('assert');

assert.strictEqual(compareVersions('1.20.0', '1.19.9'), 1);
assert.strictEqual(compareVersions('v1.19.0', '1.19.0'), 0);
assert.strictEqual(compareVersions('1.18.9', '1.19.0'), -1);
assert.strictEqual(compareVersions('unsafe', '1.19.0'), 0);

(async () => {
  let calls = 0;
  const check = createUpdateChecker({ token: 'secret', fetchVersion: async token => {
    assert.strictEqual(token, 'secret'); calls++; return '1.20.0';
  }, now: () => 1000 });
  assert.deepStrictEqual(await check('1.19.0'), {
    checked: true, currentVersion: '1.19.0', latestVersion: '1.20.0', updateAvailable: true,
  });
  await check('1.19.0');
  assert.strictEqual(calls, 1, 'successful checks are cached');

  const unavailable = createUpdateChecker({ token: '', fetchVersion: async () => { throw new Error('private'); } });
  assert.strictEqual((await unavailable('1.19.0')).reason, 'token-required');
  console.log('Update availability check regression test passed');
})().catch(error => { console.error(error); process.exit(1); });
