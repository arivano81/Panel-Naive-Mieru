'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const install = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const update = fs.readFileSync(path.join(root, 'update.sh'), 'utf8');
const checksum = '19eccb7321dd877a5fb4a3dba6ef1b745185188b616c96cc6201f1a1fc0380a8';

let passed = 0;
let failed = 0;
function ok(condition, description) {
  if (condition) {
    console.log(`  \u2713 ${description}`);
    passed += 1;
  } else {
    console.error(`  \u2717 ${description}`);
    failed += 1;
  }
}

console.log('Caddy Naive dependency supply-chain regression test');

for (const [name, source] of Object.entries({ install, update })) {
  ok(source.includes('CADDY_NAIVE_VERSION="v2.11.2-naive"'), `${name} pins the reviewed release`);
  ok(source.includes(checksum), `${name} pins the reviewed archive checksum`);
  ok(!source.includes('repos/klzgrad/forwardproxy/releases/latest'), `${name} never resolves latest`);
  const checksumAt = source.indexOf('actual_sha=$(sha256sum', source.indexOf('caddy'));
  const installAt = source.indexOf('install -m 755 "$caddy_found"', checksumAt);
  ok(checksumAt > 0 && installAt > checksumAt, `${name} verifies SHA-256 before binary installation`);
  ok(source.slice(checksumAt, installAt).includes('Caddy SHA-256 mismatch'),
    `${name} fails explicitly on a checksum mismatch`);
}

const stopAt = update.indexOf('systemctl stop caddy-naive', update.indexOf('update_caddy_naive()'));
const checksumAt = update.indexOf('actual_sha=$(sha256sum', update.indexOf('update_caddy_naive()'));
ok(stopAt > checksumAt, 'updater leaves the running service untouched until verification succeeds');
ok(!/\bcd "\$tmp_dir"/.test(update), 'updater does not change the caller working directory');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
