import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadConfig, loadProfile, listProfiles, readText, readJson, walk, relPath, exists, repoPath } from '../scripts/lib/repo.mjs';
import { concreteIdentityValues, unknownProperNouns, properNounsIn, proseOf, localScreen, localScreenExemptions } from '../scripts/lib/neutrality.mjs';

const config = loadConfig();

const TEXT_FILES = walk()
  .map(relPath)
  .filter((p) => !p.startsWith('docs/assets/'))
  .filter((p) => !p.endsWith('.lock.yml'))
  .filter((p) => !/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|gz)$/i.test(p));

function contentOf(rel) {
  try {
    return readText(rel);
  } catch {
    return null;
  }
}

test('no profile carries a concrete organisation, tenant or subscription value', () => {
  assert.deepEqual(concreteIdentityValues(), [],
    'a profile names a real target; those fields must be null or a documented placeholder');
});

test('attendee-facing prose uses only allowlisted proper nouns', () => {
  assert.deepEqual(unknownProperNouns(), [],
    'an unrecognised proper noun reached a public document');
});

test('neutrality is structural: the repository carries no list of real names', () => {
  assert.ok(!('forbiddenTerms' in config),
    'the public configuration must not carry a denylist of real names');
  const neutrality = config.neutrality;
  assert.ok(Array.isArray(neutrality.allowedProperNouns) && neutrality.allowedProperNouns.length > 20,
    'the allowlist is missing or too small to be meaningful');
  assert.ok(neutrality.identityFields.includes('tenantId'));
  assert.ok(neutrality.identityFields.includes('subscriptionId'));
  assert.equal(neutrality.localOverridesFile, '.showcase.local.json');

  // The optional local file is documented by example and can never be committed.
  assert.ok(exists('.showcase.local.example.json'), 'the local override example is missing');
  assert.ok(!exists('.showcase.local.json'), 'a local override file must never be committed');
  const ignore = readText('.gitignore');
  assert.ok(/\*\.local\.json|\.showcase\.local\.json/.test(ignore),
    '.gitignore does not exclude the local override file');
});

test('the profile targets are supplied on the command line, not stored', () => {
  for (const id of listProfiles()) {
    const profile = loadProfile(id);
    assert.equal(profile.target.owner, null, `${id} stores an owner`);
    assert.equal(profile.target.repo, null, `${id} stores a repository`);
    assert.match(profile.target.$comment, /command line/i,
      `${id} does not say the target is supplied on the command line`);
  }
});

test('the data files declare themselves synthetic', () => {
  for (const file of ['app/data/catalog.json', 'app/data/inventory.json']) {
    const data = JSON.parse(readText(file));
    assert.match(data.$comment, /synthetic/i, `${file} does not declare itself synthetic`);
  }
  const telemetry = readText('fixtures/telemetry/reservation-events.jsonl').trim().split('\n');
  assert.ok(telemetry.length > 100, 'the telemetry fixture is suspiciously small');
  for (const line of telemetry.slice(0, 25)) {
    const event = JSON.parse(line);
    assert.match(event.sku, /^SKU-\d{4}$/, 'telemetry references a non-synthetic SKU shape');
    assert.match(event.siteId, /^SITE-[A-Z]+$/, 'telemetry references a non-synthetic site shape');
  }
});

