'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = {
  install: fs.readFileSync(path.join(root, 'install.sh'), 'utf8'),
  update: fs.readFileSync(path.join(root, 'update.sh'), 'utf8'),
  cascade: fs.readFileSync(path.join(root, 'panel', 'scripts', 'cascade_mieru.sh'), 'utf8'),
};

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

console.log('Mieru dependency supply-chain regression test');

for (const [name, source] of Object.entries(files)) {
  ok(source.includes('MIERU_VERSION="3.38.0"'), `${name} pins Mieru 3.38.0`);
  ok(!source.includes('repos/enfein/mieru/releases/latest'), `${name} does not resolve Mieru through latest`);
}

ok(files.install.includes('5170555aace38f76862541587b632d61848bba12f2e845b057977c9f9257e59a'),
  'clean install pins the official amd64 mita checksum');
ok(files.update.includes('63f377deb6355682a0b5e060c5ee3e0838a5f879afa4c2905bd20a692728903c'),
  'updater pins the official arm64 mita checksum');
ok(files.cascade.includes('648e382183eb87480c5ac52726f0417a2fd970cf79831d00137bf7bc4798abae'),
  'cascade pins the official amd64 mieru-client checksum');
ok(files.cascade.includes('7dc6dcd8f1dca9ee97c71dbc98d28d87d25b3e6c3dd0562c64614f0d95001be9'),
  'cascade pins the official arm64 mieru-client checksum');

for (const [name, source] of Object.entries(files)) {
  const checksumAt = source.indexOf('actual_sha=$(sha256sum');
  const installAt = source.indexOf('dpkg -i', checksumAt);
  ok(checksumAt > 0 && installAt > checksumAt, `${name} verifies SHA-256 before dpkg`);
  ok(source.slice(checksumAt, installAt).includes('SHA-256 mismatch'),
    `${name} fails explicitly on a checksum mismatch`);
}

const stopAt = files.update.indexOf('systemctl stop mita', files.update.indexOf('update_mieru()'));
const updateChecksumAt = files.update.indexOf('actual_sha=$(sha256sum', files.update.indexOf('update_mieru()'));
ok(stopAt > updateChecksumAt, 'updater leaves the running service untouched until verification succeeds');
ok(files.update.includes('No pinned Mita asset for $DEB_ARCH'), 'updater fails closed on an unpinned architecture');
ok(files.cascade.includes('unsupported arch: $(uname -m)'), 'cascade fails closed on an unpinned architecture');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
