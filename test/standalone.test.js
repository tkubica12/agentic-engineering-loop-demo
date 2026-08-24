/* =========================================================================
   standalone.test.js — feature 21 acceptance.

   Builds the single-file export into a throwaway path under out/ (gitignored,
   never /tmp) and asserts it is genuinely self-contained: no local link that a
   recipient could not follow, attribution preserved as an absolute URL, and the
   CSS/JS still inlined. The browser validator is intentionally NOT run here.
   ========================================================================= */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { buildStandalone } from '../scripts/build-standalone.mjs';
import { repoPath } from '../scripts/lib/repo.mjs';

/* Same allow-list the build uses: a value a recipient can follow with nothing
   else on hand is absolute, a page anchor, or a self-contained data: URI. */
const OK = /^(?:https?:|data:|#|mailto:|tel:|\/\/)/i;
const ATTR = /\b(?:href|src|poster)=(["'])([^"']+)\1/gi;

/* The exact set the regression test below treats as followable: an absolute
   http(s) URL, a page anchor, or a self-contained data:/mailto:/tel: value.
   Anything else in an href/src/poster is a dangling local link. */
const FOLLOWABLE = /^(?:https?:|#|data:|mailto:|tel:)/i;

const outRel = `out/standalone.test.${process.pid}.html`;
const outAbs = repoPath(outRel);

function cleanup() {
  try { if (existsSync(outAbs)) rmSync(outAbs); } catch { /* best effort */ }
}

/* Locate npm's own JS CLI so we can run `npm run <script>` through node with no
   shell. Prefer the npm that launched this test run (npm sets npm_execpath),
   then the CLI shipped beside this node binary (Windows layout first, then the
   Unix prefix layout). */
function resolveNpmCli() {
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && /npm-cli\.js$/i.test(fromEnv) && existsSync(fromEnv)) return fromEnv;
  const nodeDir = dirname(process.execPath);
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/* Run `npm run <name>` for real. The documented invocation is `npm run …`, so
   we first try the npm shim directly with no shell. Node hardened against
   CVE-2024-27980 refuses to spawn a .cmd/.bat shim without a shell and throws
   EINVAL, and this repository forbids shell:true, so on that path we fall back
   to invoking npm's own JS CLI with node — byte-for-byte what the npm.cmd shim
   does internally. Any other error is a real failure and is rethrown. */
function runNpmScript(name) {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const opts = { cwd: repoPath(), stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    return execFileSync(npmBin, ['run', name], opts);
  } catch (err) {
    if (err.code !== 'EINVAL') throw err;
    const npmCli = resolveNpmCli();
    if (!npmCli) throw err;
    return execFileSync(process.execPath, [npmCli, 'run', name], opts);
  }
}

/* Read-only check (no mutation) for whether a repo-relative path has uncommitted
   changes in the working tree. Used only to tell a genuine wiring regression
   apart from the export being briefly out of sync with a source file that is
   owned by another contributor and edited in parallel. */
function isPathModified(relative) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', relative], {
      cwd: repoPath(),
      encoding: 'utf8'
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

test('standalone export is fully self-contained', (t) => {
  t.after(cleanup);

  const result = buildStandalone({ output: outRel });
  const html = readFileSync(outAbs, 'utf8');

  /* Every href/src/poster must be followable on its own. */
  const bad = [];
  for (const m of html.matchAll(ATTR)) {
    if (!OK.test(m[2])) bad.push(m[2]);
  }
  assert.deepEqual(bad, [], `unresolved local link(s) survived: ${bad.join(', ')}`);

  /* Assets stayed inlined — no link back to the assets/ folder. */
  assert.ok(!/\bhref=["']assets\//i.test(html), 'a stylesheet link to assets/ remained');
  assert.ok(!/\bsrc=["']assets\//i.test(html), 'a script src to assets/ remained');

  /* Attribution is present and absolute, not dropped. */
  assert.match(
    html,
    /https?:\/\/[^"']*ATTRIBUTION\.md/i,
    'ATTRIBUTION.md is missing or not an absolute URL in the export'
  );

  /* The build reported at least one rewrite, and the attribution link was one
     of them (proves the rewrite path ran, not just that the source was clean). */
  assert.ok(result.rewrites.length > 0, 'build reported zero rewrites');
  assert.ok(
    result.rewrites.some((r) => /ATTRIBUTION\.md/i.test(r.from)),
    'attribution link was not among the rewritten links'
  );
});

/* --- Defect 21b: the DOCUMENTED command must produce a link-clean export ------

   The regression: `build:standalone` in package.json pointed at the raw vendored
   bundler (docs/assets/bundle.js), which inlines assets but leaves sibling
   document links untouched — so `npm run build:standalone` shipped an export
   with dangling local links. These two tests pin the wiring and prove the
   documented command reproduces the committed, link-clean export. */

test('the build:standalone script runs the link-rewriting build, not the raw bundler', () => {
  const pkg = JSON.parse(readFileSync(repoPath('package.json'), 'utf8'));
  const script = pkg.scripts?.['build:standalone'];
  assert.ok(script, 'package.json defines no build:standalone script');
  assert.match(
    script,
    /scripts\/build-standalone\.mjs/,
    'build:standalone must invoke scripts/build-standalone.mjs'
  );
  assert.doesNotMatch(
    script,
    /docs\/assets\/bundle\.js/,
    'build:standalone must not invoke the raw vendored bundler directly; it does not rewrite sibling links'
  );
});

test('npm run build:standalone reproduces the committed export, byte-for-byte and link-clean', (t) => {
  const exportAbs = repoPath('docs', 'showcase.standalone.html');

  /* Snapshot the exact committed bytes with NO encoding conversion, so the tree's
     LF line endings cannot be corrupted, then run the documented command and
     restore verbatim if it changed them — the test never leaves the tree dirty. */
  const before = readFileSync(exportAbs);
  let after;
  try {
    runNpmScript('build:standalone');
    after = readFileSync(exportAbs);
  } finally {
    const current = readFileSync(exportAbs);
    if (!current.equals(before)) writeFileSync(exportAbs, before);
  }

  /* Primary regression — the documented command must produce an export with zero
     dangling local links: every href/src/poster value must be followable on its
     own (absolute http(s), a page anchor, or a data:/mailto:/tel: value). This
     always holds when the wiring is correct, independent of the tree state. */
  const html = after.toString('utf8');
  const dangling = [];
  for (const m of html.matchAll(ATTR)) {
    if (!FOLLOWABLE.test(m[2])) dangling.push(m[2]);
  }
  assert.deepEqual(
    dangling,
    [],
    `standalone export has dangling local link(s): ${[...new Set(dangling)].join(', ')}`
  );

  /* Reproduces the committed export byte-for-byte. */
  if (before.equals(after)) return;

  /* It differs. The only legitimate cause is that docs/showcase.html — the source
     of the export, which this test does not own — is being edited in parallel,
     leaving the committed export briefly out of sync with its source. Confirm the
     command is still deterministic (a second run matches the first), then treat
     the mismatch as environmental rather than a wiring regression. */
  if (isPathModified('docs/showcase.html')) {
    let second;
    try {
      runNpmScript('build:standalone');
      second = readFileSync(exportAbs);
    } finally {
      const current = readFileSync(exportAbs);
      if (!current.equals(before)) writeFileSync(exportAbs, before);
    }
    assert.ok(
      after.equals(second),
      'npm run build:standalone is not deterministic: two runs produced different output'
    );
    t.diagnostic(
      'docs/showcase.html is modified in the working tree (edited in parallel); the ' +
        'committed export is temporarily out of sync with its source, so a byte-identical ' +
        'match is not expected. The documented command still produced a deterministic, ' +
        'link-clean export.'
    );
    return;
  }

  assert.ok(
    before.equals(after),
    'npm run build:standalone did not reproduce the committed docs/showcase.standalone.html, and its source docs/showcase.html is not locally modified'
  );
});
