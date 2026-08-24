#!/usr/bin/env node
// Validate the attendee-facing documents and the prepared artefact set.
// Pure Node, no browser. The browser checks live in the html-docs validator,
// which runs separately: node docs/assets/validate.js docs/showcase.html

import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChecker, readText, exists, loadManifest, loadConfig, walk, relPath, repoPath, log } from './lib/repo.mjs';
import { concreteIdentityValues, unknownProperNouns, localScreen } from './lib/neutrality.mjs';

const checker = createChecker();
const config = loadConfig();
const manifest = loadManifest();

const DOCS = ['docs/index.html', 'docs/showcase.html', 'docs/presenter.html', 'docs/mission-control.html'];

// --- documents exist and are self-describing ---------------------------------

log.head('Documents');
for (const doc of DOCS) {
  checker.check(exists(doc), `${doc} exists`);
}

const docText = new Map();
for (const doc of DOCS) {
  if (exists(doc)) docText.set(doc, readText(doc));
}

for (const [doc, html] of docText) {
  const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
  checker.check(h1Count === 1, `${doc} has exactly one h1 (found ${h1Count})`);
  checker.check(/<meta name="description"/.test(html), `${doc} has a description meta tag`);
  checker.check(/<title>[^<]+<\/title>/.test(html), `${doc} has a non-empty title`);
  checker.check(/data-theme/.test(html), `${doc} bootstraps a theme before paint`);
  checker.check(!/https?:\/\/cdn\.|unpkg\.com|jsdelivr/.test(html), `${doc} loads nothing from a CDN`);
}

// --- ids are unique and internal anchors resolve -----------------------------

log.head('Anchors and identifiers');
for (const [doc, html] of docText) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  checker.check(duplicates.length === 0, `${doc} has no duplicate id${duplicates.length ? `: ${[...new Set(duplicates)].join(', ')}` : ''}`);

  const idSet = new Set(ids);
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const broken = [...new Set(anchors)].filter((a) => !idSet.has(a));
  checker.check(broken.length === 0, `${doc} internal anchors all resolve${broken.length ? `: broken ${broken.join(', ')}` : ''}`);
}

// --- relative links between documents and into the repository ----------------

