#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const install = fs.readFileSync(path.join(__dirname, '..', 'install.sh'), 'utf8');
const update = fs.readFileSync(path.join(__dirname, '..', 'update.sh'), 'utf8');
let passed = 0;
let failed = 0;
function ok(value, message) {
  if (value) { passed++; console.log('  ✓', message); }
  else { failed++; console.error('  ✗', message); }
}

console.log('Bundled private source working-directory regression test');
const caddyStart = install.indexOf('install_caddy_naive()');
const caddyEnd = install.indexOf('\n# ── Mieru', caddyStart);
const caddy = install.slice(caddyStart, caddyEnd);
const panelStart = install.indexOf('install_panel()');
const panelEnd = install.indexOf('\n# ── config.json', panelStart);
const panel = install.slice(panelStart, panelEnd);

ok(caddy.includes('tar -C "$tmp_dir"'), 'Caddy archive extraction is directory-scoped');
ok(!/^\s*cd\s+(?:"?\$tmp_dir"?|\/)(?:\s|$)/m.test(caddy),
  'Caddy installation cannot change the caller working directory');
ok(panel.includes('script_dir/panel') && panel.includes('PWD/panel'),
  'panel installation retains both bundled source discovery paths');
ok(caddyStart < panelStart, 'regression covers the production install order');
ok(!/\(\(\s*[A-Za-z_][A-Za-z0-9_]*\+\+\s*\)\)/.test(install + update),
  'set -e production scripts contain no zero-valued postfix increments');
ok(/curl wget git ufw unzip tar xz-utils jq sqlite3/.test(install),
  'clean install provides the SQLite CLI required by doctor diagnostics');
const caddyUnitStart = install.indexOf('cat > /etc/systemd/system/caddy-naive.service <<SVCCADDY');
const caddyUnitEnd = install.indexOf('\nSVCCADDY', caddyUnitStart);
const caddyUnit = install.slice(caddyUnitStart, caddyUnitEnd);
ok(caddyUnitStart > 0 && !/`[^`]+`/.test(caddyUnit),
  'unquoted Caddy unit heredoc cannot execute command substitutions from comments');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
