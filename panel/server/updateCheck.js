'use strict';

const https = require('https');

const VERSION_URL = 'https://api.github.com/repos/arivano81/Panel-Naive-Mieru/contents/VERSION?ref=main';

function compareVersions(a, b) {
  const parse = value => String(value || '').replace(/^v/, '').split('.').map(Number);
  const left = parse(a), right = parse(b);
  if (left.length !== 3 || right.length !== 3 || [...left, ...right].some(Number.isNaN)) return 0;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

function requestVersion(token, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'VertaFlux-update-check' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = https.get(VERSION_URL, { headers, timeout: timeoutMs }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { if (body.length < 64 * 1024) body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`GitHub HTTP ${response.statusCode}`));
        try {
          const data = JSON.parse(body);
          resolve(Buffer.from(data.content || '', 'base64').toString('utf8').trim());
        } catch { reject(new Error('invalid GitHub response')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('GitHub request timed out')));
    req.on('error', reject);
  });
}

function createUpdateChecker({ fetchVersion = requestVersion, token = process.env.PANEL_GITHUB_TOKEN || '',
  ttlMs = 6 * 60 * 60 * 1000, now = Date.now } = {}) {
  let cached = null;
  return async currentVersion => {
    if (cached && now() - cached.checkedAt < ttlMs) return cached.result;
    try {
      const latestVersion = await fetchVersion(token);
      const result = { checked: true, currentVersion, latestVersion,
        updateAvailable: compareVersions(latestVersion, currentVersion) > 0 };
      cached = { checkedAt: now(), result };
      return result;
    } catch {
      const result = { checked: false, currentVersion, updateAvailable: false,
        reason: token ? 'unavailable' : 'token-required' };
      cached = { checkedAt: now(), result };
      return result;
    }
  };
}

module.exports = { VERSION_URL, compareVersions, requestVersion, createUpdateChecker };