test('no tenant, subscription, or directory identifier is committed', () => {
  const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  const offenders = [];
  for (const rel of TEXT_FILES) {
    const content = contentOf(rel);
    if (content && GUID.test(content)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `GUID-shaped identifier(s) found in: ${offenders.join(', ')}`);
});

test('no emoji appears in authored content', () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  const offenders = [];
  for (const rel of TEXT_FILES) {
    const content = contentOf(rel);
    if (content && EMOJI.test(content)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `emoji found in: ${offenders.join(', ')}`);
});

test('no secret-shaped value is committed', () => {
  const PATTERNS = [
    /\bgh[pousr]_[A-Za-z0-9]{16,}/,
    /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/
  ];
  const offenders = [];
  for (const rel of TEXT_FILES) {
    const content = contentOf(rel);
    if (!content) continue;
    for (const pattern of PATTERNS) {
      if (pattern.test(content)) offenders.push(`${rel}: ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], `secret-shaped value(s) found:\n${offenders.join('\n')}`);
});

test('every document has exactly one h1 and no duplicate element id', () => {
  for (const doc of ['docs/index.html', 'docs/showcase.html', 'docs/presenter.html', 'docs/mission-control.html']) {
    const html = readText(doc);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${doc} does not have exactly one h1`);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    assert.deepEqual(duplicates, [], `${doc} has duplicate id(s): ${duplicates.join(', ')}`);
  }
});

test('every internal anchor in every document resolves', () => {
  for (const doc of ['docs/index.html', 'docs/showcase.html', 'docs/presenter.html', 'docs/mission-control.html']) {
    const html = readText(doc);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const anchors = [...new Set([...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]))];
    const broken = anchors.filter((a) => !ids.has(a));
    assert.deepEqual(broken, [], `${doc} has broken anchor(s): ${broken.join(', ')}`);
  }
});

test('every relative link in every document resolves to a file that exists', () => {
  const allFiles = new Set(walk().map(relPath));
  for (const doc of ['docs/index.html', 'docs/showcase.html', 'docs/presenter.html', 'docs/mission-control.html']) {
    const html = readText(doc);
    const links = [...html.matchAll(/(?:href|src)="([^"#:]+)(?:#[^"]*)?"/g)]
      .map((m) => m[1])
      .filter((h) => h && !h.startsWith('//') && !h.startsWith('data:'));
    const missing = [];
    for (const link of [...new Set(links)]) {
      const target = link.startsWith('../')
        ? link.replace(/^\.\.\//, '')
        : `docs/${link.replace(/^\.\//, '')}`;
      if (!allFiles.has(target)) missing.push(`${link} -> ${target}`);
    }
    assert.deepEqual(missing, [], `${doc} has unresolvable link(s): ${missing.join(', ')}`);
  }
});

test('the markdown documents link only to files that exist', () => {
  const allFiles = new Set(walk().map(relPath));
  for (const doc of ['README.md', 'AGENTS.md', 'ATTRIBUTION.md', 'docs/spec/SPEC-001-substitute-suggestion.md', 'docs/spec/acceptance-mapping.md', 'docs/spec/ADR-0001-substitute-selection.md']) {
    const md = readText(doc);
    const base = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/')) : '';
    const links = [...md.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)]
      .map((m) => m[1])
      .filter((h) => !/^https?:/.test(h) && !h.startsWith('mailto:'));
    const missing = [];
    for (const link of [...new Set(links)]) {
      const target = base ? `${base}/${link}`.replace(/\/\.\//g, '/') : link;
      const normalised = target.split('/').reduce((acc, part) => {
        if (part === '..') acc.pop();
        else if (part !== '.') acc.push(part);
        return acc;
      }, []).join('/');
      const isDirectory = normalised.endsWith('/');
      const probe = isDirectory ? normalised.slice(0, -1) : normalised;
      const found = allFiles.has(probe) || [...allFiles].some((f) => f.startsWith(`${probe}/`));
      if (!found) missing.push(`${link} -> ${probe}`);
    }
    assert.deepEqual(missing, [], `${doc} has unresolvable link(s): ${missing.join(', ')}`);
  }
});

test('the sandbox and enterprise profiles are interchangeable in shape', () => {
  const ids = listProfiles();
  assert.ok(ids.includes('sandbox') && ids.includes('enterprise'));
  const shapes = ids.map((id) => loadProfile(id));
  const keys = shapes.map((p) => Object.keys(p).filter((k) => k !== '_config').sort().join(','));
  assert.equal(new Set(keys).size, 1, 'profiles do not share the same top-level shape');

  const capabilityKeys = shapes.map((p) => Object.keys(p.capabilities).sort().join(','));
  assert.equal(new Set(capabilityKeys).size, 1, 'profiles do not declare the same capability set');
});

test('no profile hard-codes an organisation, repository, or tenant', () => {
  for (const id of listProfiles()) {
    const profile = loadProfile(id);
    assert.equal(profile.target.owner, null, `profile "${id}" hard-codes an owner`);
    assert.equal(profile.target.repo, null, `profile "${id}" hard-codes a repository`);
    assert.match(
      profile.release.oidcSubjectPattern,
      /OWNER\/REPO/,
      `profile "${id}" hard-codes an OIDC subject`
    );
  }
});

test('every profile caps agent time and turns', () => {
  for (const id of listProfiles()) {
    const profile = loadProfile(id);
    assert.ok(profile.limits.agentTimeoutMinutes > 0, `profile "${id}" does not cap agent time`);
    assert.ok(profile.limits.agentMaxTurns > 0, `profile "${id}" does not cap agent turns`);
  }
});

test('capability states use the declared vocabulary', () => {
  const ALLOWED = new Set(['live', 'removed-ships-as-sample', 'depends-on-plan', 'live-if-entitled', 'not-available', 'preview-if-enrolled']);
  for (const id of listProfiles()) {
    const profile = loadProfile(id);
    for (const [name, state] of Object.entries(profile.capabilities)) {
      assert.ok(ALLOWED.has(state), `profile "${id}" capability "${name}" has unknown state "${state}"`);
    }
  }
});

test('the product validation date is stated once and used consistently', () => {
  const date = config.productValidationDate;
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(readJson('fixtures', 'prepared', 'manifest.json').productValidationDate, date);
  for (const doc of ['README.md', 'AGENTS.md', 'ATTRIBUTION.md']) {
    assert.ok(readText(doc).includes(date), `${doc} does not carry the validation date`);
  }
});

test('the allowlist mechanism actually catches an unknown organisation name', () => {
  // Proof the check is load-bearing rather than decorative: a name that is not
  // allowlisted must be reported when it appears mid-sentence in prose.
  const sample = '<p>The reservation service was built for Northwind Traders and shipped.</p>';
  const found = properNounsIn(sample);
  assert.ok(found.has('Northwind'), 'the scanner missed an unknown proper noun');
  const allowed = new Set([
    ...config.neutrality.allowedProperNouns,
    ...(config.neutrality.sceneWords || [])
  ]);
  assert.ok(!allowed.has('Northwind'), 'the allowlist would have permitted an unknown name');
});

test('prose extraction ignores code, markup and inline literals', () => {
  const sample = '<p>Run it now.</p><pre><code>const Contoso = 1;</code></pre><p>Then read `Fabrikam` twice.</p>';
  const prose = proseOf(sample);
  assert.ok(!prose.includes('Contoso'), 'a code block leaked into the prose scan');
  assert.ok(!prose.includes('Fabrikam'), 'an inline literal leaked into the prose scan');
});

// --- the optional local screen ----------------------------------------------
//
// The screen is documented behaviour, so it is proved rather than assumed. Both
// tests write a real .showcase.local.json and remove it again, because the
// module decides whether to run by that file's existence. They run serially in
// one test body so the file can never be observed by a sibling test.

test('the local screen skips its own declaration and still catches a term elsewhere', () => {
  const overrides = repoPath('.showcase.local.json');
  const probeRel = 'out/local-screen-probe.txt';
  const probe = repoPath(probeRel);
  assert.ok(!existsSync(overrides), 'a local override file was already present; refusing to overwrite it');

  const TERM = 'aeloop-screen-probe-term';
  mkdirSync(repoPath('out'), { recursive: true });
  try {
    writeFileSync(overrides, `${JSON.stringify({ forbiddenTerms: [TERM] }, null, 2)}\n`);

    // 1. The declaration files carry the term by definition and must be exempt.
    const exempt = localScreenExemptions();
    assert.ok(exempt.has('.showcase.local.json'));
    assert.ok(exempt.has('.showcase.local.example.json'));

    const clean = localScreen(['.showcase.local.json', '.showcase.local.example.json', 'README.md']);
    assert.ok(clean && !clean.error, 'the screen did not run with a local file present');
    assert.equal(clean.terms, 1);
    assert.deepEqual(clean.offenders, [],
      'the screen reported its own declaration, or a repository file, as a finding');
    assert.equal(clean.scanned, 1, 'the screen did not skip exactly the two declaration files');

    // 2. The same term in any other eligible file is a finding, reported in one
    //    concise line that names the file and never echoes the term.
    writeFileSync(probe, `A line that mentions ${TERM} once.\n`);
    const dirty = localScreen(['.showcase.local.json', '.showcase.local.example.json', probeRel]);
    assert.deepEqual(dirty.offenders, [`${probeRel}: a locally screened term`]);
    for (const message of dirty.offenders) {
      assert.ok(!message.includes(TERM), 'the failure message echoes the screened term back into the log');
      assert.ok(message.length < 80, `the failure message is not concise: ${message}`);
    }
  } finally {
    rmSync(overrides, { force: true });
    rmSync(probe, { force: true });
  }

  assert.ok(!existsSync(overrides), 'the temporary local override file survived the test');
  assert.equal(localScreen(['README.md']), null,
    'the screen must be inert again once the local file is gone');
});

test('the local override file can never be committed', () => {
  assert.ok(!exists('.showcase.local.json'), 'a local override file is committed');
  const tracked = execFileSync('git', ['ls-files', '--', '.showcase.local.json'], {
    cwd: repoPath(), encoding: 'utf8'
  }).trim();
  assert.equal(tracked, '', '.showcase.local.json is tracked by git');
  const ignored = execFileSync('git', ['check-ignore', '-q', '.showcase.local.json'], {
    cwd: repoPath(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
  });
  assert.equal(ignored, '', 'git check-ignore did not confirm the exclusion');
});
