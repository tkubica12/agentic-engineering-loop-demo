#!/usr/bin/env node
// Verify: prove specific claims the repository makes about itself.
//   node scripts/verify.mjs                     run every section
//   node scripts/verify.mjs --only acceptance   one section
//   node scripts/verify.mjs --only signal       recompute the telemetry signal

import { readFileSync, readdirSync } from 'node:fs';
import {
  createChecker, repoPath, readText, readJson, loadManifest, loadProfile, log, parseArgs, exists, requireProfile } from './lib/repo.mjs';
import { loadReplayInput, replayFollowUp } from './lib/followup.mjs';

const args = parseArgs();
const only = args.options.only;

const GROUPS = ['acceptance', 'signal', 'followup', 'provenance', 'coverage', 'profiles'];

if (args.flags.has('only') && only === undefined) {
  log.fail(`verify: --only requires a group name. Valid groups: ${GROUPS.join(', ')}`);
  process.exit(2);
}
if (only !== undefined && !GROUPS.includes(only)) {
  log.fail(`verify: unknown --only group "${only}". Valid groups: ${GROUPS.join(', ')}`);
  process.exit(2);
}

const checker = createChecker();
let checksRun = 0;
const runCheck = checker.check.bind(checker);
checker.check = (condition, message) => {
  checksRun += 1;
  return runCheck(condition, message);
};

function section(name) {
  return !only || only === name;
}

// --- acceptance criteria are all covered -------------------------------------

