#!/usr/bin/env node
// Remote cleanup. Destructive, and therefore deliberately hard to run by accident.
//
//   node scripts/cleanup.mjs --repo OWNER/REPO              lists what it would remove
//   node scripts/cleanup.mjs --repo OWNER/REPO --confirm    actually removes it
//
// Three guards:
//   1. A target repository must be given explicitly. There is no default.
//   2. Nothing happens without --confirm.
//   3. Only items carrying the unique demo marker are touched: marker-scoped
//      issues are CLOSED, and the labels the seed created (identified by the
//      marker in their description) are DELETED. Anything else is listed and
//      skipped, even with --confirm.
//
// Repeated --confirm runs are idempotent, and any partial failure exits non-zero.

import { loadConfig, log, parseArgs } from './lib/repo.mjs';
import { runGh } from './lib/gh.mjs';

const args = parseArgs();
const config = loadConfig();
const marker = config.demoMarker;
const target = args.options.repo;
const confirmed = args.flags.has('confirm');

if (!target || !/^[\w.-]+\/[\w.-]+$/.test(target)) {
  log.fail('--repo OWNER/REPO is required. There is no default target, by design.');
  process.exit(2);
}

log.head(`Cleanup — ${target}`);
log.info(`marker: ${marker}`);
log.info(confirmed ? 'MODE: destructive (--confirm given)' : 'MODE: dry run (pass --confirm to act)');

let issues = [];
try {
  issues = JSON.parse(runGh(['issue', 'list', '--repo', target, '--state', 'open', '--limit', '200', '--json', 'number,title,body,labels']));
} catch (err) {
  // In a dry run, an unreachable repository is a preview limitation, not a
  // destructive risk: warn and continue with an empty plan. With --confirm we
  // must know exactly what exists, so a list failure is fatal.
  const detail = String(err.stderr ?? err.message ?? '').trim();
  if (confirmed) {
    log.fail(`could not list issues on ${target}. Is gh authenticated and does the repository exist?`);
    process.exit(1);
  }
  log.warn(`could not list issues on ${target} (${detail || 'unreachable'}); dry-run preview only`);
}

let allLabels = [];
try {
  allLabels = JSON.parse(runGh(['label', 'list', '--repo', target, '--limit', '200', '--json', 'name,description']));
} catch (err) {
  const detail = String(err.stderr ?? err.message ?? '').trim();
  if (confirmed) {
    log.fail(`could not list labels on ${target}. Is gh authenticated and does the repository exist?`);
    process.exit(1);
  }
  log.warn(`could not list labels on ${target} (${detail || 'unreachable'}); dry-run preview only`);
}

const carriesMarker = (item) =>
  (item.body ?? '').includes(marker) || (item.labels ?? []).some((l) => l.name === marker);
const labelIsOurs = (label) => typeof label.description === 'string' && label.description.includes(marker);

const mine = issues.filter(carriesMarker);
const notMine = issues.filter((i) => !carriesMarker(i));
const myLabels = allLabels.filter(labelIsOurs);

log.head('Issues carrying the demo marker (will be CLOSED)');
if (mine.length === 0) log.info('none');
for (const issue of mine) log.info(`#${issue.number}  ${issue.title}`);

log.head('Labels created by the seed (will be DELETED)');
if (myLabels.length === 0) log.info('none');
for (const label of myLabels) log.info(`"${label.name}"`);

log.head('Issues skipped because they do not carry the marker');
if (notMine.length === 0) log.info('none');
for (const issue of notMine) log.warn(`#${issue.number}  ${issue.title}  (left alone)`);

if (!confirmed) {
  log.head('Dry run complete');
  log.info(`would close ${mine.length} issue(s) and delete ${myLabels.length} label(s). Re-run with --confirm to act.`);
  process.exit(0);
}

let hadError = false;
let closed = 0;
for (const issue of mine) {
  try {
    runGh(['issue', 'close', String(issue.number), '--repo', target, '--reason', 'not planned', '--comment', `Closed by the showcase cleanup script (marker ${marker}).`]);
    log.ok(`closed #${issue.number}`);
    closed++;
  } catch (err) {
    log.fail(`could not close #${issue.number}: ${String(err.stderr ?? err.message ?? '').trim()}`);
    hadError = true;
  }
}

let deleted = 0;
for (const label of myLabels) {
  try {
    runGh(['label', 'delete', label.name, '--repo', target, '--yes']);
    log.ok(`deleted label "${label.name}"`);
    deleted++;
  } catch (err) {
    log.fail(`could not delete label "${label.name}": ${String(err.stderr ?? err.message ?? '').trim()}`);
    hadError = true;
  }
}

log.head('Cleanup complete');
log.info(`closed ${closed} of ${mine.length} marked issue(s); deleted ${deleted} of ${myLabels.length} seed label(s); left ${notMine.length} unmarked issue(s) untouched`);

if (hadError) {
  log.fail('one or more operations failed; exiting non-zero');
  process.exit(1);
}
