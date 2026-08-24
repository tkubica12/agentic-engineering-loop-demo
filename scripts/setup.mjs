#!/usr/bin/env node
// Local setup. Idempotent and non-interactive: safe to run repeatedly.
// It creates nothing on GitHub and installs no dependency.

import { mkdirSync, rmSync } from 'node:fs';
import { repoPath, log, loadProfile, parseArgs, requireProfile } from './lib/repo.mjs';

const args = parseArgs();
const profile = requireProfile(args.options.profile);

log.head('Local setup');

for (const dir of ['out', 'out/rehearsal', 'out/bundle', 'out/shots']) {
  mkdirSync(repoPath(dir), { recursive: true });
  log.ok(`ensured ${dir}/`);
}

// Anything left behind by a previous rehearsal is not state worth keeping.
rmSync(repoPath('out', 'rehearsal', 'transcript.json'), { force: true });
log.ok('cleared the previous rehearsal transcript');

log.info(`active profile: ${profile.id} (${profile.label})`);
log.info('nothing was installed; the repository has no runtime dependency');
log.info('next: npm run preflight, then npm run rehearse');
