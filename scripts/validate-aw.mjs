#!/usr/bin/env node
// Validate the agentic workflows and PROVE the lock files are actually fresh.
//
//   node scripts/validate-aw.mjs        local: structural + strict + freshness
//   node scripts/validate-aw.mjs --ci   same; a missing/broken gh aw FAILS the job
//
// Freshness is real here, not a header sniff. We back up every committed
// .lock.yml in memory, run `gh aw compile` in place, read what it produced,
// restore the originals, and byte-compare (line endings normalised only). A
// source change that was not recompiled makes the regenerated lock differ from
// the committed one, and that fails. The locks embed a frontmatter_hash, so any
// frontmatter edit changes the lock too.
//
// gh aw availability is decided by PROCESS EXIT STATUS, not by whether stdout
// was non-empty, and both stdout and stderr are surfaced (including the
// "Using experimental OpenCode support" warning). In --ci we never silently
// pass when gh aw could not run: that is a hard failure.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createChecker, repoPath, readText, exists, log, parseArgs } from './lib/repo.mjs';
import { probe, probeGh } from './lib/gh.mjs';
import { pinnedCompiler, versionTokenOf } from './lib/aw.mjs';

const args = parseArgs();
const ci = args.flags.has('ci');
const checker = createChecker();
const workflowDir = repoPath('.github', 'workflows');

const sources = readdirSync(workflowDir)
  .filter((f) => f.endsWith('.md'))
  .sort();

log.head('Agentic workflow sources');
checker.check(sources.length > 0, `found ${sources.length} agentic workflow source(s)`);

