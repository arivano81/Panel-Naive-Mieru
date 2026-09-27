'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'panel', 'scripts', 'install_hysteria.sh'), 'utf8');

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

console.log('Hysteria2 dependency supply-chain regression test');

ok(script.includes('HY_VERSION="app/v2.12.3"'), 'Hysteria2 release is pinned');
ok(!script.includes('releases/latest'), 'installer never resolves latest');
ok(!script.includes('releases/download/app/v2.5.2'), 'installer has no legacy release fallback');
ok(script.includes('8c7a68a906998b747a0db87586e364f995fbfddb95693ae6e2fdb68a6e920d3e'),
  'amd64 checksum is pinned');
ok(script.includes('c8dc653c3ba0a28d29a26b8fa52d2086f27c0927afddce95c09965e7174e78b0'),
  'arm64 checksum is pinned');
ok(script.includes('cc4bc596c2db473dd7ec1bbcc3cd10e0cb60302759facd95e0be73bc8751e110'),
  'armv7 checksum is pinned');
const pinnedChecksums = [...script.matchAll(/HY_SHA256="([0-9a-f]+)"/g)].map(match => match[1]);
ok(pinnedChecksums.length === 3 && pinnedChecksums.every(checksum => /^[0-9a-f]{64}$/.test(checksum)),
  'every architecture checksum is exactly 64 lowercase hexadecimal characters');
ok(script.includes('unsupported architecture for Hysteria2'), 'unknown architectures fail closed');

const downloadAt = script.indexOf('wget -q --timeout=120');
const checksumAt = script.indexOf('HY_ACTUAL_SHA=$(sha256sum');
const smokeAt = script.indexOf('"$HY_CANDIDATE" version');
const installAt = script.indexOf('install -m 0755 "$HY_CANDIDATE"');
const replaceAt = script.indexOf('mv -f /usr/local/bin/hysteria.new');
ok(downloadAt > 0 && checksumAt > downloadAt, 'download is verified by SHA-256');
ok(smokeAt > checksumAt && installAt > smokeAt, 'candidate passes an identity smoke-test before install');
ok(replaceAt > installAt, 'verified candidate is atomically renamed into place');
ok(!/wget[^\n]+-O \/usr\/local\/bin\/hysteria\b/.test(script),
  'network download never writes over the live binary');
ok(!fs.existsSync(path.join(root, 'panel', 'scripts', 'install_naiveproxy.sh')) &&
   !fs.existsSync(path.join(root, 'panel', 'scripts', 'install_mieru.sh')),
  'unused duplicate unverified installers are absent');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
