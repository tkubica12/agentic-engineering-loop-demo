#!/usr/bin/env node
// Preflight: is this machine ready to present? Read-only, non-interactive.
// Exit code 0 means every hard requirement is met. Soft requirements warn.

import { createChecker, loadProfile, listProfiles, loadManifest, exists, log, parseArgs, repoPath, requireProfile } from './lib/repo.mjs';
import { run, probeGh } from './lib/gh.mjs';
import { fallbackContext, resolveFallbacks } from './lib/fallbacks.mjs';

const args = parseArgs();
const profile = requireProfile(args.options.profile);
const checker = createChecker();

// Resolve the executable directly and run it with no shell (Windows-safe).
// A missing executable or a non-zero exit is reported as null, not a crash.
function tryCommand(command, commandArgs) {
  try {
    return run(command, commandArgs).trim();
  } catch {
    return null;
  }
}

log.head('Preflight');
log.info(`profile: ${profile.id} (${profile.label}); available: ${listProfiles().join(', ')}`);

// --- hard requirements -------------------------------------------------------

const nodeMajor = Number(process.versions.node.split('.')[0]);
checker.check(nodeMajor >= 22, `Node.js is ${process.versions.node} (22 or newer required)`);

checker.check(exists('fixtures', 'prepared', 'manifest.json'), 'The scene manifest is present');
checker.check(exists('docs', 'showcase.html'), 'The showcase article is present');
checker.check(exists('docs', 'presenter.html'), 'The presenter guide is present');
checker.check(exists('docs', 'mission-control.html'), 'The offline fallback is present');
checker.check(exists('docs', 'assets', 'article.css'), 'The document runtime is vendored locally');
checker.check(
  exists('fixtures', 'telemetry', 'reservation-events.jsonl'),
  'The synthetic telemetry fixture is present'
);

const manifest = loadManifest();
const missingArtifacts = manifest.scenes
  .filter((s) => s.artifact && !exists(s.artifact))
  .map((s) => `${s.id} -> ${s.artifact}`);
checker.check(missingArtifacts.length === 0, `Every prepared artefact resolves${missingArtifacts.length ? `: missing ${missingArtifacts.join(', ')}` : ''}`);

// Every scene must have somewhere to go when its primary path dies, and every
// fallback target must actually resolve: a real file (and anchor if named), a
// real offline scene, or a well-formed URL. A missing target is a hard failure.
const fbCtx = fallbackContext();
const fallbackFailures = [];
for (const scene of manifest.scenes) {
  const resolved = resolveFallbacks(scene.fallback, fbCtx);
  for (const r of resolved.results) {
    if (!r.ok) fallbackFailures.push(`${scene.id}: ${r.message}`);
  }
  if (resolved.results.length === 0) fallbackFailures.push(`${scene.id}: ${resolved.message}`);
}
checker.check(
  fallbackFailures.length === 0,
  `Every scene fallback target resolves${fallbackFailures.length ? `:\n    - ${fallbackFailures.join('\n    - ')}` : ''}`
);

// --- soft requirements -------------------------------------------------------

const gitVersion = tryCommand('git', ['--version']);
if (gitVersion) log.ok(`git available (${gitVersion})`);
else checker.warn('git not found. Local scenes still work; remote seeding does not.');

const ghVersion = tryCommand('gh', ['--version']);
if (ghVersion) log.ok(`GitHub CLI available (${ghVersion.split('\n')[0]})`);
else checker.warn('GitHub CLI not found. Every live GitHub scene falls back to prepared output.');

if (ghVersion) {
  // `gh auth status` and `gh aw version` decide availability by PROCESS EXIT
  // STATUS, not by whether stdout was non-empty. gh writes these to stderr on
  // some releases — `gh aw version` prints the version to stderr on every
  // release verified here (2026-08-23) — so the stdout-only tryCommand above
  // warned even when the tool was present and working. This mirrors the
  // approach already used by scripts/validate-aw.mjs.
  const auth = probeGh(['auth', 'status'], { cwd: repoPath() });
  if (!auth.error && auth.status === 0) log.ok('GitHub CLI is authenticated');
  else checker.warn('GitHub CLI is not authenticated. Run: gh auth login');

  const aw = probeGh(['aw', 'version'], { cwd: repoPath() });
  if (!aw.error && aw.status === 0) {
    const version = (`${aw.stdout ?? ''}\n${aw.stderr ?? ''}`.match(/v\d+\.\d+\.\d+/) || [])[0] ?? 'version unknown';
    log.ok(`Agentic workflow extension available (${version})`);
  } else {
    checker.warn('gh aw not installed. Install it pinned with: npm run aw:install');
  }
}

// --- capability honesty ------------------------------------------------------

log.head('Capability states for this profile');
// Capabilities are not all scenes. Some are reference material the article
// cites, so the warning wording must not promise a scene that does not exist.
const CAPABILITY_LABELS = {
  agenticWorkflows: { label: 'GitHub Agentic Workflows', scene: true },
  opencodeEngine: { label: 'OpenCode engine for gh-aw', scene: true },
  copilotCodeReview: { label: 'Copilot code review', scene: true },
  codeql: { label: 'CodeQL', scene: true },
  secretScanningPush: { label: 'Secret scanning push protection', scene: false },
  dependencyReview: { label: 'Dependency review', scene: true },
  artifactAttestation: { label: 'Artifact attestations', scene: true },
  environmentApproval: { label: 'Environments and required reviewers', scene: true },
  rulesets: { label: 'Repository rulesets', scene: true },
  mdash: { label: 'Microsoft MDASH (codename, private preview)', scene: false }
};
for (const [name, state] of Object.entries(profile.capabilities)) {
  const meta = CAPABILITY_LABELS[name] || { label: name, scene: true };
  const line = `${meta.label}: ${state}`;
  if (state === 'live') log.ok(line);
  else if (state === 'not-available') {
    checker.warn(
      meta.scene
        ? `${line} — this scene must be presented as prepared output`
        : `${line} — prepared capability reference only; it is not a scene and nothing depends on it`
    );
  } else log.info(line);
}

log.head('Go / no-go');
const noGo = checker.failures.length > 0;
if (noGo) {
  log.fail('Do not present from this machine until the failures above are fixed.');
} else {
  log.ok('Every hard requirement is met. Any warning above is either a scene to present as prepared output, or a capability the article only cites.');
}

process.exit(checker.finish('Preflight'));
