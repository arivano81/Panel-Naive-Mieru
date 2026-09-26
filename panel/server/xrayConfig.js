'use strict';

const net = require('net');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const SHORT_ID_RE = /^(?:[0-9a-f]{2}){1,8}$/i;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const XHTTP_PATH_RE = /^\/[a-zA-Z0-9_-]{16,96}$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeRealitySettings(input) {
  const port = Number(input.port);
  const serverName = String(input.serverName || '').trim().toLowerCase();
  const target = String(input.target || '').trim().toLowerCase();
  const privateKey = String(input.privateKey || '').trim();
  const publicKey = String(input.publicKey || '').trim();
  const shortId = String(input.shortId || '').trim().toLowerCase();
  assert(Number.isInteger(port) && port >= 1024 && port <= 65535, 'VLESS port must be 1024..65535');
  assert(HOST_RE.test(serverName) && net.isIP(serverName) === 0, 'REALITY serverName must be a DNS hostname');
  assert(target === `${serverName}:443`, 'REALITY target must equal serverName:443');
  assert(KEY_RE.test(privateKey), 'REALITY private key must be a 43-character base64url X25519 key');
  if (publicKey) assert(KEY_RE.test(publicKey), 'REALITY public key must be a 43-character base64url X25519 key');
  assert(SHORT_ID_RE.test(shortId), 'REALITY shortId must be 2..16 even hexadecimal characters');
  return { port, serverName, target, privateKey, publicKey, shortId };
}

function normalizeVlessUsers(users) {
  assert(Array.isArray(users), 'VLESS users must be an array');
  const ids = new Set();
  return users.map(user => {
    const id = String(user.id || '').trim().toLowerCase();
    const email = String(user.email || user.username || '').trim();
    assert(UUID_RE.test(id), `invalid VLESS UUID for ${email || 'user'}`);
    assert(email && email.length <= 128 && !/[\r\n]/.test(email), 'VLESS user email is required');
    assert(!ids.has(id), 'duplicate VLESS UUID');
    ids.add(id);
    return { id, email, flow: 'xtls-rprx-vision' };
  });
}

function normalizeXhttpSettings(input) {
  const port = Number(input.port);
  const host = String(input.host || '').trim().toLowerCase();
  const requestPath = String(input.path || '').trim();
  assert(Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== 10085,
    'XHTTP loopback port must be 1024..65535 and not the Stats API port');
  assert(HOST_RE.test(host) && net.isIP(host) === 0, 'XHTTP host must be a DNS hostname');
  assert(XHTTP_PATH_RE.test(requestPath), 'XHTTP path must be / plus 16..96 letters, digits, underscores or hyphens');
  return { port, host, path: requestPath, mode: 'auto' };
}

function buildXhttpInbound(settings, users) {
  const xhttp = normalizeXhttpSettings(settings);
  const clients = normalizeVlessUsers(users).map(({ id, email }) => ({ id, email }));
  return {
    tag: 'vless-xhttp-in', listen: '127.0.0.1', port: xhttp.port, protocol: 'vless',
    settings: { clients, decryption: 'none' },
    streamSettings: {
      network: 'xhttp', security: 'none',
      xhttpSettings: { path: xhttp.path, mode: xhttp.mode },
    },
    sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true },
  };
}

function buildXrayRealityConfig(settings, users, xhttpSettings) {
  const reality = normalizeRealitySettings(settings);
  const clients = normalizeVlessUsers(users);
  const config = {
    log: { loglevel: 'warning' },
    api: { tag: 'api', listen: '127.0.0.1:10085', services: ['StatsService'] },
    stats: {},
    policy: {
      levels: { '0': { statsUserUplink: true, statsUserDownlink: true } },
      system: { statsInboundUplink: true, statsInboundDownlink: true },
    },
    inbounds: [{
      tag: 'vless-reality-in', listen: '0.0.0.0', port: reality.port, protocol: 'vless',
      settings: { clients, decryption: 'none' },
      streamSettings: {
        network: 'tcp', security: 'reality',
        realitySettings: {
          show: false, dest: reality.target, xver: 0,
          serverNames: [reality.serverName], privateKey: reality.privateKey,
          shortIds: [reality.shortId],
        },
      },
      sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true },
    }],
    outbounds: [
      { tag: 'direct', protocol: 'freedom' },
      { tag: 'blocked', protocol: 'blackhole' },
    ],
  };
  if (xhttpSettings && xhttpSettings.enabled === true)
    config.inbounds.push(buildXhttpInbound(xhttpSettings, users));
  return config;
}

function buildVlessRealityLink(settings, user, label = '') {
  const reality = normalizeRealitySettings(settings);
  const [client] = normalizeVlessUsers([user]);
  const host = String(settings.host || '').trim().toLowerCase();
  assert(net.isIP(host) !== 0 || HOST_RE.test(host), 'VLESS public host must be an IP address or DNS hostname');
  assert(reality.publicKey, 'REALITY public key is required for a client link');
  const query = new URLSearchParams({
    encryption: 'none', flow: 'xtls-rprx-vision', security: 'reality',
    sni: reality.serverName, fp: 'chrome', pbk: reality.publicKey,
    sid: reality.shortId, type: 'tcp',
  });
  const name = label || client.email;
  const authorityHost = net.isIP(host) === 6 ? `[${host}]` : host;
  return `vless://${client.id}@${authorityHost}:${reality.port}?${query.toString()}#${encodeURIComponent(name)}`;
}

function buildVlessXhttpLink(settings, user, label = '') {
  const xhttp = normalizeXhttpSettings(settings);
  const [client] = normalizeVlessUsers([user]);
  const query = new URLSearchParams({
    encryption: 'none', security: 'tls', sni: xhttp.host,
    type: 'xhttp', host: xhttp.host, path: xhttp.path, mode: 'auto',
  });
  return `vless://${client.id}@${xhttp.host}:443?${query.toString()}#${encodeURIComponent(label || client.email)}`;
}

function buildCaddyXhttpRoute(settings) {
  const xhttp = normalizeXhttpSettings(settings);
  return `  @vless_xhttp path ${xhttp.path}/*\n  handle @vless_xhttp {\n    reverse_proxy h2c://127.0.0.1:${xhttp.port} {\n      flush_interval -1\n    }\n  }\n`;
}

module.exports = {
  normalizeRealitySettings, normalizeXhttpSettings, normalizeVlessUsers,
  buildXhttpInbound, buildXrayRealityConfig, buildVlessRealityLink, buildVlessXhttpLink,
  buildCaddyXhttpRoute,
};
