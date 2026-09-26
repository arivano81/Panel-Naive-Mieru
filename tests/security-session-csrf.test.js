#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { newCsrfToken, tokenMatches, csrfProtection } = require('../panel/server/csrf');
const server = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '../panel/public/app.js'), 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}
function invoke({ method = 'POST', path = '/config', authenticated = true, expected, supplied }) {
  let next = false, status = 0, body;
  const req = { method, path, session: { authenticated, csrfToken: expected },
    get: name => name.toLowerCase() === 'x-csrf-token' ? supplied : undefined };
  const res = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
  csrfProtection(req, res, () => { next = true; });
  return { next, status, body };
}

console.log('Session rotation and CSRF regression test');
const token = newCsrfToken();
ok(/^[A-Za-z0-9_-]{43}$/.test(token), 'CSRF token has 256 bits encoded as base64url');
ok(tokenMatches(token, token) && !tokenMatches(token, `${token}x`) && !tokenMatches(token, undefined),
  'token comparison is exact and length-safe');
ok(invoke({ method: 'GET', expected: token }).next, 'safe API methods need no CSRF header');
ok(invoke({ path: '/login' }).next, 'login remains available before a CSRF token exists');
ok(invoke({ method: 'DELETE', path: '/login', expected: token }).status === 403,
  'only POST is exempted at the login path');
ok(invoke({ authenticated: false }).next, 'unauthenticated mutations continue to the normal auth gate');
ok(invoke({ expected: token }).status === 403 && invoke({ expected: token }).body.error === 'Invalid CSRF token',
  'authenticated mutation without a token is rejected');
ok(invoke({ expected: token, supplied: 'wrong' }).status === 403,
  'authenticated mutation with a wrong token is rejected');
ok(invoke({ expected: token, supplied: token }).next, 'matching session-bound token permits mutation');
ok((server.match(/req\.session\.regenerate\(/g) || []).length >= 2 &&
   server.includes("app.post('/api/login'") && server.includes("app.post('/api/config/password'"),
  'login and administrator password change rotate the session id');
ok(server.includes("app.use('/api/', csrfProtection)") && server.includes('csrfToken: req.session.csrfToken'),
  'CSRF middleware covers API routes and authenticated responses deliver the session token');
ok(ui.includes("opts.headers['X-CSRF-Token'] = state.csrfToken") &&
   ui.includes("'X-CSRF-Token': state.csrfToken"),
  'shared API helper and direct secret download send the CSRF header');
ok(ui.includes("headers: state.csrfToken ? { 'X-CSRF-Token': state.csrfToken } : {}"),
  'logout sends CSRF protection before clearing browser state');
ok(/const loginLimiter = rateLimit\([\s\S]*app\.post\('\/api\/login', loginLimiter,/.test(server),
  'administrator login has a dedicated brute-force limiter');
ok(/const subLimiter = rateLimit\([\s\S]*app\.get\('\/sub\/:token', subLimiter,/.test(server),
  'public subscription links have a dedicated token-probing limiter');
ok(/const fedLimiter = rateLimit\([\s\S]*app\.post\('\/api\/federation\/fetch', fedLimiter,[\s\S]*app\.post\('\/api\/federation\/provision', fedLimiter,[\s\S]*app\.post\('\/api\/federation\/deprovision', fedLimiter,/.test(server),
  'all public federation operations share their dedicated limiter');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
