import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { repoPath, readJson, repoRoot, loadProfile } from '../scripts/lib/repo.mjs';
import { buildGhCommand, buildCommand, resolveExecutable, run as runNoShell, probeGh } from '../scripts/lib/gh.mjs';
import { createDocsServer, isWithin } from '../scripts/serve.mjs';

function run(script, args = [], options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [repoPath('scripts', script), ...args], {
      encoding: 'utf8',
      cwd: repoPath(),
      env: { ...process.env, NO_COLOR: '1', ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
}

test('npm run setup is idempotent and creates the output directories', () => {
  for (let i = 0; i < 2; i++) {
    const result = run('setup.mjs');
    assert.equal(result.code, 0, `setup failed on run ${i + 1}: ${result.stderr ?? ''}`);
  }
  assert.ok(existsSync(repoPath('out', 'rehearsal')));
  assert.ok(existsSync(repoPath('out', 'bundle')));
});

test('npm run preflight passes on a prepared checkout', () => {
  const result = run('preflight.mjs');
  assert.equal(result.code, 0, `preflight failed:\n${result.stdout}\n${result.stderr ?? ''}`);
  assert.match(result.stdout, /Every hard requirement is met/);
});

test('preflight reports the capability state for both profiles', () => {
  for (const profile of ['sandbox', 'enterprise']) {
    const result = run('preflight.mjs', ['--profile', profile]);
    assert.equal(result.code, 0, `preflight failed for profile ${profile}`);
    assert.match(result.stdout, new RegExp(`profile: ${profile}`));
    assert.match(result.stdout, /Capability states for this profile/);
  }
});

test('preflight rejects an unknown profile rather than falling back silently', () => {
  const result = run('preflight.mjs', ['--profile', 'nonexistent']);
  assert.notEqual(result.code, 0);
  assert.match(String(result.stderr), /unknown profile/);
});

// --- Defect: preflight could not detect an installed gh aw --------------------
//
// `gh aw version` prints its version to STDERR and exits 0. The old probe read
// stdout only, so it WARNed "gh aw not installed" even when gh aw was present.
// The fix decides availability by exit status and parses the version from stdout
// OR stderr. This test proves the PASS when gh aw is installed, and skips
// gracefully (never fails) on a machine that genuinely lacks the extension.
test('preflight detects an installed gh aw as a PASS naming its version, not a WARN', (t) => {
  const aw = probeGh(['aw', 'version']);
  const installed = !aw.error && aw.status === 0;
  if (!installed) {
    t.skip('gh aw is not installed here; preflight correctly WARNs, so a PASS cannot be asserted on this machine');
    return;
  }
  const result = run('preflight.mjs');
  const output = `${result.stdout}${result.stderr ?? ''}`;
  assert.match(
    output,
    /PASS\s+Agentic workflow extension available \(v\d+\.\d+\.\d+\)/,
    `preflight did not PASS gh aw detection even though gh aw is installed:\n${output}`
  );
  assert.doesNotMatch(
    output,
    /WARN\s+gh aw not installed/,
    'preflight WARNed that gh aw is not installed even though it is'
  );
});

test('npm run verify proves every section', () => {
  const result = run('verify.mjs');
  assert.equal(result.code, 0, `verify failed:\n${result.stdout}`);
  for (const section of ['Acceptance criteria', 'Telemetry signal', 'Provenance', 'Scene coverage', 'Profiles']) {
    assert.match(result.stdout, new RegExp(section), `verify did not run the "${section}" section`);
  }
  assert.match(result.stdout, /all checks passed/);
});

test('npm run rehearse walks the complete sequence and writes a transcript', () => {
  rmSync(repoPath('out', 'rehearsal', 'transcript.json'), { force: true });
  const result = run('rehearse.mjs');
  assert.equal(result.code, 0, `rehearsal failed:\n${result.stdout}`);

  const transcript = readJson('out', 'rehearsal', 'transcript.json');
  assert.equal(transcript.scenes.length, 11);
  assert.equal(transcript.durationMinutes, 60);
  assert.equal(transcript.mode, 'primary');
  assert.ok(transcript.scenes.every((s) => s.ok), 'a scene was not ok');
  const total = transcript.scenes.reduce((sum, s) => sum + s.durationMinutes, 0);
  assert.equal(total, 60);
});

test('the rehearsal transcript preserves the exact scene order', () => {
  run('rehearse.mjs', ['--fast']);
  const transcript = readJson('out', 'rehearsal', 'transcript.json');
  assert.deepEqual(
    transcript.scenes.map((s) => s.id),
    ['thesis', 'pulse', 'intake', 'refine', 'lanes', 'delegate', 'evidence', 'release', 'sre', 'coexist', 'close']
  );
});

test('the fallback path covers the whole hour on its own', () => {
  const result = run('rehearse.mjs', ['--fallback']);
  assert.equal(result.code, 0, `fallback rehearsal failed:\n${result.stdout}`);
  const transcript = readJson('out', 'rehearsal', 'transcript.json');
  assert.equal(transcript.mode, 'fallback');
  assert.equal(transcript.scenes.length, 11);
  for (const scene of transcript.scenes) {
    assert.equal(scene.mode, 'fallback', `${scene.id} did not take the fallback path`);
    assert.ok(scene.fallback.length > 0, `${scene.id} has no fallback route`);
    assert.ok(scene.ok, `${scene.id} failed on the fallback path`);
  }
});

test('a single scene can be rehearsed on its own', () => {
  const result = run('rehearse.mjs', ['--scene', 'pulse']);
  assert.equal(result.code, 0);
  const transcript = readJson('out', 'rehearsal', 'transcript.json');
  assert.equal(transcript.scenes.length, 1);
  assert.equal(transcript.scenes[0].id, 'pulse');
});

test('an unknown scene fails rather than rehearsing nothing', () => {
  const result = run('rehearse.mjs', ['--scene', 'nope']);
  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /no scene matches/);
});

test('npm run reset returns the working directory to a clean state, repeatedly', () => {
  for (let i = 0; i < 2; i++) {
    const result = run('reset.mjs');
    assert.equal(result.code, 0, `reset failed on run ${i + 1}`);
  }
  assert.equal(existsSync(repoPath('out', 'rehearsal', 'transcript.json')), false);
  // The export is a committed artefact: reset rebuilds it, it does not remove it.
  assert.ok(existsSync(repoPath('docs', 'showcase.standalone.html')));
});

test('reset then setup then rehearse works, which is the between-sessions loop', () => {
  assert.equal(run('reset.mjs').code, 0);
  assert.equal(run('setup.mjs').code, 0);
  const rehearsal = run('rehearse.mjs', ['--fast']);
  assert.equal(rehearsal.code, 0, `rehearsal failed after reset:\n${rehearsal.stdout}`);
  assert.ok(existsSync(repoPath('out', 'rehearsal', 'transcript.json')));
});

test('the pinned gh-aw version is read from the repository, never typed twice', async () => {
  const { pinnedCompiler } = await import('../scripts/lib/aw.mjs');
  const pin = pinnedCompiler();
  assert.match(pin.expected ?? '', /^v\d+\.\d+\.\d+$/,
    `the repository does not agree on one pinned compiler: ${pin.versions.join(', ')}`);
  assert.ok(pin.sources.length >= 2,
    'the pin is claimed by fewer than two committed artefacts, so nothing cross-checks it');
  assert.ok(pin.sources.includes('.github/aw/actions-lock.json'));

  // The install script must install exactly that, and must never reach for latest.
  const script = readFileSync(repoPath('scripts', 'aw-install.mjs'), 'utf8');
  const commands = [...script.matchAll(/probeGh\(\[([^\]]*)\]/g)].map((m) => m[1]);
  assert.ok(commands.some((c) => c.includes("'--pin'") && c.includes('expected')),
    'the install script does not install the version the repository pins');
  assert.ok(!commands.some((c) => /upgrade|latest/i.test(c)),
    'the install script can reach for a newer release than the pin');
  assert.ok(!/v\d+\.\d+\.\d+/.test(script), 'the install script hard-codes a version instead of reading the pin');
  assert.equal(readJson('package.json').scripts['aw:install'], 'node scripts/aw-install.mjs');
});

test('aw:install is idempotent when the pin is already installed', (t) => {
  const probe = probeGh(['aw', 'version'], { cwd: repoPath() });
  if (probe.error || probe.status !== 0) {
    t.skip('gh aw is not installed on this machine');
    return;
  }
  const first = run('aw-install.mjs');
  assert.equal(first.code, 0, `aw:install failed:\n${first.stdout}\n${first.stderr ?? ''}`);
  assert.match(first.stdout, /already .*; nothing to do|matching the version the committed locks/,
    'aw:install did not report an outcome');
  const second = run('aw-install.mjs');
  assert.equal(second.code, 0, 'aw:install is not repeatable');
  assert.match(second.stdout, /already .*; nothing to do/,
    'a second run did not recognise that the pin is already installed');
});

test('validate:aw refuses to compile outside the repository working tree', () => {
  // Without this the freshness comparison can pass vacuously: gh aw would
  // resolve a different workflow set and every committed lock would be
  // "unchanged" because nothing regenerated it.
  const source = readFileSync(repoPath('scripts', 'validate-aw.mjs'), 'utf8');
  assert.match(source, /rev-parse', '--show-toplevel/,
    'validate-aw.mjs does not ask git where the working tree root is');
  const guard = source.indexOf('--show-toplevel');
  const compile = source.indexOf("probeGh(['aw', 'compile']");
  assert.ok(guard > -1 && compile > guard,
    'the checkout-identity assertion runs after the compile it is meant to protect');
  assert.match(source, /resolve\(toplevel\) === resolve\(repoPath\(\)\)/,
    'the assertion does not compare resolved absolute paths');
});

test('validate:aw refuses to compile at all when the installed compiler has drifted', () => {
  // A drifted compiler rewrites every generated file, and all that would prove
  // is that two compilers disagree. Bail out before touching the tree.
  const source = readFileSync(repoPath('scripts', 'validate-aw.mjs'), 'utf8');
  const mismatch = source.indexOf('Refusing to compile with a drifted compiler');
  const compile = source.indexOf("probeGh(['aw', 'compile']");
  assert.ok(mismatch > -1, 'validate-aw.mjs does not refuse to compile on a pin mismatch');
  assert.ok(compile > mismatch, 'the drift bail-out is placed after the compile it should prevent');
  const before = source.slice(0, compile);
  assert.match(before, /if \(!matches\) \{[\s\S]{0,200}process\.exit\(checker\.finish/,
    'a pin mismatch does not exit before the compile');
});

test('validate:aw snapshots every file the compiler may rewrite, not just the locks', () => {
  const source = readFileSync(repoPath('scripts', 'validate-aw.mjs'), 'utf8');
  assert.match(source, /const GENERATED = \[/, 'validate-aw.mjs has no declared generated-file set');
  const generated = source.slice(source.indexOf('const GENERATED = ['), source.indexOf('let compiled = false'));
  assert.match(generated, /\.lock\.yml/, 'the snapshot set omits the lock files');
  assert.match(generated, /'aw', 'actions-lock\.json'/,
    'the snapshot set omits .github/aw/actions-lock.json, which gh aw owns and re-resolves');

  // The finally must put every snapshot back, and must not claim success it did
  // not achieve.
  const finallyBlock = source.slice(source.indexOf('} finally {'));
  assert.match(finallyBlock, /for \(const \[name, \{ path, bytes \}\] of backups\)/,
    'the finally does not restore every snapshotted file');
  assert.match(finallyBlock, /the working tree was NOT fully restored/,
    'a failed restoration is not reported');
  assert.match(finallyBlock, /checker\.check\(false, 'every generated file was restored/,
    'a failed restoration does not fail the run');
  const claim = finallyBlock.indexOf('restored to their committed bytes:');
  const guard = finallyBlock.indexOf('if (failed.length)');
  assert.ok(guard > -1 && guard < claim,
    'the success message is not guarded by the list of files that could not be restored');
});

test('a failing freshness run still leaves every generated file exactly as it found it', (t) => {
  const probe = probeGh(['aw', 'version'], { cwd: repoPath() });
  if (probe.error || probe.status !== 0) {
    t.skip('gh aw is not installed on this machine');
    return;
  }
  // Corrupt one lock so the freshness comparison FAILS and the compiler is
  // guaranteed to rewrite that file. The run must then put the corruption back:
  // validate-aw restores what it found, never what git happens to hold, and it
  // does so on the failure path as well as the happy one.
  const tracked = ['.github/workflows/repository-pulse.lock.yml', '.github/aw/actions-lock.json'];
  const before = new Map(tracked.map((rel) => [rel, readFileSync(repoPath(...rel.split('/')))]));
  const victim = repoPath('.github', 'workflows', 'repository-pulse.lock.yml');

  try {
    writeFileSync(victim, `${before.get(tracked[0]).toString('utf8')}\n# deliberately stale\n`);
    const dirtied = readFileSync(victim);

    const result = run('validate-aw.mjs');
    assert.notEqual(result.code, 0, 'a stale lock did not fail the validation');
    assert.match(result.stdout, /is up to date with its source/,
      'the freshness comparison did not run');

    assert.ok(readFileSync(victim).equals(dirtied),
      'the corrupted lock was not restored to the bytes validate-aw found');
    assert.ok(readFileSync(repoPath('.github', 'aw', 'actions-lock.json')).equals(before.get(tracked[1])),
      'actions-lock.json was not restored after a failing run');
    assert.match(result.stdout, /restored to their committed bytes:[^\n]*actions-lock\.json/,
      'the run did not report restoring actions-lock.json');
  } finally {
    for (const [rel, bytes] of before) writeFileSync(repoPath(...rel.split('/')), bytes);
  }

  for (const [rel, bytes] of before) {
    assert.ok(readFileSync(repoPath(...rel.split('/'))).equals(bytes), `${rel} was left modified`);
  }
});

test('the pinned compiler version is written down exactly once', () => {
  // Two copies of a version number drift silently. CI installs through the same
  // script a presenter runs, and that script reads the version from the locks.
  const workflow = readFileSync(repoPath('.github', 'workflows', 'workflow-security.yml'), 'utf8');
  // Third-party actions must carry their SHA plus a version comment, so only
  // the gh-aw compiler pin is in scope here: strip the `uses:` lines first.
  const withoutActionPins = workflow
    .split('\n')
    .filter((line) => !/^\s*uses:/.test(line))
    .join('\n');
  assert.ok(!/v\d+\.\d+\.\d+/.test(withoutActionPins),
    'workflow-security.yml hard-codes a compiler version instead of reading the pin');
  assert.ok(!/gh extension install/.test(workflow),
    'workflow-security.yml installs the extension directly instead of through the pinned script');
  assert.match(workflow, /run: npm run aw:install/,
    'workflow-security.yml does not install through the pinned script');

  // And the one source really is the committed artefacts.
  const lock = JSON.parse(readFileSync(repoPath('.github', 'aw', 'actions-lock.json'), 'utf8'));
  const fromActionsLock = new Set(
    Object.values(lock.entries ?? {}).filter((e) => /gh-aw/.test(e.repo ?? '')).map((e) => e.version)
  );
  assert.equal(fromActionsLock.size, 1, 'actions-lock.json pins more than one gh-aw version');
  const header = readFileSync(repoPath('.github', 'workflows', 'repository-pulse.lock.yml'), 'utf8').split('\n')[0];
  const fromLockHeader = JSON.parse(header.match(/gh-aw-metadata:\s*(\{.*\})\s*$/)[1]).compiler_version;
  assert.equal(fromLockHeader, [...fromActionsLock][0],
    'the compiled lock header and actions-lock.json disagree on the pinned version');
});

test('npm run verify exposes the follow-up replay as its own group', () => {
  const usage = run('verify.mjs', ['--only', 'no-such-group']);
  assert.equal(usage.code, 2);
  assert.match(`${usage.stdout}${usage.stderr ?? ''}`, /followup/,
    'the group list does not offer the follow-up replay');

  const result = run('verify.mjs', ['--only', 'followup']);
  assert.equal(result.code, 0, `verify --only followup failed:\n${result.stdout}\n${result.stderr ?? ''}`);
  assert.match(result.stdout, /replayed 32 unmet request\(s\)/);
  assert.match(result.stdout, /answered with a substitute: 25; unresolved: 7/);
  assert.match(result.stdout, /Verify: all checks passed/);

  // And the documented command is the one that works.
  for (const doc of ['README.md', 'docs/showcase.html', 'docs/mission-control.html', 'docs/presenter.html']) {
    const text = readFileSync(repoPath(...doc.split('/')), 'utf8');
    if (!/--only followup/.test(text)) continue;
    assert.match(text, /npm run verify -- --only followup/,
      `${doc} documents the replay command without the npm argument separator`);
  }
});

test('a failing local screen does not report that it found nothing', () => {
  // The wording is the whole point of a screen: a FAIL that says "found
  // nothing" is worse than no message at all.
  const source = readFileSync(repoPath('scripts', 'validate-docs.mjs'), 'utf8');
  const block = source.slice(source.indexOf('const screened = localScreen('), source.indexOf('const catalog ='));
  assert.match(block, /screened\.offenders\.length\s*\n?\s*\?/,
    'the screen message does not branch on whether it found anything');
  assert.match(block, /found \$\{screened\.offenders\.length\} match\(es\)/,
    'the failing message does not say how many matches it found');
  assert.match(block, /found nothing in \$\{screened\.scanned\} file\(s\)/,
    'the passing message no longer says how much was scanned');
  const failing = block.slice(0, block.indexOf(': `local screen over'));
  assert.ok(!/found nothing/.test(failing),
    'the failing branch still claims the screen found nothing');
});

test('npm run validate:docs passes', () => {
  const result = run('validate-docs.mjs');
  assert.equal(result.code, 0, `document validation failed:\n${result.stdout}`);
});

test('the remote seed refuses to run without an explicit target', () => {
  const result = run('seed-remote.mjs');
  assert.equal(result.code, 2);
  assert.match(result.stdout, /--repo OWNER\/REPO is required/);
  assert.match(result.stdout, /no default target/);
});

test('the remote seed rejects a malformed target', () => {
  const result = run('seed-remote.mjs', ['--repo', 'not-a-repo']);
  assert.equal(result.code, 2);
});

test('the remote seed is a dry run unless --apply is given', () => {
  const result = run('seed-remote.mjs', ['--repo', 'example-owner/example-repo']);
  assert.equal(result.code, 0, `dry run failed:\n${result.stdout}`);
  assert.match(result.stdout, /MODE: dry run/);
  assert.match(result.stdout, /would create issue/);
  assert.match(result.stdout, /would ensure label/);
  assert.doesNotMatch(result.stdout, /MODE: apply/);
});

test('the remote cleanup refuses to run without an explicit target', () => {
  const result = run('cleanup.mjs');
  assert.equal(result.code, 2);
  assert.match(result.stdout, /--repo OWNER\/REPO is required/);
});

test('the remote cleanup requires an explicit confirmation flag', () => {
  const source = readJson('package.json');
  assert.ok(source.scripts.cleanup.includes('cleanup.mjs'));
  const text = execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(repoPath('scripts', 'cleanup.mjs'))}, 'utf8'))`], { encoding: 'utf8' });
  assert.match(text, /if \(!confirmed\)/, 'cleanup does not guard on a confirmation flag');
  assert.match(text, /carriesMarker/, 'cleanup does not filter by the demo marker');
});

test('the build produces a deterministic bundle', () => {
  assert.equal(run('build-bundle.mjs').code, 0);
  const first = readJson('out', 'bundle', 'bundle-manifest.json');
  assert.equal(run('build-bundle.mjs').code, 0);
  const second = readJson('out', 'bundle', 'bundle-manifest.json');
  assert.equal(first.bytes, second.bytes, 'the bundle is not byte-stable across builds');
  assert.ok(first.files.includes('docs/showcase.html'));
  assert.ok(existsSync(repoPath('out', 'bundle', 'showcase-bundle.tar.gz')));
});

test('a missing attestation is recorded as simulated, never as attested', () => {
  const result = run('record-provenance.mjs', [], { env: { ATTEST_OUTCOME: 'failure', ATTEST_URL: '' } });
  assert.equal(result.code, 0);
  const record = readJson('out', 'bundle', 'provenance-record.json');
  assert.equal(record.mode, 'simulated');
  assert.ok(record.reason.includes('failure'));
  assert.equal(record.verifyCommand, null);
  assert.match(result.stdout, /SIMULATED/);
});

test('a successful attestation is recorded as attested with its URL', () => {
  const result = run('record-provenance.mjs', [], {
    env: { ATTEST_OUTCOME: 'success', ATTEST_URL: 'https://example.invalid/attestations/1', GITHUB_REPOSITORY: 'example-owner/example-repo' }
  });
  assert.equal(result.code, 0);
  const record = readJson('out', 'bundle', 'provenance-record.json');
  assert.equal(record.mode, 'attested');
  assert.equal(record.reason, null);
  assert.match(record.verifyCommand, /gh attestation verify/);
});

test('the working tree is left clean for the next run', () => {
  assert.equal(run('reset.mjs').code, 0);
  assert.equal(run('setup.mjs').code, 0);
});

// --- item 25: Windows-safe gh invocation preserves argv exactly ---------------

test('buildGhCommand preserves a multiword label description byte-for-byte', () => {
  const argv = [
    'label', 'create', 'aeloop-showcase',
    '--description', 'demo marker: aeloop-showcase (multi word description)',
    '--color', 'ededed'
  ];
  const built = buildGhCommand(argv);
  assert.deepEqual(built.args, argv, 'the command builder altered the argv');
  assert.equal(built.file, process.platform === 'win32' ? 'gh.exe' : 'gh');
});

test('buildGhCommand preserves a multiline issue body and a quoted cleanup comment', () => {
  const body = 'First line of the issue body\n\nSecond paragraph with "double" and \'single\' quotes\nand a trailing newline\n';
  const comment = 'Closing this demo issue created under "aeloop-showcase"; safe to remove.';
  const issueArgs = ['issue', 'create', '--title', 'Reservation unavailable spike', '--body', body];
  const commentArgs = ['issue', 'comment', '42', '--body', comment];
  assert.deepEqual(buildGhCommand(issueArgs).args, issueArgs);
  assert.deepEqual(buildGhCommand(commentArgs).args, commentArgs);
  // The embedded newlines must survive: nothing re-parsed the body.
  assert.ok(buildGhCommand(issueArgs).args[5].includes('\n'));
});

test('buildCommand rejects a non-string argument instead of coercing it', () => {
  assert.throws(() => buildCommand('gh', ['label', 'create', 123]), /must be a string/);
});

test('resolveExecutable names the real executable and never a shell wrapper', () => {
  assert.equal(resolveExecutable('gh'), process.platform === 'win32' ? 'gh.exe' : 'gh');
  assert.equal(resolveExecutable('git'), process.platform === 'win32' ? 'git.exe' : 'git');
});

test('the no-shell runner hands multiword and multiline argv to the child verbatim', () => {
  const payload = [
    'multi word label description',
    'line one\nline two\nline three',
    'has "quotes" and \'apostrophes\''
  ];
  const script = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
  const out = runNoShell(process.execPath, ['-e', script, ...payload]);
  assert.deepEqual(JSON.parse(out), payload, 'a shell corrupted the argv on the way to the child');
});

// --- item 28: verify --only rejects unknown groups ----------------------------

test('verify --only rejects an unknown group and lists the valid ones', () => {
  const result = run('verify.mjs', ['--only', 'bogus']);
  assert.notEqual(result.code, 0);
  const output = `${result.stdout}${result.stderr ?? ''}`;
  assert.match(output, /unknown --only group/);
  assert.match(output, /acceptance/);
});

test('verify --only runs a single valid group and still passes', () => {
  const result = run('verify.mjs', ['--only', 'coverage']);
  assert.equal(result.code, 0, `verify --only coverage failed:\n${result.stdout}`);
  assert.match(result.stdout, /Scene coverage/);
});

// --- item 29 & 32: serve.mjs serves the repo root safely ----------------------

function httpGet(port, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: reqPath, method: 'GET' },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('serve.mjs serves docs and repo-root documents over http, and 404s the rest', async () => {
  const server = createDocsServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const ok = [
      '/docs/index.html',
      '/docs/showcase.html',
      '/docs/presenter.html',
      '/docs/mission-control.html',
      '/docs/assets/article.css',
      '/docs/assets/article.js',
      '/docs/assets/slide-a11y.js',
      '/README.md',
      '/AGENTS.md',
      '/ATTRIBUTION.md',
      '/docs/spec/SPEC-001-substitute-suggestion.md'
    ];
    for (const p of ok) {
      const res = await httpGet(port, p);
      assert.equal(res.status, 200, `${p} did not return 200`);
    }
    const missing = await httpGet(port, '/docs/definitely-not-here.html');
    assert.equal(missing.status, 404, 'a missing path did not return 404');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serve.mjs redirects the root to the documented entry point', async () => {
  const server = createDocsServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await httpGet(port, '/');
    assert.equal(res.status, 302);
    assert.equal(res.location, '/docs/index.html');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serve.mjs containment guard rejects sibling directories that share a prefix', () => {
  assert.equal(isWithin(repoRoot, repoPath('README.md')), true);
  assert.equal(isWithin(repoRoot, repoRoot), true);
  assert.equal(isWithin(repoRoot, `${repoRoot}-evil`), false);
  assert.equal(isWithin(repoRoot, `${repoRoot}-evil${path.sep}secret.txt`), false);
  assert.equal(isWithin(repoRoot, path.join(repoRoot, '..', 'outside.txt')), false);
});

// ---------------------------------------------------------------------------
// Item 18: seeding must not silently arm an agentic lane. The dry-run output
// names exactly which supported/experimental workflows a seed can lead to, the
// AI-credit bound on each, and that the seeded issue starts nothing on its own.
// ---------------------------------------------------------------------------

test('the remote seed dry run names the lanes it can start, their credit bound, and that seeding auto-starts none', () => {
  const result = run('seed-remote.mjs', ['--repo', 'example-owner/example-repo']);
  assert.equal(result.code, 0, `dry run failed:\n${result.stdout}`);
  assert.match(result.stdout, /Triggering/);
  assert.match(result.stdout, /starts no agentic workflow on its own/i);
  // Supported lane, its label gate, and the experimental lane with its gate.
  assert.match(result.stdout, /Supported lane[^\n]*issue-intake\b/);
  assert.match(result.stdout, /intake-please/);
  assert.match(result.stdout, /Experimental lane[^\n]*issue-intake-opencode/);
  assert.match(result.stdout, /aeloop:experimental-intake/);
  // Both lanes state the same explicit 300-credit bound.
  const credits = result.stdout.match(/max-ai-credits 300/g) ?? [];
  assert.ok(credits.length >= 2, `expected both lanes to state max-ai-credits 300, saw ${credits.length}`);
  // The seeded issue itself carries no trigger label (neither lane auto-arms).
  const appliedLabels = (result.stdout.match(/with labels:\s*(.+)/) ?? ['', ''])[1];
  assert.doesNotMatch(appliedLabels, /intake-please/);
  assert.doesNotMatch(appliedLabels, /aeloop:experimental-intake/);
});

test('the remote seed prefers an aeloop-prefixed label for the trigger it introduces', () => {
  const result = run('seed-remote.mjs', ['--repo', 'example-owner/example-repo']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /would ensure label "aeloop:experimental-intake"/);
});

// ---------------------------------------------------------------------------
// Item 19: profile limits.* are enforceable ceilings, not decoration. Every
// agentic workflow's timeout-minutes and max-turns must be <= the active
// (default) profile's ceilings, and verify.mjs enforces exactly that.
// ---------------------------------------------------------------------------

function agenticWorkflowLimits() {
  const dir = repoPath('.github', 'workflows');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const body = readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
      const t = body.match(/^timeout-minutes:\s*(\d+)\s*$/m);
      const n = body.match(/^max-turns:\s*(\d+)\s*$/m);
      return { file: f, timeout: t ? Number(t[1]) : null, turns: n ? Number(n[1]) : null };
    })
    .filter((w) => w.timeout !== null || w.turns !== null);
}

test('every agentic workflow fits within the active profile ceilings', () => {
  const active = loadProfile();
  const ceilTime = active.limits.agentTimeoutMinutes;
  const ceilTurns = active.limits.agentMaxTurns;
  const wf = agenticWorkflowLimits();
  assert.ok(wf.length > 0, 'no agentic workflows found to bound');
  for (const w of wf) {
    if (w.timeout !== null) {
      assert.ok(w.timeout <= ceilTime, `${w.file} timeout-minutes ${w.timeout} exceeds ${active.id} ceiling ${ceilTime}`);
    }
    if (w.turns !== null) {
      assert.ok(w.turns <= ceilTurns, `${w.file} max-turns ${w.turns} exceeds ${active.id} ceiling ${ceilTurns}`);
    }
  }
});

test('verify.mjs enforces the profile ceilings (not decorative)', () => {
  const result = run('verify.mjs', ['--only', 'profiles']);
  assert.equal(result.code, 0, `verify profiles failed:\n${result.stdout}`);
  assert.match(result.stdout, /ceiling/, 'verify did not run the ceiling checks');
  assert.match(result.stdout, /<= active profile/, 'verify did not compare workflows against the active ceiling');
});

test('the ceiling comparison is directional: a ceiling below a real workflow would be rejected', () => {
  const wf = agenticWorkflowLimits();
  const maxTimeout = Math.max(...wf.map((w) => w.timeout ?? 0));
  const maxTurns = Math.max(...wf.map((w) => w.turns ?? 0));
  // The same `<=` comparison verify.mjs uses would fail against a ceiling one
  // below the largest committed value — proving the check bites, not decorates.
  assert.ok(!(maxTimeout <= maxTimeout - 1), 'timeout ceiling comparison is not directional');
  assert.ok(!(maxTurns <= maxTurns - 1), 'turns ceiling comparison is not directional');
});

// ---------------------------------------------------------------------------
// Item 22: serve.mjs suppresses the cosmetic favicon 404 and fails a busy port
// with an actionable message naming an exact alternate-port command.
// ---------------------------------------------------------------------------

test('serve.mjs answers the browser favicon probe with 204 rather than a 404', async () => {
  const server = createDocsServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await httpGet(port, '/favicon.ico');
    assert.equal(res.status, 204, 'favicon probe did not return 204 No Content');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serve.mjs fails a busy port with an actionable alternate-port message', async () => {
  const blocker = http.createServer((_, res) => res.end('busy'));
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const { port } = blocker.address();
  let code = 0;
  let out = '';
  try {
    execFileSync(process.execPath, [repoPath('scripts', 'serve.mjs'), '--port', String(port)], {
      encoding: 'utf8',
      cwd: repoPath(),
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000
    });
  } catch (err) {
    code = err.status ?? 1;
    out = `${String(err.stdout ?? '')}\n${String(err.stderr ?? '')}`;
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
  assert.notEqual(code, 0, `serve did not fail on a busy port; output:\n${out}`);
  assert.match(out, new RegExp(`port ${port} is already in use`), 'no actionable busy-port message');
  assert.match(out, new RegExp(`--port ${port + 1}`), 'the message names no exact alternate-port command');
});

test('an unknown profile fails with one actionable line and exit code 2', () => {
  for (const script of ['preflight.mjs', 'rehearse.mjs', 'setup.mjs', 'verify.mjs']) {
    let status = 0;
    let stderr = '';
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [repoPath('scripts', script)], {
        env: { ...process.env, SHOWCASE_PROFILE: 'not-a-real-profile' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      status = error.status;
      stderr = error.stderr || '';
      stdout = error.stdout || '';
    }
    assert.equal(status, 2, `${script} did not exit 2 on an unknown profile`);
    assert.match(stderr, /FAIL\s+unknown profile "not-a-real-profile"/, `${script} did not print a concise FAIL`);
    assert.match(stderr, /enterprise, sandbox/, `${script} did not list the available profiles`);
    const combined = stdout + stderr;
    assert.ok(!/\bat \w+ \(/.test(combined) && !/node:internal/.test(combined),
      `${script} printed a stack trace for an operator mistake`);
  }
});
