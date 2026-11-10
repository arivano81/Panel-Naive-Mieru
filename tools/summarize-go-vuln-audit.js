#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const reportDir = path.resolve(process.argv[2] || path.join(root, 'dist/go-vulnerability-audit'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'supply-chain/components.json'), 'utf8'));

function metadata(text, key) {
  return text.match(new RegExp(`^${key}: (.+)$`, 'm'))?.[1]?.trim() || '';
}

function advisories(text) {
  return [...new Set([...text.matchAll(/Vulnerability #\d+: (GO-\d+-\d+)/g)].map(match => match[1]))].sort();
}

const binary = new Map();
for (const file of fs.readdirSync(reportDir).filter(name => name.endsWith('.txt'))) {
  const text = fs.readFileSync(path.join(reportDir, file), 'utf8');
  const component = metadata(text, 'component');
  if (!component) continue;
  binary.set(component, {
    version: metadata(text, 'version'),
    goVersion: text.match(/:\s+(go\d+\.\d+(?:\.\d+)?)/)?.[1] || 'unknown',
    advisories: advisories(text)
  });
}

const sourceByComponent = new Map();
const sourceDir = path.join(reportDir, 'source');
if (fs.existsSync(sourceDir)) {
  for (const file of fs.readdirSync(sourceDir).filter(name => name.endsWith('.txt'))) {
    const text = fs.readFileSync(path.join(sourceDir, file), 'utf8');
    const component = metadata(text, 'component');
    if (!component) continue;
    const current = sourceByComponent.get(component) || { modules: 0, advisories: new Set() };
    current.modules++;
    advisories(text).forEach(id => current.advisories.add(id));
    sourceByComponent.set(component, current);
  }
}

const rows = manifest.components.map(item => {
  const bin = binary.get(item.name) || { version: item.version, goVersion: 'unknown', advisories: [] };
  let sourceOwner = item.name;
  let source = sourceByComponent.get(sourceOwner);
  if (!source) {
    const shared = manifest.components.find(other =>
      other.name !== item.name && other.sourceCommit === item.sourceCommit && sourceByComponent.has(other.name));
    if (shared) { sourceOwner = shared.name; source = sourceByComponent.get(sourceOwner); }
  }
  return {
    component: item.name,
    version: bin.version,
    goVersion: bin.goVersion,
    binaryAdvisories: bin.advisories,
    sourceAdvisories: [...(source?.advisories || [])].sort(),
    sourceModules: source?.modules || 0,
    sourceSharedWith: sourceOwner === item.name ? null : sourceOwner
  };
});

const generatedAt = new Date().toISOString();
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
const result = { schema: 1, generatedAt, commit: process.env.GITHUB_SHA || null, runUrl, components: rows };
fs.writeFileSync(path.join(reportDir, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);

const lines = [
  '# Pinned Go vulnerability audit summary', '',
  `Generated: ${generatedAt}`, runUrl ? `Run: ${runUrl}` : '', '',
  '| Component | Version | Built with | Binary advisories | Source-reachable advisories |',
  '|---|---:|---:|---:|---:|',
  ...rows.map(row => {
    const shared = row.sourceSharedWith ? ` (shared scan: ${row.sourceSharedWith})` : '';
    return `| ${row.component} | ${row.version} | ${row.goVersion} | ${row.binaryAdvisories.length} | ${row.sourceAdvisories.length}${shared} |`;
  }), '',
  'Counts are unique GO advisory IDs per component. Source counts are call-graph findings across',
  'all scanned modules; a shared upstream commit is scanned once and explicitly identified.', '',
  'A non-zero count remains a release blocker until the upstream artifact is updated or a',
  'finding receives a narrow, documented VEX decision. This summary does not suppress findings.', ''
].filter((line, index, all) => line || all[index - 1] !== '');
fs.writeFileSync(path.join(reportDir, 'summary.md'), `${lines.join('\n')}\n`);
console.log(lines.slice(0, -4).join('\n'));
