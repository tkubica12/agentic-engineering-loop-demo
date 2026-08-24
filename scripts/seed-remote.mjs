#!/usr/bin/env node
// Seed a target repository with the labels and the prepared issue the showcase
// expects. Dry run by default; targets only the repository you name.
//
//   node scripts/seed-remote.mjs --repo OWNER/REPO           show the plan
//   node scripts/seed-remote.mjs --repo OWNER/REPO --apply   create it
//
// Safety model:
//   * No default target. --apply is required to write anything.
//   * The agentic workflows need labels by their functional names (needs-triage,
//     ready-for-spec, ...), so those names are kept. To stay reversible and to
//     never clobber a repository's own labels, every label the seed creates
//     carries the demo marker in its description. A label is "ours" only if its
//     description contains that marker.
//   * Two trigger labels are created but never applied to the seeded issue:
//     the supported lane's "intake-please" and the experimental lane's unique
//     "aeloop:experimental-intake". The seeded issue therefore carries no trigger
//     label, so seeding starts no agentic workflow on its own. A presenter opts a
//     lane in explicitly by adding its label or dispatching the workflow.
//   * A pre-existing label the seed did not create is never overwritten (no
//     --force): it is left untouched and reported.
//   * Repeated --apply is idempotent. Partial failures exit non-zero.
//   * cleanup.mjs removes exactly the marker-scoped labels and issues.

import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig, readJson, repoPath, log, parseArgs } from './lib/repo.mjs';
import { runGh } from './lib/gh.mjs';

const args = parseArgs();
const config = loadConfig();
const marker = config.demoMarker;
const target = args.options.repo;
const apply = args.flags.has('apply');

if (!target || !/^[\w.-]+\/[\w.-]+$/.test(target)) {
  log.fail('--repo OWNER/REPO is required. There is no default target, by design.');
  process.exit(2);
}

// Every description ends with the marker so the label is identifiable as ours.
function markDescription(text) {
  return `${text} [${marker}]`;
}
function isOurs(label) {
  return typeof label?.description === 'string' && label.description.includes(marker);
}

const LABELS = [
  { name: 'showcase', colour: '0078d4', description: 'Part of the agentic engineering loop showcase' },
  { name: 'pulse', colour: '5a5a5a', description: 'Raised by the repository-pulse workflow' },
  { name: 'needs-triage', colour: 'd4a017', description: 'Not yet classified' },
  { name: 'ready-for-spec', colour: '2da44e', description: 'Outcome, constraints, and acceptance criteria are present' },
  { name: 'needs-detail', colour: 'd4a017', description: 'Missing outcome, constraints, or acceptance criteria' },
  { name: 'duplicate', colour: '6e7781', description: 'Another open issue covers the same outcome' },
  { name: 'out-of-scope', colour: '6e7781', description: 'Does not belong in this repository' },
  { name: 'size/small', colour: 'c5def5', description: 'One file, one behaviour' },
  { name: 'size/medium', colour: 'c5def5', description: 'A behaviour plus its specification' },
  { name: 'size/large', colour: 'c5def5', description: 'Changes the service boundary' },
  { name: 'intake-please', colour: 'a2eeef', description: 'Triggers the supported intake lane' },
  { name: 'aeloop:experimental-intake', colour: 'b60205', description: 'Opt-in trigger for the experimental OpenCode intake lane (issue-intake-opencode); never applied to the seeded issue' },
  { name: marker, colour: 'ededed', description: 'Created by the showcase seed script; safe to remove' }
];

const signal = readJson('fixtures', 'prepared', '01-signal-issue.json');
const issueBody = `${signal.issue.body}\n\n---\n\nSeeded by the showcase. Marker: \`${marker}\`. Synthetic data only.\n`;

log.head(`Seed — ${target}`);
log.info(apply ? 'MODE: apply' : 'MODE: dry run (pass --apply to create)');
log.info(`marker: ${marker}`);

let hadError = false;
const created = [];
const alreadyOurs = [];
const skippedNotOurs = [];

log.head('Labels');

let existingLabels = [];
if (apply) {
  try {
    existingLabels = JSON.parse(
      runGh(['label', 'list', '--repo', target, '--limit', '200', '--json', 'name,color,description'])
    );
  } catch {
    log.fail(`could not list existing labels on ${target}. Is gh authenticated and does the repository exist?`);
    process.exit(1);
  }
}
const existingByName = new Map(existingLabels.map((l) => [l.name, l]));

