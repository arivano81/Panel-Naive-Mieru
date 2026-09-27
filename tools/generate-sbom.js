#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'dist', 'rixxx-panel.spdx.json'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'panel/package-lock.json'), 'utf8'));
const panelPackage = JSON.parse(fs.readFileSync(path.join(root, 'panel/package.json'), 'utf8'));
const manifestBytes = fs.readFileSync(path.join(root, 'supply-chain/components.json'));
const manifest = JSON.parse(manifestBytes);
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();

if (manifest.schema !== 1 || !Array.isArray(manifest.components))
  throw new Error('unsupported supply-chain manifest');

const digest = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(root, 'panel/package-lock.json')))
  .update(manifestBytes).digest('hex');
const created = process.env.SBOM_CREATED || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
if (Number.isNaN(Date.parse(created))) throw new Error('SBOM_CREATED must be an ISO-8601 timestamp');

const safeId = value => String(value).replace(/[^A-Za-z0-9.-]/g, '-');
const packages = [];
const relationships = [];
const rootId = 'SPDXRef-Package-Panel-Naive-Mieru';
packages.push({
  SPDXID: rootId,
  name: panelPackage.name,
  versionInfo: version,
  downloadLocation: `https://github.com/arivano81/Panel-Naive-Mieru/archive/refs/tags/v${version}.tar.gz`,
  filesAnalyzed: false,
  licenseConcluded: panelPackage.license || 'NOASSERTION',
  licenseDeclared: panelPackage.license || 'NOASSERTION',
  copyrightText: 'NOASSERTION',
  supplier: 'Organization: arivano81',
  externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl',
    referenceLocator: `pkg:github/arivano81/Panel-Naive-Mieru@${version}` }],
});

for (const [packagePath, metadata] of Object.entries(lock.packages || {})) {
  if (!packagePath.startsWith('node_modules/') || metadata.dev || !metadata.version) continue;
  const name = packagePath.slice(packagePath.lastIndexOf('node_modules/') + 13);
  const id = `SPDXRef-NPM-${safeId(name)}-${safeId(metadata.version)}-${crypto.createHash('sha1').update(packagePath).digest('hex').slice(0, 10)}`;
  const pkg = {
    SPDXID: id, name, versionInfo: metadata.version,
    downloadLocation: metadata.resolved || 'NOASSERTION', filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION', licenseDeclared: metadata.license || 'NOASSERTION',
    copyrightText: 'NOASSERTION', supplier: 'NOASSERTION',
    externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl',
      referenceLocator: `pkg:npm/${encodeURIComponent(name).replace(/%2F/gi, '/')}@${metadata.version}` }],
  };
  const integrity = String(metadata.integrity || '').match(/^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/);
  if (integrity) pkg.checksums = [{ algorithm: integrity[1].toUpperCase(),
    checksumValue: Buffer.from(integrity[2], 'base64').toString('hex') }];
  packages.push(pkg);
  relationships.push({ spdxElementId: rootId, relationshipType: 'DEPENDS_ON', relatedSpdxElement: id });
}

for (const component of manifest.components) {
  if (!component.name || !component.version || !Array.isArray(component.artifacts))
    throw new Error(`malformed component manifest entry: ${component.name || 'unnamed'}`);
  for (const artifact of component.artifacts) {
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256 || '') || !/^https:\/\//.test(artifact.url || ''))
      throw new Error(`malformed artifact for ${component.name}/${artifact.arch}`);
    const id = `SPDXRef-External-${safeId(component.name)}-${safeId(artifact.arch)}`;
    packages.push({
      SPDXID: id, name: `${component.name}-${artifact.arch}`, versionInfo: component.version,
      downloadLocation: artifact.url, filesAnalyzed: false,
      checksums: [{ algorithm: 'SHA256', checksumValue: artifact.sha256 }],
      licenseConcluded: component.license || 'NOASSERTION',
      licenseDeclared: component.license || 'NOASSERTION', copyrightText: 'NOASSERTION',
      supplier: `Organization: ${new URL(component.source).pathname.split('/')[1]}`,
      externalRefs: [{ referenceCategory: 'OTHER', referenceType: 'website',
        referenceLocator: component.source }],
    });
    relationships.push({ spdxElementId: rootId, relationshipType: 'DEPENDS_ON', relatedSpdxElement: id });
  }
}

const document = {
  spdxVersion: 'SPDX-2.3', dataLicense: 'CC0-1.0', SPDXID: 'SPDXRef-DOCUMENT',
  name: `Panel-Naive-Mieru-${version}`,
  documentNamespace: `https://github.com/arivano81/Panel-Naive-Mieru/sbom/${version}/${digest}`,
  creationInfo: { created, creators: ['Tool: Panel-Naive-Mieru/tools/generate-sbom.js'] },
  documentDescribes: [rootId], packages, relationships,
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(document, null, 2) + '\n');
console.log(output);
