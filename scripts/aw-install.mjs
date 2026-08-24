#!/usr/bin/env node
// Install the gh-aw extension at exactly the version the committed lock files
// were compiled with. Idempotent: safe to run before every rehearsal.
//
//   node scripts/aw-install.mjs
//
// Never installs "latest". The version is read from the repository (see
// scripts/lib/aw.mjs), so it cannot drift from what validate:aw requires:
//
//   * already at the pinned version  -> nothing is done, exit 0
//   * installed at another version   -> removed, then reinstalled at the pin
//   * not installed                  -> installed at the pin
//
// The install is verified afterwards by asking gh for the version it actually
// has. A mismatch exits non-zero rather than reporting a success it did not get.

import { log } from './lib/repo.mjs';
import { probeGh } from './lib/gh.mjs';
import { pinnedCompiler, versionTokenOf } from './lib/aw.mjs';

const EXTENSION = 'github/gh-aw';

const { expected, versions } = pinnedCompiler();
if (!expected) {
  log.fail(`the repository does not pin a single gh-aw version (found: ${versions.join(', ') || 'none'})`);
  log.info('Fix the committed lock files and .github/aw/actions-lock.json first; they are the source of truth.');
  process.exit(2);
}

log.head(`gh-aw ${expected}`);

const gh = probeGh(['--version']);
if (gh.error || gh.status !== 0) {
  log.fail('the GitHub CLI is not available, so the extension cannot be installed.');
  log.info('Install gh first: https://cli.github.com');
  process.exit(2);
}

function installedVersion() {
  const probe = probeGh(['aw', 'version']);
  if (probe.error || probe.status !== 0) return null;
  return versionTokenOf(probe);
}

const before = installedVersion();

if (before === expected) {
  log.ok(`gh aw is already ${expected}; nothing to do`);
  process.exit(0);
}

if (before) {
  log.info(`gh aw is ${before}; removing it so the pin can be installed cleanly`);
  const removed = probeGh(['extension', 'remove', EXTENSION]);
  if (removed.error || removed.status !== 0) {
    log.fail(`could not remove the installed extension: ${String(removed.stderr ?? removed.error?.message ?? '').trim()}`);
    process.exit(1);
  }
}

log.info(`installing ${EXTENSION} pinned at ${expected}`);
const install = probeGh(['extension', 'install', EXTENSION, '--pin', expected]);
if (install.stdout?.trim()) process.stdout.write(`${install.stdout.trim()}\n`);
if (install.stderr?.trim()) process.stderr.write(`${install.stderr.trim()}\n`);
if (install.error || install.status !== 0) {
  log.fail(`gh extension install failed for ${EXTENSION} --pin ${expected}`);
  process.exit(1);
}

const after = installedVersion();
if (after !== expected) {
  log.fail(`installed gh aw reports ${after ?? 'no version'}, but the repository pins ${expected}`);
  process.exit(1);
}
log.ok(`gh aw is ${after}, matching the version the committed locks were compiled with`);
