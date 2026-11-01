#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { runConfigMigrations } = require('../panel/server/configMigrations');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const install = read('install.sh');
const server = read('panel/server/index.js');
const html = read('panel/public/index.html');
const app = read('panel/public/app.js');

let passed = 0, failed = 0;
function ok(condition, message) {
  if (condition) { console.log('  ✓', message); passed++; }
  else { console.error('  ✗', message); failed++; }
}

console.log('First-run onboarding regression test');
const upgraded = runConfigMigrations({ schemaVersion: 9 }, { logger: { log() {} } }).config;
const fresh = runConfigMigrations({ onboardingComplete: false }, { logger: { log() {} } }).config;

ok(upgraded.onboardingComplete === true, 'upgrades do not show onboarding unexpectedly');
ok(fresh.onboardingComplete === false, 'fresh install keeps onboarding pending');
ok(/onboardingComplete:\s*false/.test(install), 'clean installer marks onboarding pending');
ok(server.includes("req.body.onboardingComplete !== true"), 'API completion flag is one-way and boolean');
ok(server.includes("'federationToken','federationNodes','onboardingComplete'"), 'API persists completion');
ok(/mutation responses deliberately content-free[\s\S]*?res\.json\(\{ ok: true \}\)/.test(server),
  'config mutation response never echoes stored secrets');
ok(html.includes('id="onboarding-modal"') && /aria-modal="true"/.test(html), 'accessible wizard dialog exists');
ok((html.match(/data-onboarding-step=/g) || []).length === 3, 'wizard has three focused steps');
ok(app.includes("if (state.config.onboardingComplete !== false) return"), 'wizard opens only for fresh installs');
ok(app.includes("{ onboardingComplete: true }"), 'finish action persists completion');
ok(!/installHy2|installVless|installOpenFlux/.test(app.slice(app.indexOf('function showOnboarding'), app.indexOf('// ═', app.indexOf('function showOnboarding') + 10))),
  'wizard never installs optional protocols');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
