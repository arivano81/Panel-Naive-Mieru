'use strict';

const PROFILE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const ACTIONS = new Set(['start', 'stop', 'restart']);

function registerOpenFluxRoutes(app, requireAuth, service) {
  const replyError = (res, error) => res.status(error.status || 500)
    .json({ error: error.message || 'OpenFlux operation failed' });

  app.get('/api/openflux', requireAuth, (_req, res) => {
    try { res.json({ installed: service.installed(), version: service.release.version,
      experimental: true, profiles: service.list() }); }
    catch (error) { replyError(res, error); }
  });
  app.post('/api/openflux/install', requireAuth, (_req, res) => {
    try { res.json(service.install()); } catch (error) { replyError(res, error); }
  });
  app.post('/api/openflux/profiles', requireAuth, (req, res) => {
    const input = req.body || {};
    try { res.status(201).json(service.create({ id: input.id, port: input.port, host: input.host })); }
    catch (error) { replyError(res, error); }
  });
  app.post('/api/openflux/profiles/:id/:action', requireAuth, (req, res) => {
    if (!PROFILE_ID_RE.test(req.params.id) || !ACTIONS.has(req.params.action))
      return res.status(400).json({ error: 'Invalid OpenFlux profile or action' });
    try { res.json(service.action(req.params.id, req.params.action)); }
    catch (error) { replyError(res, error); }
  });
  app.get('/api/openflux/profiles/:id/logs', requireAuth, (req, res) => {
    if (!PROFILE_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid OpenFlux profile id' });
    try { res.json({ id: req.params.id, logs: service.logs(req.params.id, req.query.lines) }); }
    catch (error) { replyError(res, error); }
  });
  app.delete('/api/openflux/profiles/:id', requireAuth, (req, res) => {
    if (!PROFILE_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid OpenFlux profile id' });
    try { res.json(service.remove(req.params.id)); } catch (error) { replyError(res, error); }
  });
}

module.exports = { registerOpenFluxRoutes };