log.head('Relative links');
for (const [doc, html] of docText) {
  const links = [...html.matchAll(/(?:href|src)="([^"#:]+)(?:#[^"]*)?"/g)]
    .map((m) => m[1])
    .filter((href) => href && !href.startsWith('//') && !href.startsWith('data:') && !href.startsWith('mailto:'));
  const base = doc.slice(0, doc.lastIndexOf('/'));
  const missing = [];
  for (const link of [...new Set(links)]) {
    const target = link.startsWith('../')
      ? link.replace(/^\.\.\//, '')
      : `${base}/${link.replace(/^\.\//, '')}`;
    if (!exists(target)) missing.push(`${link} -> ${target}`);
  }
  checker.check(missing.length === 0, `${doc} relative links all resolve${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
}

// --- prepared artefacts are complete and self-labelling ----------------------

log.head('Prepared artefacts');
const artifactFiles = readdirSync(new URL('../fixtures/prepared/', import.meta.url))
  .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
  .sort();

checker.check(artifactFiles.length >= 10, `found ${artifactFiles.length} prepared artefacts`);

for (const scene of manifest.scenes) {
  if (!scene.artifact) continue;
  checker.check(exists(scene.artifact), `scene "${scene.id}" artefact exists`);
  if (!exists(scene.artifact)) continue;
  const artifact = JSON.parse(readText(scene.artifact));
  checker.check(artifact.scene === scene.id, `${scene.artifact} names its scene`);
  checker.check(Boolean(artifact.status), `${scene.artifact} declares a status`);
  checker.check(Boolean(artifact.labelInUi), `${scene.artifact} carries a UI label`);
  checker.check(Boolean(artifact.capturedOn), `${scene.artifact} is dated`);
}

const referenced = new Set(manifest.scenes.map((s) => s.artifact).filter(Boolean).map((p) => p.split('/').pop()));
const orphans = artifactFiles.filter((f) => !referenced.has(f));
checker.check(orphans.length === 0, `no orphan artefact${orphans.length ? `: ${orphans.join(', ')}` : ''}`);

// --- simulations are always labelled -----------------------------------------

log.head('Simulation honesty');
for (const [doc, html] of docText) {
  const text = html.replace(/<[^>]+>/g, ' ');
  if (/simulat/i.test(text)) {
    checker.check(
      /Simulated|simulation|simulated/.test(text),
      `${doc} names simulation explicitly where it uses the concept`
    );
  }
}
const provenance = JSON.parse(readText('fixtures/prepared/07-release-provenance.json'));
checker.check(
  ['attested', 'simulated'].includes(provenance.record.mode),
  'the provenance artefact declares its mode'
);

// --- structural neutrality and synthetic-data rules --------------------------

log.head('Content rules');

const identityOffenders = concreteIdentityValues();
checker.check(
  identityOffenders.length === 0,
  `no profile carries a concrete organisation, tenant or subscription value${identityOffenders.length ? `: ${identityOffenders.join('; ')}` : ''}`
);

const nounOffenders = unknownProperNouns();
checker.check(
  nounOffenders.length === 0,
  nounOffenders.length
    ? `attendee-facing prose uses a proper noun that is not allowlisted: ${nounOffenders.join('; ')}. Add it to neutrality.allowedProperNouns if it is a product or scenario name, or remove it if it identifies an organisation.`
    : 'attendee-facing prose uses only allowlisted proper nouns'
);

const screened = localScreen(walk().map(relPath).filter((p) => !p.startsWith('docs/assets/')));
if (screened === null) {
  log.info(`no ${config.neutrality.localOverridesFile} present, so no local screen ran (this is the normal state)`);
} else if (screened.error) {
  checker.check(false, screened.error);
} else {
  log.info(`the local screen never reads its own declaration: ${screened.exempt.join(', ')}`);
  checker.check(
    screened.offenders.length === 0,
    `local screen over ${screened.terms} presenter term(s) found nothing${screened.offenders.length ? `: ${screened.offenders.join('; ')}` : ''}`
  );
}

const catalog = JSON.parse(readText('app/data/catalog.json'));
checker.check(
  typeof catalog.$comment === 'string' && /synthetic/i.test(catalog.$comment),
  'the catalogue declares itself synthetic'
);
const inventory = JSON.parse(readText('app/data/inventory.json'));
checker.check(
  typeof inventory.$comment === 'string' && /synthetic/i.test(inventory.$comment),
  'the inventory declares itself synthetic'
);

// --- no emoji anywhere in authored content -----------------------------------

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
log.head('No emoji');
const emojiOffenders = [];
for (const file of walk()) {
  const rel = relPath(file);
  if (rel.startsWith('docs/assets/') || rel.endsWith('.lock.yml')) continue;
  if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|svg|tar\.gz)$/i.test(rel)) continue;
  let content;
  try {
    content = readText(rel);
  } catch {
    continue;
  }
  if (EMOJI.test(content)) emojiOffenders.push(rel);
}
checker.check(emojiOffenders.length === 0, `no emoji in authored content${emojiOffenders.length ? `: ${emojiOffenders.join(', ')}` : ''}`);

// --- the standalone export is generated, and still fresh ---------------------

log.head('Standalone export');
const exportPath = 'docs/showcase.standalone.html';
if (!exists(exportPath)) {
  checker.check(false, `${exportPath} exists (build it with: npm run build:standalone)`);
} else {
  checker.check(true, `${exportPath} exists`);
  // Build into a temp path and compare. The committed file is never mutated, so
  // this stays safe when the test runner executes several files concurrently.
  const target = repoPath(exportPath);
  const committed = readFileSync(target, 'utf8');
  const tmp = join(tmpdir(), `showcase-standalone-check-${process.pid}.html`);
  try {
    execFileSync(
      process.execPath,
      [repoPath('scripts', 'build-standalone.mjs'), 'docs/showcase.html', tmp],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const fresh = readFileSync(tmp, 'utf8');
    checker.check(
      fresh.replace(/\r\n/g, '\n') === committed.replace(/\r\n/g, '\n'),
      'the committed export matches what the build produces from the source'
    );
  } catch (err) {
    checker.check(false, `the export could not be rebuilt: ${err.message}`);
  } finally {
    rmSync(tmp, { force: true });
  }
  checker.check(!/href="assets\/|src="assets\//.test(committed), 'the export inlines its stylesheet and runtime');
  checker.check(!/<img[^>]+src="diagrams\//.test(committed), 'the export carries no external diagram reference');
  const dangling = [...committed.matchAll(/(?:href|src)="([^"#:]+)"/g)]
    .map((m) => m[1])
    .filter((h) => h && !h.startsWith('//') && !h.startsWith('data:'));
  checker.check(dangling.length === 0, `the export has no dangling local link${dangling.length ? `: ${[...new Set(dangling)].join(', ')}` : ''}`);
  checker.check(/ATTRIBUTION\.md/.test(committed), 'the export keeps a reachable attribution link');
}

process.exit(checker.finish('Document validation'));
