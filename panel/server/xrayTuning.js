'use strict';

const PROFILES = new Set(['conservative', 'balanced', 'latency', 'throughput', 'custom']);
const DOMAIN_STRATEGIES = new Set(['AsIs', 'UseIP', 'UseIPv4', 'UseIPv6', 'UseIPv4v6', 'UseIPv6v4']);
const CONGESTION = new Set(['', 'bbr', 'cubic']);

function integer(value, min, max, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error(`${name} must be ${min}..${max}`);
  return number;
}

function normalizeXrayTuning(input = {}) {
  const profile = String(input.profile || 'balanced');
  const domainStrategy = String(input.domainStrategy || 'AsIs');
  const tcpCongestion = String(input.tcpCongestion || '').toLowerCase();
  if (!PROFILES.has(profile)) throw new Error('unknown Xray tuning profile');
  if (!DOMAIN_STRATEGIES.has(domainStrategy)) throw new Error('unsupported Xray domain strategy');
  if (!CONGESTION.has(tcpCongestion)) throw new Error('unsupported TCP congestion control');
  return {
    enabled: input.enabled === true,
    profile,
    sniffing: input.sniffing !== false,
    tcpFastOpen: input.tcpFastOpen === true,
    tcpKeepAliveIdle: integer(input.tcpKeepAliveIdle ?? 300, 30, 7200, 'TCP keepalive idle'),
    tcpKeepAliveInterval: integer(input.tcpKeepAliveInterval ?? 0, 0, 600, 'TCP keepalive interval'),
    tcpUserTimeout: integer(input.tcpUserTimeout ?? 10000, 0, 300000, 'TCP user timeout'),
    tcpCongestion,
    domainStrategy,
  };
}

function recommendXrayTuning(facts = {}) {
  const controls = Array.isArray(facts.congestionControls) ? facts.congestionControls : [];
  const bbr = controls.includes('bbr');
  const constrained = Number(facts.memoryMB) < 768 || Number(facts.cpuLoadPercent) >= 80;
  const fast = !constrained && Number(facts.cpuCores) >= 2 && Number(facts.memoryMB) >= 1536 && bbr;
  const profile = constrained ? 'conservative' : (fast ? 'throughput' : 'balanced');
  const hasIpv6 = facts.ipv6Default === true;
  const settings = normalizeXrayTuning({
    enabled: true,
    profile,
    sniffing: true,
    tcpFastOpen: Number(facts.tcpFastOpen) >= 2,
    tcpKeepAliveIdle: constrained ? 300 : 120,
    tcpKeepAliveInterval: constrained ? 0 : 30,
    tcpUserTimeout: Number(facts.routeMtu) > 0 && Number(facts.routeMtu) <= 1280 ? 20000 : 15000,
    tcpCongestion: bbr ? 'bbr' : (controls.includes('cubic') ? 'cubic' : ''),
    domainStrategy: hasIpv6 ? 'AsIs' : 'UseIPv4',
  });
  const reasons = [
    constrained ? 'conservative profile selected because memory is below 768 MB or CPU load is high'
      : (fast ? 'throughput profile selected because CPU, memory and BBR are available'
        : 'balanced profile selected for the measured server capacity'),
    bbr ? 'BBR is available in the running kernel' : 'BBR is unavailable; using the kernel-supported fallback',
    settings.tcpFastOpen ? 'kernel TCP Fast Open includes server support' : 'kernel TCP Fast Open server support is unavailable',
    hasIpv6 ? 'a default IPv6 route is present' : 'no default IPv6 route; outbound DNS prefers IPv4',
  ];
  if (Number(facts.routeMtu) > 0) reasons.push(`detected route MTU ${facts.routeMtu}`);
  return { settings, reasons };
}

module.exports = { normalizeXrayTuning, recommendXrayTuning };
