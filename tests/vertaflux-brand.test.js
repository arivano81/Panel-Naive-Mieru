#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const files = ['install.sh', 'update.sh', 'uninstall.sh', 'panel/scripts/install_hysteria.sh',
  'panel/scripts/recover_access.sh', 'panel/scripts/warp_egress.sh', 'panel/public/index.html',
  'README.md', 'README.en.md'];
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('VertaFlux identity regression test');
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  ok(!/by RIXXX|RIXXX PANEL|Panel Naive \+ Mieru by RIXXX/i.test(source),
    `${file} has no former-project display name`);
  ok(!/russian_paradice_vpn|app\.lava\.top\/2107724612/i.test(source),
    `${file} has no unrelated support or donation links`);
}
const totp = fs.readFileSync(path.join(root, 'panel/server/totp.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'panel/server/index.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'panel/public/app.js'), 'utf8');
ok(totp.includes("issuer = 'VertaFlux'"), 'new TOTP entries use the VertaFlux issuer');
ok(server.includes('│              VERTAFLUX               │') &&
   !server.includes('██████╗  ██╗ ██╗  ██╗'), 'startup banner uses the VertaFlux identity');
ok(app.includes("localStorage.setItem('vertaflux-theme'") &&
   app.includes("localStorage.getItem('rixxx-theme')"),
  'browser preferences use the new name while reading the legacy key');
const install = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const update = fs.readFileSync(path.join(root, 'update.sh'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'panel/server/backupRestore.js'), 'utf8');
ok(install.includes('/var/log/vertaflux-install.log') &&
   update.includes('PANEL_CONFIG="/etc/vertaflux/config.json"'),
  'new installation and update artifacts use canonical VertaFlux names');
ok(backup.includes("const BACKUP_FORMAT = 'vertaflux-backup'") &&
   backup.includes('LEGACY_BACKUP_FORMAT'), 'new backups are branded while legacy imports remain supported');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
ok((readme.match(/Родительский проект/g) || []).length === 1,
  'README retains exactly one attribution link to the parent project');
ok(readme.includes('docs/assets/vertaflux-banner.svg'), 'README uses the VertaFlux project banner');
const banner = fs.readFileSync(path.join(root, 'docs/assets/vertaflux-banner.svg'), 'utf8');
ok(/ONE CONTROL PLANE · MULTIPLE ROUTES<\/text>/.test(banner) &&
   /textLength="324"/.test(banner), 'banner slogan is constrained to the control-plane frame');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
