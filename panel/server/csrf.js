'use strict';

const crypto = require('crypto');
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function newCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenMatches(expected, supplied) {
  if (typeof expected !== 'string' || typeof supplied !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(String(req.method || '').toUpperCase())) return next();
  if (req.path === '/login' && String(req.method || '').toUpperCase() === 'POST') return next();
  if (!req.session || req.session.authenticated !== true) return next();
  const supplied = req.get ? req.get('x-csrf-token') : req.headers && req.headers['x-csrf-token'];
  if (tokenMatches(req.session.csrfToken, supplied)) return next();
  return res.status(403).json({ error: 'Invalid CSRF token' });
}

module.exports = { newCsrfToken, tokenMatches, csrfProtection };
