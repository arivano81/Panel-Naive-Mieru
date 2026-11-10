'use strict';

const dns = require('dns').promises;
const tls = require('tls');

function hostname(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
}

function diagnosticTargets(config) {
  const targets = [{ role: 'VPN', host: String(config.domain || '').trim().toLowerCase(),
    port: Number(config.naivePort) || 443 }];
  if (config.exposePanel && config.panelDomain)
    targets.push({ role: 'Panel', host: String(config.panelDomain).trim().toLowerCase(), port: 443 });
  const subHost = hostname(config.subBaseUrl || '');
  if (subHost) targets.push({ role: 'Subscription', host: subHost, port: 443 });
  return targets.filter((target, index, all) => target.host &&
    all.findIndex(other => other.host === target.host && other.port === target.port) === index);
}

function defaultTlsProbe(host, port, timeoutMs = 5000) {
  return new Promise(resolve => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true });
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish({ ok: false, error: 'timeout' }));
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert && cert.valid_to ? new Date(cert.valid_to) : null;
      finish({ ok: socket.authorized, validTo: validTo && !Number.isNaN(validTo.valueOf())
        ? validTo.toISOString() : null,
      daysRemaining: validTo ? Math.floor((validTo - Date.now()) / 86400000) : null,
      error: socket.authorized ? null : String(socket.authorizationError || 'certificate rejected').slice(0, 160) });
    });
    socket.once('error', error => finish({ ok: false, error: String(error.code || error.message).slice(0, 160) }));
  });
}

async function checkDnsTls(config, { resolver = dns, tlsProbe = defaultTlsProbe } = {}) {
  const expectedIp = String(config.serverIp || '').trim();
  return Promise.all(diagnosticTargets(config).map(async target => {
    let addresses = [], dnsError = null;
    try {
      const [v4, v6] = await Promise.all([
        resolver.resolve4(target.host).catch(error => { if (error.code !== 'ENODATA' && error.code !== 'ENOTFOUND') throw error; return []; }),
        resolver.resolve6(target.host).catch(error => { if (error.code !== 'ENODATA' && error.code !== 'ENOTFOUND') throw error; return []; }),
      ]);
      addresses = [...new Set([...v4, ...v6])];
    } catch (error) { dnsError = String(error.code || error.message).slice(0, 160); }
    const dnsOk = addresses.length > 0 && (!expectedIp || addresses.includes(expectedIp));
    let certificate = { ok: false, error: 'dns-unresolved' };
    if (addresses.length) {
      try { certificate = await tlsProbe(target.host, target.port); }
      catch (error) { certificate = { ok: false, error: String(error.code || error.message).slice(0, 160) }; }
    }
    return { ...target, expectedIp: expectedIp || null, addresses, dnsOk, dnsError, certificate };
  }));
}

module.exports = { checkDnsTls, diagnosticTargets, defaultTlsProbe };
