'use strict';

const ALLOWED_MUTATIONS = new Set([
  '/api/login',
  '/api/maintenance',
  '/api/logout',
  '/api/backup/export/encrypted',
  '/api/backup/inspect',
  '/api/federation/fetch',
]);

function maintenanceProtection(enabled) {
  return (req, res, next) => {
    const method = String(req.method || '').toUpperCase();
    if (!enabled() || ['GET', 'HEAD', 'OPTIONS'].includes(method) ||
        ALLOWED_MUTATIONS.has(req.path)) return next();
    return res.status(423).json({ error: 'Maintenance mode is enabled; configuration changes are locked' });
  };
}

module.exports = { ALLOWED_MUTATIONS, maintenanceProtection };