if (section('acceptance')) {
  log.head('Acceptance criteria');
  const spec = readText('docs', 'spec', 'SPEC-001-substitute-suggestion.md');
  const mapping = readText('docs', 'spec', 'acceptance-mapping.md');
  const tests = readText('app', 'test', 'service.test.js');

  const idsInMapping = [...mapping.matchAll(/\bAC-(\d+)\b/g)].map((m) => `AC-${m[1]}`);
  const unique = [...new Set(idsInMapping)].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));

  checker.check(unique.length >= 10, `the mapping lists ${unique.length} acceptance criteria`);
  checker.check(
    spec.includes('AC-1 through AC-10'),
    'the specification points at the mapping for its criteria'
  );

  for (const id of unique) {
    checker.check(
      new RegExp(`test\\(['"\`]${id}\\s`).test(tests),
      `${id} has a test named after it`
    );
  }

  const testNames = [...tests.matchAll(/test\(['"`](AC-\d+)/g)].map((m) => m[1]);
  for (const name of testNames) {
    checker.check(unique.includes(name), `${name} appears in the acceptance mapping`);
  }
}

// --- the telemetry signal is real --------------------------------------------

if (section('signal')) {
  log.head('Telemetry signal');
  const raw = readFileSync(repoPath('fixtures', 'telemetry', 'reservation-events.jsonl'), 'utf8');
  const events = raw.trim().split('\n').map((l) => JSON.parse(l));
  const days = [...new Set(events.map((e) => e.ts.slice(0, 10)))].sort();
  const third = Math.floor(days.length / 3);
  const firstDays = new Set(days.slice(0, third));
  const lastDays = new Set(days.slice(-third));

  const agg = new Map();
  for (const e of events) {
    const key = `${e.siteId}|${e.sku}`;
    const a = agg.get(key) ?? { n: 0, u: 0, fn: 0, fu: 0, ln: 0, lu: 0 };
    a.n++;
    if (e.outcome === 'unavailable') a.u++;
    const day = e.ts.slice(0, 10);
    if (firstDays.has(day)) { a.fn++; if (e.outcome === 'unavailable') a.fu++; }
    if (lastDays.has(day)) { a.ln++; if (e.outcome === 'unavailable') a.lu++; }
    agg.set(key, a);
  }

  const overall = events.filter((e) => e.outcome === 'unavailable').length / events.length;
  const ranked = [...agg.entries()]
    .map(([key, a]) => ({
      key, n: a.n, u: a.u,
      first: a.fu / (a.fn || 1),
      last: a.lu / (a.ln || 1)
    }))
    .filter((r) => r.u >= 20)
    .sort((x, y) => (y.last - y.first) - (x.last - x.first));

  const prepared = readJson('fixtures', 'prepared', '01-signal-issue.json');
  const top = ranked[0];

  checker.check(Boolean(top), 'the telemetry contains at least one qualifying signal');
  if (top) {
    log.info(`top signal: ${top.key} n=${top.n} unavailable=${top.u} first=${(top.first * 100).toFixed(0)}% last=${(top.last * 100).toFixed(0)}%`);
    checker.check(top.key === 'SITE-NORTH|SKU-1001', 'the top signal is the pair the prepared issue names');
    checker.check(prepared.issue.body.includes(`Requests in window: ${top.n}`), `the prepared issue states the real request count (${top.n})`);
    checker.check(prepared.issue.body.includes(`Unavailable outcomes: ${top.u}`), `the prepared issue states the real unavailable count (${top.u})`);
    checker.check(
      prepared.issue.body.includes(`${(top.first * 100).toFixed(0)}% unavailable`),
      'the prepared issue states the real first-third rate'
    );
    checker.check(
      prepared.issue.body.includes(`${(top.last * 100).toFixed(0)}% unavailable`),
      'the prepared issue states the real last-third rate'
    );
    checker.check(
      prepared.issue.body.includes(`${(overall * 100).toFixed(1)}% of ${events.length} events`),
      'the prepared issue states the real repository-wide rate'
    );
  }
  checker.check(
    events.every((e) => e.substituteOffered === false),
    'no event in the fixture claims a substitute was offered'
  );
  checker.check(
    prepared.derivedFrom.events === events.length,
    `the prepared artefact records the real event count (${events.length})`
  );
}

// --- the closing payoff is recomputed, never restated ------------------------
//
// The hour ends on 32 / 25 / 7. Those numbers are the argument, so they are
// derived here from the real requests and the real selection logic rather than
// read out of a fixture. See scripts/lib/followup.mjs for what is read and what
// is declared.

if (section('followup')) {
  log.head('Follow-up replay');
  const input = loadReplayInput();
  const result = replayFollowUp(input);
  const expected = input.expected;
  const followup = readJson('fixtures', 'prepared', '10-followup.json');

  log.info(`replayed ${result.requestsReplayed} unmet request(s) from the telemetry, in timestamp order`);
  log.info(`answered with a substitute: ${result.answeredWithSubstitute}; unresolved: ${result.unresolved}`);
  log.info(`substitutes taken: ${JSON.stringify(result.substitutesBySku)}; units dispensed: ${result.unitsDispensed}`);

  // The replay input must declare itself synthetic and must not be mistaken for
  // a second observed window. This is the honesty rule, checked rather than
  // trusted.
  checker.check(input.status === 'synthetic', 'the replay input declares itself synthetic');
  checker.check(
    /not a second production run/i.test(input.labelInUi),
    'the replay input denies being a second production run'
  );
  checker.check(
    /replay/i.test(followup.labelInUi) && !/second (production )?run/i.test(followup.replay?.claims ?? ''),
    'the closing artefact labels itself as a replayed window'
  );

  // The requests are read, not declared, so the replay cannot pick a friendlier
  // set of inputs than the ones the opening signal was computed from.
  checker.check(
    !Array.isArray(input.replayWindow.requests),
    'the replay reads its requests from the telemetry instead of declaring them'
  );

  checker.check(
    result.requestsReplayed === expected.requestsReplayed,
    `the window holds ${result.requestsReplayed} unmet request(s), and the input expects ${expected.requestsReplayed}`
  );
  checker.check(
    result.answeredWithSubstitute === expected.answeredWithSubstitute,
    `the replay answers ${result.answeredWithSubstitute} with a substitute, and the input expects ${expected.answeredWithSubstitute}`
  );
  checker.check(
    result.unresolved === expected.unresolved,
    `the replay leaves ${result.unresolved} unresolved, and the input expects ${expected.unresolved}`
  );
  checker.check(
    result.unitsDispensed === expected.unitsDispensed,
    `the replay dispenses ${result.unitsDispensed} unit(s), and the input expects ${expected.unitsDispensed}`
  );
  checker.check(
    JSON.stringify(result.substitutesBySku) === JSON.stringify(expected.substitutesBySku),
    'the replay reaches for the same group members the input expects'
  );
  checker.check(
    JSON.stringify(result.closingStock) === JSON.stringify(expected.closingStock),
    'the replay leaves the shelf where the input expects'
  );

  // The three numbers must add up, and must be the three the closing artefact
  // publishes to the room.
  checker.check(
    result.answeredWithSubstitute + result.unresolved === result.requestsReplayed,
    'the answered and unresolved counts account for every request in the window'
  );
  const body = followup.followUpIssue.body;
  checker.check(
    body.includes(`Unmet requests in the window: ${result.requestsReplayed} requests`),
    `the closing issue states the recomputed request count (${result.requestsReplayed})`
  );
  checker.check(
    body.includes(`Now answered with an alternative: ${result.answeredWithSubstitute} requests`),
    `the closing issue states the recomputed substitute count (${result.answeredWithSubstitute})`
  );
  checker.check(
    body.includes(`Still answered with nothing: ${result.unresolved} requests`),
    `the closing issue states the recomputed residue (${result.unresolved})`
  );
  checker.check(
    followup.followUpIssue.title.includes(`${result.unresolved} unmet requests`),
    'the closing issue title states the recomputed residue'
  );

  // The residue is only interesting because the shelf actually ran out. If some
  // group member still had free units the claim would be false.
  checker.check(
    Object.values(result.closingStock).every((units) => units === 0),
    'every active group member is at zero free units when the window closes'
  );
}

// --- provenance mode is stated, never assumed --------------------------------

if (section('provenance')) {
  log.head('Provenance');
  const record = readJson('fixtures', 'prepared', '07-release-provenance.json');
  checker.check(
    ['attested', 'simulated'].includes(record.record.mode),
    `the provenance record declares its mode (${record.record.mode})`
  );
  if (record.record.mode === 'simulated') {
    log.warn('This provenance record is SIMULATED. Say so on stage. It proves nothing about the artefact.');
    checker.check(Boolean(record.record.reason), 'the simulated record states why it is simulated');
  }
  if (exists('out', 'bundle', 'provenance-record.json')) {
    const live = readJson('out', 'bundle', 'provenance-record.json');
    log.info(`a build-time provenance record exists with mode: ${live.mode}`);
  }
}

// --- prepared coverage of the whole hour -------------------------------------

if (section('coverage')) {
  log.head('Scene coverage');
  const manifest = loadManifest();
  const scenes = [...manifest.scenes].sort((a, b) => a.order - b.order);

  checker.check(scenes[0].start === 0, 'the sequence starts at minute 0');
  checker.check(
    scenes[scenes.length - 1].end === manifest.durationMinutes,
    `the sequence ends at minute ${manifest.durationMinutes}`
  );

  for (let i = 1; i < scenes.length; i++) {
    checker.check(
      scenes[i].start === scenes[i - 1].end,
      `no dead time between "${scenes[i - 1].id}" and "${scenes[i].id}"`
    );
  }
  for (const scene of scenes) {
    checker.check(scene.end > scene.start, `scene "${scene.id}" has a positive duration`);
    checker.check(
      Array.isArray(scene.fallback) && scene.fallback.length > 0,
      `scene "${scene.id}" has at least one fallback`
    );
    checker.check(Boolean(scene.expectedState), `scene "${scene.id}" states its expected visible state`);
    checker.check(Boolean(scene.stopCondition), `scene "${scene.id}" states a stop condition`);
  }
}

// --- profile portability -----------------------------------------------------

if (section('profiles')) {
  log.head('Profiles');
  const config = readJson('config', 'showcase.config.json');
  const ids = ['sandbox', 'enterprise'];
  const shapes = ids.map((id) => loadProfile(id));
  const keysOf = (o) => Object.keys(o).filter((k) => k !== '_config').sort().join(',');
  checker.check(keysOf(shapes[0]) === keysOf(shapes[1]), 'both profiles share the same shape');
  for (const p of shapes) {
    checker.check(p.target.owner === null && p.target.repo === null, `profile "${p.id}" hard-codes no target repository`);
    checker.check(Boolean(p.governance.environmentName), `profile "${p.id}" names an environment`);
    checker.check(typeof p.limits.agentTimeoutMinutes === 'number', `profile "${p.id}" caps agent time`);
  }
  checker.check(Boolean(config.demoMarker), 'a unique demo marker is configured');

  // Profile ceilings must bite, not decorate. Every agentic workflow's declared
  // timeout-minutes and max-turns must fit within the ACTIVE (default) profile's
  // limits.* ceilings; a workflow that exceeds them fails here. This is what
  // makes limits.agentTimeoutMinutes / limits.agentMaxTurns enforceable rather
  // than documentation. Active profile = config.defaultProfile.
  const active = requireProfile();
  const ceilTime = active.limits.agentTimeoutMinutes;
  const ceilTurns = active.limits.agentMaxTurns;
  const wfSources = readdirSync(repoPath('.github', 'workflows'))
    .filter((f) => f.endsWith('.md'))
    .sort();
  let agenticSeen = 0;
  for (const file of wfSources) {
    const body = readText('.github', 'workflows', file);
    const t = body.match(/^timeout-minutes:\s*(\d+)\s*$/m);
    const n = body.match(/^max-turns:\s*(\d+)\s*$/m);
    if (!t && !n) continue; // not an agentic workflow — nothing to bound
    agenticSeen += 1;
    if (t) {
      const v = Number(t[1]);
      checker.check(v <= ceilTime, `workflow "${file}" timeout-minutes ${v} <= active profile "${active.id}" ceiling ${ceilTime}`);
    }
    if (n) {
      const v = Number(n[1]);
      checker.check(v <= ceilTurns, `workflow "${file}" max-turns ${v} <= active profile "${active.id}" ceiling ${ceilTurns}`);
    }
  }
  checker.check(agenticSeen > 0, `at least one agentic workflow is bounded by profile ceilings (found ${agenticSeen})`);
}

if (checksRun === 0) {
  log.fail(`verify: no checks ran${only ? ` for group "${only}"` : ''}`);
  process.exit(2);
}

process.exit(checker.finish('Verify'));
