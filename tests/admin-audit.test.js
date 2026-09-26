#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'panel/server/index.js'), 'utf8');
const migrations = fs.readFileSync(path.join(root, 'panel/server/databaseMigrations.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'panel/public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'panel/public/app.js'), 'utf8');
const ru = JSON.parse(fs.readFileSync(path.join(root, 'panel/public/locales/ru.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(root, 'panel/public/locales/en.json'), 'utf8'));

let passed = 0;
let failed = 0;
function ok(value, message) {
  if (value) { passed++; console.log('  ✓', message); }
  else { failed++; console.error('  ✗', message); }
}

console.log('Administrator audit regression test');
ok(/version:\s*7[\s\S]*administrator audit log/.test(migrations),
  'audit storage has an explicit ordered schema migration');
ok(migrations.includes('CREATE TABLE IF NOT EXISTS admin_audit') &&
   migrations.includes('idx_admin_audit_ts'),
  'audit table and timestamp index are idempotently enforced');
ok(server.includes("!req.session?.authenticated") && server.includes("res.once('finish'") &&
   server.includes('INSERT INTO admin_audit'),
  'authenticated mutations are persisted after the final HTTP status is known');
ok(server.includes("['GET', 'HEAD', 'OPTIONS'].includes(method)"),
  'safe read methods are excluded from the action log');
ok(!/INSERT INTO admin_audit[\s\S]{0,500}req\.body/.test(server) &&
   server.includes("path: String(req.path || '/')"),
  'audit records route paths but never request bodies or query strings');
ok(server.includes('ADMIN_AUDIT_LIMIT = 10000') &&
   server.includes('ORDER BY id DESC LIMIT ?'),
  'retention is bounded to the newest 10000 events');
ok(server.includes("service === 'audit'") && server.includes('FROM admin_audit ORDER BY id DESC LIMIT ?'),
  'authenticated Logs API exposes a bounded audit view');
ok(html.includes('data-log-svc="audit"') && app.includes("'panel', 'audit'"),
  'Logs page has a dedicated Audit selector');
ok(ru.logs.audit && en.logs.audit && ru.logs.lines1000 && en.logs.lines1000,
  'Russian and English audit controls stay in parity');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
