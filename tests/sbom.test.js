#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('SPDX release SBOM regression test');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rixxx-sbom-'));
const first = path.join(temp, 'first.json');
const second = path.join(temp, 'second.json');
const env = { ...process.env, SBOM_CREATED: '2026-09-27T00:00:00Z' };
const generate = output => spawnSync(process.execPath,
  [path.join(root, 'tools/generate-sbom.js'), output], { cwd: root, env, encoding: 'utf8' });

try {
  const one = generate(first);
  const two = generate(second);
  ok(one.status === 0 && two.status === 0, 'generator succeeds without network access');
  ok(fs.readFileSync(first, 'utf8') === fs.readFileSync(second, 'utf8'),
    'fixed creation timestamp produces a deterministic SBOM');
  const sbom = JSON.parse(fs.readFileSync(first, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'supply-chain/components.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'panel/package-lock.json')));
  const npmCount = Object.entries(lock.packages || {})
    .filter(([p, m]) => p.startsWith('node_modules/') && !m.dev && m.version).length;
  const artifactCount = manifest.components.reduce((total, item) => total + item.artifacts.length, 0);

  ok(sbom.spdxVersion === 'SPDX-2.3' && sbom.dataLicense === 'CC0-1.0',
    'document declares SPDX 2.3 and its required data license');
  ok(/^https:\/\/github\.com\/arivano81\/Panel-Naive-Mieru\/sbom\/.+\/[a-f0-9]{64}$/.test(sbom.documentNamespace),
    'document namespace is repository-scoped and content-derived');
  ok(sbom.packages.length === 1 + npmCount + artifactCount,
    'SBOM covers panel, every production npm package, and every pinned binary artifact');
  const ids = sbom.packages.map(item => item.SPDXID);
  ok(new Set(ids).size === ids.length, 'all package SPDX identifiers are unique');
  ok(sbom.relationships.length === sbom.packages.length - 1 &&
     sbom.relationships.every(item => item.spdxElementId === 'SPDXRef-Package-Panel-Naive-Mieru'),
    'root package depends on every enumerated runtime artifact');
  ok(sbom.packages.filter(item => item.SPDXID.startsWith('SPDXRef-NPM-'))
    .every(item => item.externalRefs?.some(ref => ref.referenceType === 'purl') &&
      item.checksums?.some(sum => sum.algorithm === 'SHA512')),
    'npm packages retain purl and lockfile SHA-512 integrity');
  ok(sbom.packages.filter(item => item.SPDXID.startsWith('SPDXRef-External-'))
    .every(item => item.checksums?.length === 1 && item.checksums[0].algorithm === 'SHA256' &&
      /^[a-f0-9]{64}$/.test(item.checksums[0].checksumValue)),
    'external binary artifacts retain pinned SHA-256 checksums');

  const sourceMap = {
    'caddy-forwardproxy-naive': ['install.sh', 'update.sh'],
    mita: ['install.sh', 'update.sh'],
    'mieru-client': ['panel/scripts/cascade_mieru.sh'],
    hysteria2: ['panel/scripts/install_hysteria.sh'],
    'xray-core': ['panel/scripts/install_xray.sh'],
    wgcf: ['panel/scripts/warp_egress.sh'],
    openflux: ['panel/scripts/install_openflux.sh'],
  };
  let pinsMatch = true;
  for (const component of manifest.components) {
    const sources = (sourceMap[component.name] || []).map(file =>
      fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
    if (!sources.includes(component.version)) pinsMatch = false;
    for (const artifact of component.artifacts)
      if (!sources.includes(artifact.sha256)) pinsMatch = false;
  }
  ok(pinsMatch, 'supply-chain manifest versions and checksums match production installers');
  ok(!JSON.stringify(manifest).includes('/latest/') &&
     manifest.components.every(item => item.source.startsWith('https://github.com/')),
    'manifest has immutable release URLs and source provenance');
  const releaseWorkflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  ok(releaseWorkflow.includes("tags: ['v*']") &&
     releaseWorkflow.includes('test "$GITHUB_REF_NAME" = "v${version}"'),
    'release workflow runs only for a tag matching VERSION');
  ok(releaseWorkflow.includes('sha256sum') && releaseWorkflow.includes('gh release upload') &&
     !releaseWorkflow.includes('--clobber'),
    'release publishes checksums and refuses silent artifact replacement');
  ok(releaseWorkflow.includes('id-token: write') &&
     /sigstore\/gh-action-sigstore-python@[a-f0-9]{40}/.test(releaseWorkflow) &&
     releaseWorkflow.includes('verify: true') &&
     releaseWorkflow.includes('https://github.com/${{ github.workflow_ref }}') &&
     releaseWorkflow.includes('https://token.actions.githubusercontent.com'),
    'release artifacts receive a pinned keyless Sigstore signature and identity verification');
  ok(releaseWorkflow.includes('dist/SHA256SUMS') &&
     releaseWorkflow.includes('dist/Panel-Naive-Mieru-*.tar.gz') &&
     releaseWorkflow.includes('dist/rixxx-panel-*.spdx.json') &&
     releaseWorkflow.includes('gh release upload "$GITHUB_REF_NAME" dist/*'),
    'archive, SBOM, checksum list and generated signature bundles are all published');
  ok(!/SIGSTORE_(?:PRIVATE|KEY)|COSIGN_(?:PRIVATE|KEY)|secrets\./.test(releaseWorkflow),
    'release signing requires no stored private key or repository secret');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
