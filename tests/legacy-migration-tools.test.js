#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const inventory = fs.readFileSync(path.join(root, 'scripts/inventory-legacy-mieru.sh'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'scripts/backup-legacy-mieru.sh'), 'utf8');

const checks = [
  [inventory.includes('mita describe config'), 'inventory reads live Mita state'],
  [inventory.includes('users.count=') && !inventory.includes('print(user.get("password"'),
    'inventory reports users without printing passwords'],
  [inventory.includes('portBindings=') && inventory.includes('ss -H -lntup'),
    'inventory captures bindings and listening sockets'],
  [backup.includes('mita describe config >"$stage/mita-config.json"'),
    'backup preserves the exact active Mita config'],
  [backup.includes('sha256sum -c "$archive.sha256"'), 'backup verifies its archive checksum'],
  [backup.includes('systemctl cat') && backup.includes('nft list ruleset'),
    'backup preserves service and firewall recovery data'],
  [backup.includes('Refusing to overwrite'), 'backup never overwrites an existing archive'],
];

let failed = 0;
for (const [ok, label] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
