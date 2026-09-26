'use strict';

const net = require('net');

const OPENFLUX_RELEASE = Object.freeze({
  version: '0.0.5',
  asset: 'openflux-linux-amd64',
  sha256: '8211dd5343dd4eac49fcd2838ffcb9e1912c14a0e878c735395967999b0573c5',
  sourceUrl: 'https://github.com/p1neappleXpress/OpenFlux',
  license: 'GPL-3.0-or-later',
});

const PROFILE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateProfile(input, { requireHost = false } = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'OpenFlux profile is required');
  const id = String(input.id || '');
  const port = Number(input.port);
  const host = String(input.host || '');
  assert(PROFILE_ID_RE.test(id), 'profile id must start with a letter and contain only a-z, 0-9 and hyphen (max 32)');
  assert(Number.isInteger(port) && port >= 1024 && port <= 65535, 'OpenFlux port must be 1024..65535');
  assert(!host || net.isIP(host) !== 0 || HOST_RE.test(host), 'OpenFlux host must be an IP address or DNS hostname');
  assert(!requireHost || host, 'OpenFlux public host is required for a client config');
  return { id, port, host };
}

function profilePaths(id) {
  assert(PROFILE_ID_RE.test(id), 'invalid OpenFlux profile id');
  return Object.freeze({
    config: `/etc/openflux/profiles/${id}.conf`,
    secret: `/etc/openflux/secrets/${id}.key`,
    service: `openflux-exit@${id}.service`,
  });
}

function buildOpenFluxExitConfig(input) {
  const profile = validateProfile(input);
  const paths = profilePaths(profile.id);
  return [
    '[Interface]',
    'Role = exit',
    'Mode = l4',
    'Codec = batched',
    `EncryptionKeyFile = ${paths.secret}`,
    `URL = openflux-direct://${profile.id}`,
    'Debug = false',
    '',
    '[Transport "direct"]',
    'Type = direct',
    'Priority = 100',
    `Listen = 0.0.0.0:${profile.port}`,
    '',
  ].join('\n');
}

function buildOpenFluxClientConfig(input) {
  const profile = validateProfile(input, { requireHost: true });
  const endpointHost = net.isIP(profile.host) === 6 ? `[${profile.host}]` : profile.host;
  return [
    '[Interface]',
    'Role = client',
    'Inbound = socks5',
    'Socks5 = 127.0.0.1:1080',
    'Codec = batched',
    'EncryptionKeyFile = ./openflux.key',
    `URL = openflux-direct://${profile.id}`,
    'Debug = false',
    '',
    '[Transport "direct"]',
    'Type = direct',
    'Priority = 100',
    `Dial = ${endpointHost}:${profile.port}`,
    '',
  ].join('\n');
}

function buildOpenFluxUnit() {
  return `[Unit]
Description=OpenFlux experimental L4 exit profile %i
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=openflux
Group=openflux
ExecStart=/usr/local/bin/openflux --config=/etc/openflux/profiles/%i.conf
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
PrivateDevices=true
PrivateTmp=true
ProtectClock=true
ProtectControlGroups=true
ProtectHome=true
ProtectKernelLogs=true
ProtectKernelModules=true
ProtectKernelTunables=true
ProtectSystem=strict
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=true
RestrictRealtime=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
`;
}

module.exports = {
  OPENFLUX_RELEASE,
  validateProfile,
  profilePaths,
  buildOpenFluxExitConfig,
  buildOpenFluxClientConfig,
  buildOpenFluxUnit,
};
