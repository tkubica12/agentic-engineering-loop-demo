#!/usr/bin/env node
// Reset local state so the showcase can be run again immediately.
// Local only. It never touches a remote repository; see cleanup.mjs for that.

import { rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { repoPath, log, parseArgs } from './lib/repo.mjs';
const args = parseArgs();

log.head('Reset');

for (const dir of ['out/rehearsal', 'out/shots', 'out/bundle']) {
  rmSync(repoPath(dir), { recursive: true, force: true });
  mkdirSync(repoPath(dir), { recursive: true });
  log.ok(`cleared ${dir}/`);
}

// The standalone export is a committed artefact, like the compiled workflow
// lock files. Reset deliberately leaves it alone: rebuilding it here would race
// with any concurrent validation, and `npm run build:standalone` is the single
// writer. Reset only clears genuinely generated output.
log.info('the standalone export is committed and is left untouched; rebuild it with: npm run build:standalone');

if (args.flags.has('git')) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: repoPath() });
    if (status.trim()) {
      log.warn('the working tree has changes; reset does not discard them');
      log.info('discard them yourself by running these two commands in order:');
      log.info('  git restore .');
      log.info('  git clean -fd out');
    } else {
      log.ok('the working tree is clean');
    }
  } catch {
    log.warn('git is not available; skipping the working-tree check');
  }
}

log.info('the repository is ready for another run');