for (const label of LABELS) {
  const description = markDescription(label.description);
  if (!apply) {
    log.info(`would ensure label "${label.name}" (#${label.colour})`);
    continue;
  }

  const existing = existingByName.get(label.name);
  if (existing) {
    if (isOurs(existing)) {
      log.ok(`label "${label.name}" already present and marked as ours`);
      alreadyOurs.push(label.name);
    } else {
      log.warn(`label "${label.name}" already exists but was not created by the showcase; leaving it untouched`);
      skippedNotOurs.push(label.name);
    }
    continue;
  }

  try {
    runGh(['label', 'create', label.name, '--repo', target, '--color', label.colour, '--description', description]);
    log.ok(`created label "${label.name}"`);
    created.push(label.name);
  } catch (err) {
    log.fail(`could not create label "${label.name}": ${String(err.stderr ?? err.message ?? '').trim()}`);
    hadError = true;
  }
}

log.head('Prepared signal issue');
// The seeded issue deliberately carries only its functional labels plus the
// marker — never a trigger label — so neither agentic lane starts from seeding.
const issueLabels = [...signal.issue.labels, marker];
if (!apply) {
  log.info(`would create issue: ${signal.issue.title}`);
  log.info(`with labels: ${issueLabels.join(', ')}`);
  log.info('body carries the marker so cleanup can find it');
} else {
  try {
    const existing = JSON.parse(
      runGh(['issue', 'list', '--repo', target, '--state', 'open', '--limit', '200', '--json', 'title'])
    );
    if (existing.some((i) => i.title === signal.issue.title)) {
      log.ok('the issue already exists; nothing to do');
    } else {
      const url = runGh([
        'issue', 'create', '--repo', target,
        '--title', signal.issue.title,
        '--body', issueBody,
        '--label', issueLabels.join(',')
      ]).trim();
      log.ok(`created ${url}`);
    }
  } catch (err) {
    log.fail(`could not create the issue: ${String(err.stderr ?? err.message ?? '').trim()}`);
    log.info('Check that gh is authenticated and the labels exist.');
    hadError = true;
  }
}

// State exactly what seeding can and cannot start. The seeded issue carries no
// trigger label, so no agentic workflow runs from seeding alone; each lane is
// opt-in and bounded by max-ai-credits.
log.head('Triggering');
log.info('The seeded issue carries no trigger label, so seeding starts no agentic workflow on its own.');
log.info('Supported lane — issue-intake (Copilot engine): runs only when an issue is labelled "intake-please" or via workflow_dispatch. Bound: max-ai-credits 300 per run.');
log.info('Experimental lane — issue-intake-opencode (OpenCode engine, ships as sample): runs only when an issue is labelled "aeloop:experimental-intake" or via workflow_dispatch. Bound: max-ai-credits 300 per run.');

// Record exactly which labels the seed created (and which were already ours),
// so a later cleanup run has a precise account even beyond the marker scan.
if (apply) {
  const record = {
    repo: target,
    marker,
    seededAt: new Date().toISOString(),
    createdLabels: created,
    alreadyOursLabels: alreadyOurs,
    skippedNotOursLabels: skippedNotOurs,
    issueTitle: signal.issue.title
  };
  mkdirSync(repoPath('out', 'seed'), { recursive: true });
  writeFileSync(
    repoPath('out', 'seed', `${target.replace('/', '__')}.json`),
    `${JSON.stringify(record, null, 2)}\n`
  );
  log.head('Seed record');
  log.info(`created labels: ${created.length ? created.join(', ') : 'none'}`);
  log.info(`already ours: ${alreadyOurs.length ? alreadyOurs.join(', ') : 'none'}`);
  log.info(`left untouched (not ours): ${skippedNotOurs.length ? skippedNotOurs.join(', ') : 'none'}`);
  log.info(`record written to out/seed/${target.replace('/', '__')}.json`);
}

log.head('Done');
log.info(apply
  ? `remove everything again with: node scripts/cleanup.mjs --repo ${target} --confirm`
  : `re-run with --apply to create these on ${target}`);

if (hadError) {
  log.fail('one or more operations failed; exiting non-zero');
  process.exit(1);
}
