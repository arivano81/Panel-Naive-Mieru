'use strict';

function selectedProtocols(user) {
  try {
    const value = typeof user.protocols === 'string' ? JSON.parse(user.protocols) : user.protocols;
    return Array.isArray(value) ? value.filter(name => ['naive', 'mieru', 'hy2', 'vless'].includes(name)) : [];
  } catch { return []; }
}

function buildUserConnectionDiagnostics(user, config, diagnostics, access) {
  const network = (diagnostics.network || []).find(item => item.role === 'VPN') || {};
  const commonIdentity = !!(user.username && user.password);
  const definitions = {
    naive: { installed: true, service: diagnostics.services?.caddy === 'active',
      listening: !!diagnostics.ports?.naive, identity: commonIdentity,
      network: !!(network.dnsOk && network.certificate?.ok) },
    mieru: { installed: true, service: diagnostics.services?.mieru === 'active',
      listening: !!diagnostics.ports?.mieru, identity: commonIdentity, network: !!network.dnsOk },
    hy2: { installed: !!diagnostics.ports?.hy2Installed,
      service: diagnostics.services?.hysteria2 === 'active', listening: !!diagnostics.ports?.hy2,
      identity: commonIdentity, network: !!(network.dnsOk && network.certificate?.ok) },
    vless: { installed: !!config.stack?.vless, service: diagnostics.services?.xray === 'active',
      listening: !!diagnostics.ports?.vless, identity: !!user.vless_uuid,
      network: !!(network.dnsOk && network.certificate?.ok) },
  };
  const protocols = selectedProtocols(user).flatMap(name => {
    const checks = definitions[name];
    const result = { name, ...checks, ready: access.active && Object.values(checks).every(value => value === true) };
    if (name !== 'vless' || config.stack?.vlessXhttp !== true) return [result];
    const xhttp = { installed: true,
      service: diagnostics.services?.xray === 'active' && diagnostics.services?.caddy === 'active',
      listening: !!diagnostics.ports?.vlessXhttp, identity: !!user.vless_uuid,
      network: !!(network.dnsOk && network.certificate?.ok) };
    return [result, { name: 'vless-xhttp', ...xhttp,
      ready: access.active && Object.values(xhttp).every(value => value === true) }];
  });
  return {
    user: { id: user.id, username: user.username },
    access: { active: !!access.active, reason: access.reason || null },
    protocols,
    ready: protocols.length > 0 && protocols.some(protocol => protocol.ready),
  };
}

module.exports = { buildUserConnectionDiagnostics, selectedProtocols };
