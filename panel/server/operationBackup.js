'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateBackup } = require('./backupRestore');

const RISKY_CONFIG_FIELDS = new Set([
  'domain', 'naivePort', 'mieruPortStart', 'mieruPortEnd', 'probeSecret', 'subBaseUrl',
]);

function operationLabel(req) {
  const method = String(req.method || '').toUpperCase();
  const requestPath = String(req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`).split('?')[0];
  if (method === 'POST' && requestPath === '/api/config' &&
      Object.keys(req.body || {}).some(key => RISKY_CONFIG_FIELDS.has(key))) return 'server-config';
  if (['POST', 'PUT', 'DELETE'].includes(method) && /^\/api\/users(?:\/|$)/.test(requestPath)) return 'user-keys';
  if (method === 'POST' && /^\/api\/federation\/(?:provision|deprovision)$/.test(requestPath)) return 'federation-keys';
  if (method === 'POST' && /^\/api\/settings\/(?:naive-port|mieru-ports|hy2-port|hy2\/install|vless\/(?:install|xhttp|reality-target)|probe-secret)$/.test(requestPath)) return 'protocol-config';
  if (method === 'POST' && requestPath === '/api/panel/external-access') return 'panel-domain';
  if ((method === 'POST' && (requestPath === '/api/openflux/profiles' || /\/rotate$/.test(requestPath))) ||
      (method === 'DELETE' && /^\/api\/openflux\/profiles\//.test(requestPath))) return 'openflux-keys';
  return '';
}

function createOperationBackup(payload, label, {
  directory = '/etc/vertaflux/backups/operations', retain = 20, io = fs, now = new Date(),
} = {}) {
  validateBackup(payload);
  io.mkdirSync(directory, { recursive: true, mode: 0o700 });
  io.chmodSync(directory, 0o700);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const safeLabel = String(label || 'operation').replace(/[^a-z0-9-]/gi, '-').slice(0, 40);
  const target = path.join(directory, `vertaflux-${stamp}-${safeLabel}-${crypto.randomBytes(3).toString('hex')}.json`);
  const temporary = `${target}.new`;
  io.writeFileSync(temporary, JSON.stringify(payload, null, 2), { mode: 0o600 });
  io.chmodSync(temporary, 0o600);
  io.renameSync(temporary, target);

  const files = io.readdirSync(directory)
    .filter(name => /^vertaflux-.*\.json$/.test(name))
    .sort().reverse();
  for (const name of files.slice(retain)) {
    try { io.unlinkSync(path.join(directory, name)); } catch {}
  }
  return target;
}

function operationBackupMiddleware(createBackup) {
  return (req, res, next) => {
    const label = operationLabel(req);
    if (!label || !req.session?.authenticated) return next();
    try {
      const safetyBackup = createBackup(label);
      const sendJson = res.json.bind(res);
      res.json = body => sendJson(body && typeof body === 'object' && !Array.isArray(body)
        ? { ...body, safetyBackup } : body);
      return next();
    } catch (error) {
      return res.status(503).json({ error: `Safety backup failed; no changes were made: ${error.message}` });
    }
  };
}

module.exports = { createOperationBackup, operationBackupMiddleware, operationLabel };
