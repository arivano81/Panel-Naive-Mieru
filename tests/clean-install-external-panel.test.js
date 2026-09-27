'use strict';

const fs = require('fs');
const path = require('path');

const install = fs.readFileSync(path.join(__dirname, '..', 'install.sh'), 'utf8');
const update = fs.readFileSync(path.join(__dirname, '..', 'update.sh'), 'utf8');
const uninstall = fs.readFileSync(path.join(__dirname, '..', 'uninstall.sh'), 'utf8');

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

console.log('Clean-install external panel regression test');

const mainAt = install.indexOf('main() {');
const main = install.slice(mainAt);
const installPanelAt = main.indexOf('\n  install_panel\n');
const caddyAt = main.indexOf('\n  write_caddyfile\n');
const configAt = main.indexOf('\n  write_config_json\n');
ok(installPanelAt > 0 && installPanelAt < caddyAt,
  'canonical panel template is installed before the first Caddyfile render');
ok(installPanelAt < configAt, 'bcryptjs remains installed before config generation');
ok(install.includes('! grep -Fq "${PANEL_DOMAIN} {" <<<"$caddyfile_content"'),
  'an exposed clean install fails closed when the panel block is absent');
ok(install.includes('systemctl enable --now pm2-root'),
  'installer starts and enables the PM2 systemd unit');
ok(install.includes('systemctl is-active pm2-root'),
  'installer verifies the PM2 systemd unit reached active');
ok(/setup_panel_stub\(\)[\s\S]*?chmod 755 "\$PANEL_STUB_DIR"/.test(install),
  'clean install makes the panel stub directory traversable by Caddy');
ok(/ensure_panel_stub\(\)[\s\S]*?chmod 755 "\$dir"/.test(update),
  'repair fixes existing restrictive panel stub directory permissions');
ok(uninstall.includes('rm -rf /var/www/panel-stub'),
  'uninstall removes the panel stub artifact');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
