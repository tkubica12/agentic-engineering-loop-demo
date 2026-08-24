import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { repoPath, readText } from '../scripts/lib/repo.mjs';

const workflowDir = repoPath('.github', 'workflows');
const yamlFiles = readdirSync(workflowDir).filter((f) => f.endsWith('.yml') && !f.endsWith('.lock.yml'));
const lockFiles = readdirSync(workflowDir).filter((f) => f.endsWith('.lock.yml'));
const mdFiles = readdirSync(workflowDir).filter((f) => f.endsWith('.md'));

const read = (f) => readFileSync(join(workflowDir, f), 'utf8').replace(/\r\n/g, '\n');

test('there is at least one hand-written workflow and one agentic workflow', () => {
  assert.ok(yamlFiles.length >= 4, `expected several CI workflows, found ${yamlFiles.length}`);
  assert.ok(mdFiles.length >= 2, `expected several agentic workflows, found ${mdFiles.length}`);
});

test('no workflow uses pull_request_target', () => {
  for (const file of [...yamlFiles, ...lockFiles]) {
    assert.ok(!read(file).includes('pull_request_target'), `${file} uses pull_request_target`);
  }
});

test('every third-party action is pinned to a full 40-character commit SHA', () => {
  const usesLine = /^\s*uses:\s*([^\s#]+)/gm;
  for (const file of yamlFiles) {
    const content = read(file);
    for (const match of content.matchAll(usesLine)) {
      const ref = match[1];
      if (ref.startsWith('./') || ref.startsWith('.github/')) continue;
      const [, version] = ref.split('@');
      assert.ok(version, `${file}: "${ref}" has no ref`);
      assert.match(
        version,
        /^[0-9a-f]{40}$/,
        `${file}: "${ref}" is not pinned to a full commit SHA`
      );
    }
  }
});

test('every pinned action carries a human-readable version comment', () => {
  for (const file of yamlFiles) {
    for (const line of read(file).split('\n')) {
      if (!/^\s*uses:\s*[^.]/.test(line)) continue;
      assert.match(line, /#\s*v?\d/, `${file}: pinned action without a version comment: ${line.trim()}`);
    }
  }
});

test('every checkout disables credential persistence', () => {
  for (const file of yamlFiles) {
    const content = read(file);
    const checkouts = (content.match(/uses:\s*actions\/checkout@/g) ?? []).length;
    const persistFalse = (content.match(/persist-credentials:\s*false/g) ?? []).length;
    assert.equal(
      persistFalse,
      checkouts,
      `${file}: ${checkouts} checkout(s) but ${persistFalse} persist-credentials: false`
    );
  }
});

test('every CI workflow starts from an empty top-level permission set', () => {
  for (const file of yamlFiles) {
    assert.match(read(file), /^permissions:\s*\{\}\s*$/m, `${file} does not start from permissions: {}`);
  }
});

test('every CI job declares a timeout', () => {
  for (const file of yamlFiles) {
    const content = read(file);
    const jobsSection = content.slice(content.indexOf('\njobs:'));
    const jobNames = [...jobsSection.matchAll(/^ {2}([a-z][\w-]*):$/gm)].map((m) => m[1]);
    const timeouts = (jobsSection.match(/timeout-minutes:/g) ?? []).length;
    assert.ok(jobNames.length > 0, `${file}: no jobs found`);
    assert.equal(
      timeouts,
      jobNames.length,
      `${file}: ${jobNames.length} job(s) [${jobNames.join(', ')}] but ${timeouts} timeout(s)`
    );
  }
});

test('write permissions appear only where the job needs them', () => {
  const allowedWrites = new Set(['id-token', 'attestations', 'security-events', 'copilot-requests']);
  for (const file of yamlFiles) {
    for (const match of read(file).matchAll(/^\s{6}([\w-]+):\s*write$/gm)) {
      assert.ok(
        allowedWrites.has(match[1]),
        `${file}: unexpected write permission "${match[1]}: write"`
      );
    }
  }
});

test('every agentic workflow source has a compiled lock file', () => {
  for (const md of mdFiles) {
    const expected = md.replace(/\.md$/, '.lock.yml');
    assert.ok(lockFiles.includes(expected), `${md} has no ${expected}`);
  }
});

test('no lock file was hand-written', () => {
  for (const lock of lockFiles) {
    const head = read(lock).slice(0, 2000);
    assert.match(
      head,
      /gh-aw-metadata|automatically generated|DO NOT EDIT/i,
      `${lock} lacks a generated-file header`
    );
  }
});

test('every agentic workflow caps time, turns, and credits and enables threat detection', () => {
  for (const md of mdFiles) {
    const content = read(md);
    const frontmatter = content.split('---')[1] ?? '';
    assert.match(frontmatter, /timeout-minutes:\s*\d+/, `${md} has no timeout-minutes`);
    assert.match(frontmatter, /max-turns:\s*\d+/, `${md} has no max-turns`);
    assert.match(frontmatter, /max-ai-credits:\s*\d+/, `${md} has no max-ai-credits`);
    assert.match(frontmatter, /threat-detection:\s*true/, `${md} does not enable threat detection`);
  }
});

test('agentic workflow sources grant no repository write permission', () => {
  for (const md of mdFiles) {
    const frontmatter = read(md).split('---')[1] ?? '';
    const permBlock = frontmatter.match(/permissions:\n((?:\s{2,}\S.*\n)+)/);
    assert.ok(permBlock, `${md} declares no permissions block`);
    for (const match of permBlock[1].matchAll(/^\s+([\w-]+):\s*write\b/gm)) {
      assert.equal(
        match[1],
        'copilot-requests',
        `${md} grants repository write permission "${match[1]}: write"`
      );
    }
  }
});

test('no workflow interpolates a secret into an agent', () => {
  for (const md of mdFiles) {
    assert.ok(!/\$\{\{\s*secrets\./.test(read(md)), `${md} interpolates a secret`);
  }
});

test('the experimental lane source records the vendoring provenance and its removal upstream', () => {
  // shared/opencode.md is now a byte-for-byte copy of upstream (asserted
  // separately), so the provenance and removal disclosure lives in the lane
  // source that owns the vendoring decision.
  const vendored = readText('.github', 'workflows', 'issue-intake-opencode.md');
  assert.match(vendored, /Blob SHA:\s+d875e158b1500f7adc3e8c8616a5b849f2dd44d7/, 'no source blob SHA recorded');
  assert.match(vendored, /github\/gh-aw/, 'no upstream repository recorded');
  assert.match(vendored, /ADR-50145/, 'the removal decision is not cited');
  assert.match(vendored, /2026-08-04/, 'the removal decision is not dated');
  assert.match(vendored, /2b9a9f468691497687f9111dcb3282d64f4b5113/, 'the ADR blob SHA is not recorded');
  assert.match(vendored, /a18ad3749be79330e0e07fd5875fe516a381e717/, 'the changeset blob SHA is not recorded');
  assert.match(vendored, /no longer\s+compile or validate/, 'the changeset consequence is not quoted');
  assert.match(vendored, /samples only/, 'the current shipped status is not quoted');
  assert.match(vendored, /experimental: true/, 'the experimental marker is not noted');
});

test('the experimental lane is labelled honestly in its own source', () => {
  const content = read('issue-intake-opencode.md');
  assert.match(content, /ADR-50145/, 'the source does not cite the removal decision');
  assert.match(content, /2026-08-04/, 'the source does not date the removal decision');
  assert.match(content, /2026-08-23/, 'the source does not date its own verification');
  assert.match(content, /no compatibility or maintenance commitment/, 'the source omits the support disclaimer');
  assert.match(content, /issue-intake\.md/, 'the source does not name the supported fallback');
});

test('the upstream references agree across every file that cites them', () => {
  const ADR = 'ADR-50145';
  const ADR_DATE = '2026-08-04';
  const ADR_BLOB = '2b9a9f468691497687f9111dcb3282d64f4b5113';
  const CHANGESET_BLOB = 'a18ad3749be79330e0e07fd5875fe516a381e717';
  const DEFINITION_BLOB = 'd875e158b1500f7adc3e8c8616a5b849f2dd44d7';
  // Matched as a documentation path rather than a full URL. Asserting that a
  // file contains a URL literal reads like URL sanitisation to static analysis,
  // and CodeQL flags it as js/incomplete-url-substring-sanitization. The path
  // is the part that identifies the page anyway.
  const DOCS_PAGE = 'copilot/concepts/agents/about-third-party-coding-agents';

  // The decision is cited wherever the lane's status is described.
  for (const file of ['README.md', 'ATTRIBUTION.md', 'docs/showcase.html', 'docs/mission-control.html']) {
    assert.match(readText(file), new RegExp(ADR), `${file} does not cite ${ADR}`);
  }
  for (const file of ['README.md', 'ATTRIBUTION.md', 'docs/showcase.html', 'docs/mission-control.html']) {
    assert.match(readText(file), new RegExp(ADR_DATE.replace(/-/g, '.?') + '|4 August 2026'), `${file} does not date the decision`);
  }

  // The exact blob SHAs live in the two places a reader would check them.
  const attribution = readText('ATTRIBUTION.md');
  for (const sha of [ADR_BLOB, CHANGESET_BLOB, DEFINITION_BLOB]) {
    assert.ok(attribution.includes(sha), `ATTRIBUTION.md omits blob ${sha}`);
  }

  // The lane source and the attribution agree on which blob was taken.
  assert.ok(
    readText('.github', 'workflows', 'issue-intake-opencode.md').includes(DEFINITION_BLOB),
    'the lane source and ATTRIBUTION.md disagree on the definition blob'
  );

  // The third-party agents page is cited with its preview status, and stays peripheral.
  assert.ok(attribution.includes(DOCS_PAGE), 'ATTRIBUTION.md does not cite the third-party agents page');
  const matrix = readText('fixtures/prepared/09-adoption-matrix.json');
  assert.ok(matrix.includes(DOCS_PAGE), 'the adoption matrix does not cite the third-party agents page');
  assert.match(matrix, /"Third-party coding agents on GitHub", "state": "Public preview"/, 'third-party agents are not marked public preview');

  // Claude and Codex are named, but never as the demonstration lane.
  const showcase = readText('docs/showcase.html');
  assert.match(showcase, /Anthropic Claude and OpenAI Codex/, 'the supported third-party agents are not named');
  assert.match(showcase, /Nothing in this repository depends on either/, 'the showcase does not bound the claim');
});

test('no document still claims the removal decision is unverifiable', () => {
  const stale = [/could not be found/i, /does not exist/i, /widely repeated claim/i];
  const statusFiles = ['README.md', 'ATTRIBUTION.md', 'docs/showcase.html', 'docs/presenter.html', 'docs/mission-control.html', 'fixtures/prepared/02-intake-result.json', 'fixtures/prepared/04-lane-comparison.json', 'fixtures/prepared/09-adoption-matrix.json'];
  for (const file of statusFiles) {
    const content = readText(file);
    for (const pattern of stale) {
      assert.ok(!pattern.test(content), `${file} still carries the superseded treatment: ${pattern}`);
    }
  }
  // The superseded ADR number must not survive anywhere, including the rules file.
  for (const file of [...statusFiles, 'AGENTS.md']) {
    assert.ok(!/\b25830\b/.test(readText(file)), `${file} still cites the superseded ADR 25830`);
  }
});

test('the experimental lane has a supported counterpart importing the same brief', () => {
  const experimental = read('issue-intake-opencode.md');
  const supported = read('issue-intake.md');
  assert.match(experimental, /shared\/intake-brief\.md/);
  assert.match(supported, /shared\/intake-brief\.md/);
  assert.match(experimental, /engine:\s*\n\s*id:\s*opencode/);
  assert.match(supported, /engine:\s*copilot/);
});

// ---------------------------------------------------------------------------
// Item 18: assert security properties against the COMPILED locks, not just the
// Markdown source. The lock is what actually runs in CI, so the properties are
// checked on the generated YAML. Nothing below is described as "enforced" by an
// external policy engine; each assertion states only what gh-aw v0.86.2
// actually emitted, verified by reading the locks.
// ---------------------------------------------------------------------------

// The two supported Copilot lanes and the one experimental OpenCode lane.
const supportedLocks = ['issue-intake.lock.yml', 'repository-pulse.lock.yml'];
const openCodeLock = 'issue-intake-opencode.lock.yml';

// Slice the `jobs:` mapping out of a lock and return each job body keyed by
// name. `on:` triggers (issues:, schedule:, workflow_dispatch:) are also
// two-space indented, so parsing starts at the jobs section to avoid them.
// Everything inside a job is indented four or more spaces, so a two-space
// `name:` line inside the jobs section is always a job header.
function jobBlocks(content) {
  const jobsIdx = content.indexOf('\njobs:\n');
  assert.ok(jobsIdx !== -1, 'lock has no jobs: section');
  const section = content.slice(jobsIdx);
  const headers = [...section.matchAll(/^ {2}([a-z][\w-]*):\n/gm)];
  const blocks = {};
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index + headers[i][0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index : section.length;
    blocks[headers[i][1]] = section.slice(start, end);
  }
  return blocks;
}

test('lock: no compiled lock triggers on pull_request_target', () => {
  for (const f of lockFiles) {
    assert.ok(!read(f).includes('pull_request_target'), `${f} triggers on pull_request_target`);
  }
});

test('lock: every action reference is pinned to a full 40-character commit SHA', () => {
  const usesLine = /^\s*uses:\s*([^\s#]+)/gm;
  for (const f of lockFiles) {
    for (const match of read(f).matchAll(usesLine)) {
      const ref = match[1];
      if (ref.startsWith('./') || ref.startsWith('.github/')) continue;
      const [, version] = ref.split('@');
      assert.ok(version, `${f}: "${ref}" has no ref`);
      assert.match(version, /^[0-9a-f]{40}$/, `${f}: "${ref}" is not pinned to a full commit SHA`);
    }
  }
});

test('lock: every checkout the compiler emits disables credential persistence', () => {
  // Verified against gh-aw v0.86.2 output: the compiler emits an explicit
  // persist-credentials: false on every actions/checkout it generates (3 per
  // lock). This asserts the true emitted property rather than assuming it.
  for (const f of lockFiles) {
    const content = read(f);
    const checkouts = (content.match(/uses:\s*actions\/checkout@/g) ?? []).length;
    const persistFalse = (content.match(/persist-credentials:\s*false/g) ?? []).length;
    assert.ok(checkouts > 0, `${f}: expected at least one checkout`);
    assert.equal(
      persistFalse,
      checkouts,
      `${f}: ${checkouts} checkout(s) but ${persistFalse} persist-credentials: false`
    );
  }
});

test('lock: the agent job has read-only repository permissions', () => {
  // The agent job is where the model executes. In every lock it currently
  // declares only read grants; it has zero write permissions. allowedWrites
  // mirrors the repo's hand-written CI allowlist and exists only to catch a
  // future regression, not because the agent job uses any of them today.
  const allowedWrites = new Set(['id-token', 'attestations', 'security-events', 'copilot-requests']);
  for (const f of lockFiles) {
    const agent = jobBlocks(read(f)).agent;
    assert.ok(agent, `${f}: no agent job found`);
    const perms = agent.match(/^ {4}permissions:\s*\n((?: {6}[\w-]+:.*\n)+)/m);
    assert.ok(perms, `${f}: agent job declares no permissions block`);
    for (const match of perms[1].matchAll(/^ {6}([\w-]+):\s*write\b/gm)) {
      assert.ok(
        allowedWrites.has(match[1]),
        `${f}: agent job has an unexpected write permission "${match[1]}: write"`
      );
    }
    assert.match(perms[1], /contents:\s*read/, `${f}: agent job does not grant contents: read`);
  }
});

test('lock: supported Copilot lanes withhold the Copilot token from the model sandbox', () => {
  // The supported lanes launch the sandbox through the AWF wrapper with an
  // explicit --exclude-env list. COPILOT_GITHUB_TOKEN is on it, and no secret
  // is mapped into the sandbox under the OPENAI_API_KEY alias.
  for (const f of supportedLocks) {
    const content = read(f);
    assert.match(
      content,
      /--exclude-env COPILOT_GITHUB_TOKEN/,
      `${f}: the sandbox invocation does not exclude COPILOT_GITHUB_TOKEN`
    );
    assert.ok(
      !/OPENAI_API_KEY/.test(content),
      `${f}: a supported lane must not map any secret to OPENAI_API_KEY`
    );
  }
});

test('lock: the OpenCode lane maps the Copilot token to OPENAI_API_KEY as a documented, allowlisted exception', () => {
  // KNOWN EXCEPTION (not a supported-lane property): the experimental OpenCode
  // engine sets secret-strategy/provider-env-mode: universal-llm-consumer, so
  // the compiler injects OPENAI_API_KEY: ${{ secrets.COPILOT_GITHUB_TOKEN }}
  // into the sandbox. That alias is NOT on the --exclude-env list, so the
  // Copilot token reaches the model here. The full disclosure lives in the
  // frontmatter comments of .github/workflows/issue-intake-opencode.md. This test
  // asserts the exception exists AND stays disclosed; it is not an endorsement.
  const content = read(openCodeLock);
  const mapping = /OPENAI_API_KEY:\s*\$\{\{\s*secrets\.COPILOT_GITHUB_TOKEN\s*\}\}/;
  assert.match(content, mapping, `${openCodeLock}: expected the documented OPENAI_API_KEY mapping to be present`);
  // The token is still excluded under its own name; the exposure is only via
  // the OPENAI_API_KEY alias.
  assert.match(
    content,
    /--exclude-env COPILOT_GITHUB_TOKEN/,
    `${openCodeLock}: COPILOT_GITHUB_TOKEN is not excluded under its own name`
  );

  // Fail if the exception is ever silently removed from the documentation.
  // The disclosure is the frontmatter comment block in issue-intake-opencode.md
  // (shared/opencode.md is a verbatim upstream copy and carries no local notes).
  const disclosure = readText('.github', 'workflows', 'issue-intake-opencode.md');
  assert.match(disclosure, /OPENAI_API_KEY/, 'issue-intake-opencode.md no longer discloses the OPENAI_API_KEY mapping');
  assert.match(disclosure, /COPILOT_GITHUB_TOKEN/, 'issue-intake-opencode.md no longer names the token that is mapped');
  assert.match(disclosure, /exclude-env/, 'issue-intake-opencode.md no longer explains the mapping escapes the exclude-env list');
  assert.match(disclosure, /allowlisted exception/i, 'issue-intake-opencode.md no longer flags the mapping as an allowlisted exception');

  // Fail if the same mapping ever appears in a supported lane.
  for (const f of supportedLocks) {
    assert.ok(!/OPENAI_API_KEY/.test(read(f)), `${f}: the OPENAI_API_KEY exception leaked into a supported lane`);
  }
});

// ---------------------------------------------------------------------------
// Item 19: the intake-please gate must be a real, compiled job-level `if:`,
// not a prose instruction to the model. gh-aw compiles a trigger's `names:`
// label filter into guarded `if:` conditions
// (docs: https://github.github.com/gh-aw/reference/triggers/, "Label filtering").
// ---------------------------------------------------------------------------

test('lock: the supported issue-intake lane gates on the intake-please label deterministically', () => {
  const blocks = jobBlocks(read('issue-intake.lock.yml'));
  const gate = /github\.event\.label\.name == 'intake-please'/;
  // pre_activation is the earliest job; its guard short-circuits before any AI
  // credits are spent. activation carries the same guard.
  assert.match(blocks.pre_activation, gate, 'pre_activation is not gated on the intake-please label');
  assert.match(blocks.activation, gate, 'activation is not gated on the intake-please label');
  // The guard is a genuine skip condition: on a labeled issue whose label is
  // not intake-please the OR is false and the job does not run. workflow_dispatch
  // (event_name != 'issues') passes through so the lane stays manually runnable.
  assert.match(
    blocks.pre_activation,
    /if: github\.event_name != 'issues' \|\| github\.event\.action != 'labeled' \|\| github\.event\.label\.name == 'intake-please'/,
    'the pre_activation gate is not the expected deterministic label condition'
  );
  // And the gate is not merely a comment in the model prompt: the agent job's
  // prompt no longer instructs the model to stop on the wrong label.
  assert.ok(
    !/Run only when the triggering label/i.test(read('issue-intake.md')),
    'issue-intake.md still carries the superseded model-prose gate'
  );
});

// ---------------------------------------------------------------------------
// Item 16: shared/opencode.md must be a verbatim copy of upstream blob
// d875e158b1500f7adc3e8c8616a5b849f2dd44d7 (github/gh-aw path
// .github/workflows/shared/opencode.md). "Verbatim" is made a checked fact by
// recomputing the file's git blob SHA from its raw bytes: sha1 of
// "blob " + <byte length> + "\0" + <bytes>. The raw bytes are read without any
// line-ending normalisation, because normalising would change the SHA.
// ---------------------------------------------------------------------------

test('the vendored OpenCode definition is byte-identical to the upstream blob', () => {
  const UPSTREAM_BLOB = 'd875e158b1500f7adc3e8c8616a5b849f2dd44d7';
  const bytes = readFileSync(join(workflowDir, 'shared', 'opencode.md'));
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  const sha = createHash('sha1').update(Buffer.concat([header, bytes])).digest('hex');
  assert.equal(
    sha,
    UPSTREAM_BLOB,
    `shared/opencode.md is not byte-identical to upstream blob ${UPSTREAM_BLOB}; git blob SHA is ${sha}. ` +
      'Re-vendor it verbatim from github/gh-aw .github/workflows/shared/opencode.md.'
  );
});

// ---------------------------------------------------------------------------
// Item 17: state the engine-credential sandbox boundary exactly, read from the
// compiled locks. The supported agent sandbox excludes five named credentials;
// the threat-detection sandbox excludes the three present there; the OpenCode
// lane keeps those exclusions and additionally maps OPENAI_API_KEY to the
// Copilot token (the disclosed, allowlisted exception).
// ---------------------------------------------------------------------------

const AGENT_EXCLUDED_FIVE = [
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'COPILOT_GITHUB_TOKEN',
  'GITHUB_MCP_SERVER_TOKEN',
  'MCP_GATEWAY_API_KEY',
];
const DETECTION_EXCLUDED_THREE = [
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'COPILOT_GITHUB_TOKEN',
];

// Return the credentials named on a job's `awf ... --exclude-env` sandbox line.
function sandboxExclusions(jobBody) {
  const awf = jobBody.split('\n').find((l) => l.includes('--exclude-env'));
  assert.ok(awf, 'job has no --exclude-env sandbox invocation');
  return [...awf.matchAll(/--exclude-env (\S+)/g)].map((m) => m[1]);
}

test('lock: the supported agent sandbox excludes exactly the five named engine/MCP credentials', () => {
  for (const f of supportedLocks) {
    const agent = jobBlocks(read(f)).agent;
    assert.ok(agent, `${f}: no agent job`);
    assert.deepEqual(
      [...sandboxExclusions(agent)].sort(),
      [...AGENT_EXCLUDED_FIVE].sort(),
      `${f}: agent sandbox exclude-env list is not exactly the five named credentials`
    );
  }
});

test('lock: the supported threat-detection sandbox excludes exactly the three credentials present there', () => {
  for (const f of supportedLocks) {
    const detection = jobBlocks(read(f)).detection;
    assert.ok(detection, `${f}: no detection job`);
    const excluded = sandboxExclusions(detection);
    assert.deepEqual(
      [...excluded].sort(),
      [...DETECTION_EXCLUDED_THREE].sort(),
      `${f}: detection sandbox exclude-env list is not exactly the three named credentials`
    );
    // The two MCP credentials never reach the detection sandbox, so they are not
    // on its exclude list either. Assert their absence explicitly.
    assert.ok(!excluded.includes('GITHUB_MCP_SERVER_TOKEN'), `${f}: detection excludes GITHUB_MCP_SERVER_TOKEN unexpectedly`);
    assert.ok(!excluded.includes('MCP_GATEWAY_API_KEY'), `${f}: detection excludes MCP_GATEWAY_API_KEY unexpectedly`);
  }
});

test('the prepared evidence names all five excluded variables and splits them correctly', () => {
  // The article and the fallback both say "five named variables". The fixture is
  // where that claim is written down, so it must name the same five the compiled
  // lock excludes, and it must keep the distinction: three are engine or MCP
  // credentials, two are the OIDC request variables a job would use to mint a
  // federated token. Conflating them would overstate what is being withheld.
  const boundary = JSON.parse(readText('fixtures', 'prepared', '06-pr-evidence.json')).credentialBoundary;
  const named = boundary.excludedFromAgentSandbox;
  assert.deepEqual(named.map((e) => e.name).sort(), [...AGENT_EXCLUDED_FIVE].sort(),
    'the fixture does not name exactly the five variables the lock excludes');

  const credentials = named.filter((e) => /credential$/.test(e.kind)).map((e) => e.name).sort();
  const oidc = named.filter((e) => e.kind === 'OIDC request variable').map((e) => e.name).sort();
  assert.deepEqual(credentials, ['COPILOT_GITHUB_TOKEN', 'GITHUB_MCP_SERVER_TOKEN', 'MCP_GATEWAY_API_KEY']);
  assert.deepEqual(oidc, ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL']);
  assert.deepEqual(boundary.excludedCounts, { total: 5, engineOrMcpCredentials: 3, oidcRequestVariables: 2 });

  // The detection sandbox claim must match the three the lock actually excludes.
  for (const cred of DETECTION_EXCLUDED_THREE) {
    assert.ok(boundary.threatDetectionSandbox.includes(cred),
      `the fixture's detection claim omits ${cred}`);
  }

  // The wording rule stays the true property, never "holds no secret".
  assert.match(boundary.wording, /read-only GitHub permissions/);
  assert.match(boundary.wording, /Never say the agent job holds no secret/);
});

test('lock: the OpenCode lane keeps the same exclusions and maps OPENAI_API_KEY in both sandboxes', () => {
  const blocks = jobBlocks(read(openCodeLock));
  const mapping = /OPENAI_API_KEY:\s*\$\{\{\s*secrets\.COPILOT_GITHUB_TOKEN\s*\}\}/;
  for (const [jobName, expected] of [['agent', AGENT_EXCLUDED_FIVE], ['detection', DETECTION_EXCLUDED_THREE]]) {
    const job = blocks[jobName];
    assert.ok(job, `${openCodeLock}: no ${jobName} job`);
    const excluded = sandboxExclusions(job);
    for (const cred of expected) {
      assert.ok(excluded.includes(cred), `${openCodeLock}: ${jobName} sandbox does not exclude ${cred}`);
    }
    assert.match(job, mapping, `${openCodeLock}: ${jobName} job does not map OPENAI_API_KEY to the Copilot token`);
  }
});

// ---------------------------------------------------------------------------
// Item 18: the experimental OpenCode lane must not auto-trigger on issue
// creation. It is gated behind the unique aeloop:experimental-intake label (or
// manual dispatch), mirroring the supported lane's deterministic label gate, so
// seeding an issue never starts it.
// ---------------------------------------------------------------------------

test('the experimental lane does not trigger on issue open or reopen', () => {
  const frontmatter = read('issue-intake-opencode.md').split('---')[1] ?? '';
  // Scope the check to the on: block: the comment header legitimately mentions
  // "opened/reopened" while explaining that the lane no longer triggers on them.
  const onBlock = frontmatter.match(/\non:\n((?: {2,}.*\n)+)/);
  assert.ok(onBlock, 'issue-intake-opencode.md has no on: trigger block');
  const triggers = onBlock[1];
  assert.ok(!/opened/.test(triggers) && !/reopened/.test(triggers), 'the experimental lane still triggers on opened/reopened');
  assert.match(triggers, /types:\s*\[labeled\]/, 'the experimental lane is not gated on a label event');
  assert.match(triggers, /aeloop:experimental-intake|aeloop-experimental-intake/, 'the experimental lane is not gated on the unique aeloop experimental label');
  assert.match(triggers, /workflow_dispatch:/, 'the experimental lane cannot be manually dispatched');
});

test('lock: the experimental lane gates on the unique aeloop experimental label deterministically', () => {
  const blocks = jobBlocks(read(openCodeLock));
  assert.ok(blocks.pre_activation, `${openCodeLock}: no pre_activation job`);
  const gate = /github\.event\.label\.name == '(aeloop:experimental-intake|aeloop-experimental-intake)'/;
  assert.match(blocks.pre_activation, gate, 'pre_activation is not gated on the aeloop experimental label');
  assert.ok(!/'opened'|'reopened'/.test(blocks.pre_activation), 'the experimental gate still references opened/reopened');
});

// ---------------------------------------------------------------------------
// Item 15: the lock-freshness comparison is TOTAL — byte-for-byte, with line
// endings normalised only. There is deliberately no ignored-field carve-out.
// The freshness field GH_AW_ACTION_FAILURE_ISSUE_EXPIRES_HOURS is deterministic
// ("0") under the pinned compiler, so no per-field normalisation is justified.
// ---------------------------------------------------------------------------

const validateSrc = readText('scripts', 'validate-aw.mjs');

test('validate-aw.mjs has no ignored-field carve-out in the freshness comparison', () => {
  assert.ok(!/UNSTABLE_FIELDS/.test(validateSrc), 'validate-aw.mjs still names an UNSTABLE_FIELDS carve-out');
  assert.ok(!/\bcomparable\s*\(/.test(validateSrc), 'validate-aw.mjs still routes locks through a comparable() normaliser');
});

test('validate-aw.mjs compares locks byte-for-byte, normalising line endings only', () => {
  assert.match(
    validateSrc,
    /normalise\(regenerated\)\s*===\s*normalise\(committed\)/,
    'freshness compare is not a total byte-for-byte equality'
  );
  // normalise touches CRLF -> LF and nothing else.
  assert.match(
    validateSrc,
    /const normalise = \(buf\) => buf\.toString\('utf8'\)\.replace\(\/\\r\\n\/g, '\\n'\)/,
    'normalise does more than collapse CRLF to LF'
  );
});

test('the expires-hours field is inside the compared bytes', () => {
  // Prove the comparison is total at the data level: flipping only the
  // GH_AW_ACTION_FAILURE_ISSUE_EXPIRES_HOURS value must make the normalised
  // bytes differ. If a carve-out still stripped it, these would compare equal.
  const normalise = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n');
  const committedBytes = readFileSync(join(workflowDir, 'issue-intake.lock.yml'));
  const committed = normalise(committedBytes);
  assert.match(
    committed,
    /GH_AW_ACTION_FAILURE_ISSUE_EXPIRES_HOURS: "168"/,
    'expected the compiler-generated "168" value in the committed lock'
  );
  const edited = committed.replace(
    'GH_AW_ACTION_FAILURE_ISSUE_EXPIRES_HOURS: "168"',
    'GH_AW_ACTION_FAILURE_ISSUE_EXPIRES_HOURS: "0"'
  );
  assert.notEqual(
    normalise(Buffer.from(edited, 'utf8')),
    committed,
    'the expires-hours field is normalised away — the carve-out is not fully removed'
  );
});
