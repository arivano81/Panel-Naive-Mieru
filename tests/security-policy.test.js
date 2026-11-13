#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const policy = fs.readFileSync(path.join(root, 'SECURITY.md'), 'utf8');
const english = fs.readFileSync(path.join(root, 'SECURITY.en.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
let passed = 0;
let failed = 0;
function ok(value, message) {
  if (value) { passed++; console.log('  ✓', message); }
  else { failed++; console.error('  ✗', message); }
}

console.log('Security policy regression test');
ok(/Security → Advisories → Report a vulnerability/.test(policy),
  'private vulnerability reporting channel is explicit');
ok(/Не публикуйте[\s\S]*учётные данные[\s\S]*приватные ключи/i.test(policy),
  'public secret disclosure is explicitly prohibited');
ok(/SSH-only\/loopback/.test(policy) && /Смените пароль панели/.test(policy),
  'administrator containment and credential rotation are actionable');
ok(/нельзя незаметно переиспользовать или подменять/.test(policy),
  'revocation cannot silently replace a compromised release');
ok(/удалить загружаемые артефакты/.test(policy) && /новую версию с новыми контрольными суммами/.test(policy),
  'release revocation covers artifacts and replacement checksums');
ok(readme.includes('[SECURITY.md](SECURITY.md)'), 'README exposes the security policy');
ok(/# Политика безопасности/.test(policy) && /# Security policy/.test(english),
  'Russian policy is primary and the English translation is available');
ok(english.includes('Security → Advisories → Report a vulnerability') &&
   english.includes('never silently') && /new\s+version with new checksums/.test(english),
  'English policy preserves the reporting and revocation contract');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