for (const source of sources) {
  const name = source.replace(/\.md$/, '');
  const lock = `${name}.lock.yml`;
  checker.check(exists('.github', 'workflows', lock), `${source} has a compiled ${lock}`);

  if (exists('.github', 'workflows', lock)) {
    const compiled = readText('.github', 'workflows', lock);
    checker.check(
      /This file was automatically generated|DO NOT EDIT|gh aw/i.test(compiled),
      `${lock} carries the compiler's own header, so it was not hand-written`
    );
    checker.check(
      !/pull_request_target/.test(compiled),
      `${lock} does not use pull_request_target`
    );
  }

  const md = readText('.github', 'workflows', source);
  const frontmatter = md.split('---')[1] ?? '';
  checker.check(/permissions:/.test(frontmatter), `${source} declares explicit permissions`);
  checker.check(
    !/permissions:[\s\S]*?\bwrite\b/.test(frontmatter.split('safe-outputs')[0]),
    `${source} grants the agent job no write permission`
  );
  checker.check(/timeout-minutes:/.test(frontmatter), `${source} caps its wall-clock time`);
  checker.check(/max-turns:/.test(frontmatter), `${source} caps its turns`);
  checker.check(/max-ai-credits:/.test(frontmatter), `${source} caps its AI credits`);
  checker.check(/threat-detection:\s*true/.test(frontmatter), `${source} enables threat detection`);
  checker.check(
    !/\$\{\{\s*secrets\./.test(md),
    `${source} interpolates no secret into the agent`
  );
}

// --- gh aw availability, by exit status --------------------------------------

log.head('gh aw');

function surface(stdout, stderr) {
  if (stdout.trim()) process.stdout.write(stdout.endsWith('\n') ? stdout : `${stdout}\n`);
  if (stderr.trim()) process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
  const combined = `${stdout}\n${stderr}`;
  if (/experimental/i.test(combined)) {
    log.warn('gh aw reported an experimental engine ("Using experimental OpenCode support"). That warning is expected and is documented.');
  }
}

const version = probeGh(['aw', 'version'], { cwd: repoPath() });
// Available iff the process actually ran AND exited zero. Non-empty stdout is
// not evidence of anything on its own.
const awAvailable = !version.error && version.status === 0;
surface(String(version.stdout ?? ''), String(version.stderr ?? ''));

if (!awAvailable) {
  const why = version.error ? `could not be launched (${version.error.code ?? version.error.message})` : `exited ${version.status}`;
  log.fail(`gh aw ${why}, so strict validation and lock-freshness could not run.`);
  log.info('Install it pinned with: npm run aw:install');
  if (ci) {
    log.fail('CI requires gh aw. A missing or broken extension is a failure here, not a silent pass.');
  }
  // Hard failure in both modes: this repository prefers to fail rather than
  // claim a control that did not execute.
  checker.check(false, 'gh aw is available and strict validation ran');
  process.exit(checker.finish('Agentic workflow validation'));
}

// --- gh aw compiler pin ------------------------------------------------------
//
// The locks record the compiler that produced them (compiler_version in the
// `# gh-aw-metadata:` header line) and .github/aw/actions-lock.json pins the
// gh-aw-actions toolchain to the same release. A locally-installed `gh aw` at a
// different version can silently recompile the locks into a different shape, so
// we fail loudly and name the exact pinned install command.

log.head('gh aw compiler pin');

// `gh aw version` prints to stderr (verified), so read the version token from
// either stream rather than assuming stdout.
const installedVersion = versionTokenOf(version);

const { versions: expectedVersions, expected } = pinnedCompiler();

// The repository must agree with itself on exactly one pinned compiler version.
checker.check(
  expected !== null,
  expected !== null
    ? `the locks and actions-lock.json agree on compiler ${expected}`
    : `the locks/actions-lock.json disagree on the pinned compiler version (${expectedVersions.join(', ') || 'none found'}); recompile with a single pinned gh aw`
);

if (expected) {
  const matches = installedVersion === expected;
  if (!matches) {
    log.fail(`installed gh aw is ${installedVersion ?? 'unknown'} but the committed locks were compiled with ${expected}.`);
    log.info('Pin the compiler to match the locks: npm run aw:install');
    log.info(`(that runs: gh extension install github/gh-aw --pin ${expected}). Then recompile with: npm run aw:compile`);
  }
  checker.check(matches, `installed gh aw (${installedVersion ?? 'unknown'}) matches the pinned compiler ${expected}`);
  // Stop here rather than compiling with the wrong compiler. A drifted compiler
  // rewrites every generated file in the working tree, and the only thing that
  // would prove is that two different compilers disagree, which is already
  // known. Failing before the compile leaves the tree exactly as it was found.
  if (!matches) {
    log.info('Refusing to compile with a drifted compiler: the working tree is left untouched.');
    process.exit(checker.finish('Agentic workflow validation'));
  }
}

// --- the compile below must act on THIS repository ---------------------------
//
// `gh aw compile` and the freshness comparison both run with cwd set to
// repoPath(). If that directory is not the root of the git working tree — a
// nested checkout, a stray copy inside another repository — the compiler can
// resolve a different workflow set, and every freshness check would then compare
// files it never regenerated and pass vacuously. Assert the two agree first.

log.head('checkout identity');
{
  const top = probe('git', ['rev-parse', '--show-toplevel'], { cwd: repoPath() });
  const toplevel = String(top.stdout ?? '').trim();
  const ran = !top.error && top.status === 0 && toplevel.length > 0;
  checker.check(ran, 'git reported the working-tree root');
  if (ran) {
    const same = resolve(toplevel) === resolve(repoPath());
    if (!same) {
      log.fail(`git says the working tree root is ${resolve(toplevel)}, but these scripts live under ${resolve(repoPath())}.`);
      log.info('Run the validation from the repository root; a nested checkout would make the freshness comparison vacuous.');
    }
    checker.check(same, 'the scripts and the git working tree root are the same directory');
    if (!same) process.exit(checker.finish('Agentic workflow validation'));
  } else {
    process.exit(checker.finish('Agentic workflow validation'));
  }
}

// --- strict validation -------------------------------------------------------

log.head('gh aw validate --strict');
{
  const res = probeGh(['aw', 'validate', '--strict'], { cwd: repoPath() });
  const stdout = String(res.stdout ?? '');
  const stderr = String(res.stderr ?? '');
  surface(stdout, stderr);
  const passed = !res.error && res.status === 0;
  checker.check(passed, 'gh aw validate --strict passed');
}

// --- real lock-file freshness ------------------------------------------------

log.head('lock freshness (compile in place, compare, restore)');

const normalise = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n');

// The comparison below is TOTAL and byte-for-byte (line endings normalised
// only). There is deliberately no ignored-field list. gh-aw v0.86.2 compiles
// deterministically: GH_AW_ACTION_FAILURE_ISSUE_EXPIRES_HOURS is "0" on every
// path (verified by delete-all-locks compile x3, in-place compile x4, and an
// in-place compile starting from a stale committed lock), and the committed
// locks carry that value. Determinism does not require deleting the locks
// first, so the check compiles in place and compares every byte.

// Snapshot every file the compiler is allowed to rewrite, so the working tree
// can be put back exactly as it was found. That is every .lock.yml AND
// .github/aw/actions-lock.json: the compiler resolves and re-pins the action
// toolchain into that file, so a run that restored only the locks would leave a
// modified file behind and the "restored" message would be a lie.
const GENERATED = [
  ...readdirSync(workflowDir).filter((f) => f.endsWith('.lock.yml')).sort()
    .map((name) => ({ name, path: join(workflowDir, name) })),
  ...(exists('.github', 'aw', 'actions-lock.json')
    ? [{ name: '.github/aw/actions-lock.json', path: repoPath('.github', 'aw', 'actions-lock.json') }]
    : [])
];
const lockNames = GENERATED.filter((f) => f.name.endsWith('.lock.yml')).map((f) => f.name);
const backups = new Map();
for (const file of GENERATED) {
  backups.set(file.name, { path: file.path, bytes: readFileSync(file.path) });
}

let compiled = false;
try {
  const res = probeGh(['aw', 'compile'], { cwd: repoPath() });
  const stdout = String(res.stdout ?? '');
  const stderr = String(res.stderr ?? '');
  surface(stdout, stderr);
  const compileOk = !res.error && res.status === 0;
  checker.check(compileOk, 'gh aw compile completed');
  compiled = compileOk;

  if (compileOk) {
    // Compare against every lock present after compile so a source without a
    // committed lock, or a regenerated lock that drifted, is caught.
    const afterNames = readdirSync(workflowDir).filter((f) => f.endsWith('.lock.yml')).sort();
    for (const lock of afterNames) {
      const regenerated = readFileSync(join(workflowDir, lock));
      const committed = backups.get(lock)?.bytes;
      if (!committed) {
        checker.check(false, `${lock} was generated by compile but is not committed (missing lock file)`);
        continue;
      }
      const fresh = normalise(regenerated) === normalise(committed);
      checker.check(fresh, `${lock} is up to date with its source (recompiles to the committed bytes)`);
    }
    for (const lock of lockNames) {
      if (!afterNames.includes(lock)) {
        checker.check(false, `${lock} disappeared during compile; something is wrong with the source`);
      }
    }
  }
} finally {
  // Restore the exact committed bytes no matter what happened above: a compiler
  // that drifted, crashed, or was killed mid-run must not leave the tree dirty.
  // The message below reports what was actually restored, and names anything
  // that could not be, rather than claiming a clean tree it did not achieve.
  const failed = [];
  for (const [name, { path, bytes }] of backups) {
    try {
      writeFileSync(path, bytes);
    } catch (err) {
      failed.push(name);
      log.fail(`could not restore ${name} after the freshness check: ${err.message}`);
    }
  }
  if (failed.length) {
    log.fail(`the working tree was NOT fully restored; check these by hand: ${failed.join(', ')}`);
    checker.check(false, 'every generated file was restored to its committed bytes');
  } else if (compiled) {
    log.info(`restored to their committed bytes: ${[...backups.keys()].join(', ')}`);
  }
}

process.exit(checker.finish('Agentic workflow validation'));
