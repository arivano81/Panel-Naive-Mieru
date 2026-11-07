'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const install = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const recovery = fs.readFileSync(path.join(root, 'panel', 'scripts', 'recover_access.sh'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

let passed = 0;
let failed = 0;
function ok(condition, message) {
  if (condition) { console.log(`  ✓ ${message}`); passed++; }
  else { console.error(`  ✗ ${message}`); failed++; }
}

console.log('Debian 13 + access recovery regression test');

ok(/11\|12\|13\)\s+log_info/.test(install), 'installer accepts Debian 13');
ok(/ADMIN_REPORT="\/root\/vertaflux-install-report\.txt"/.test(install), 'root-only report has a stable path');
const mainBlock = install.slice(install.indexOf('main() {'));
ok(mainBlock.indexOf('write_admin_report "installation in progress"') < mainBlock.indexOf('write_config_json'),
  'credentials are saved before service configuration can fail');
ok(/chmod 600 "\$ADMIN_REPORT"/.test(install), 'installation report is mode 600');
ok(/adminPassHash = bcrypt\.hashSync/.test(recovery), 'recovery script resets the panel bcrypt password');
ok(/api\/panel\/external-access/.test(recovery), 'recovery script resets HTTP Basic Auth through the panel API');
ok(/cp -a "\$CONFIG" "\$BACKUP"/.test(recovery), 'recovery script backs up config before changing it');
ok(/Debian \| 11, 12, 13/.test(readme), 'README documents Debian 13');
ok(/recover_access\.sh/.test(readme), 'README documents the recovery command');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
