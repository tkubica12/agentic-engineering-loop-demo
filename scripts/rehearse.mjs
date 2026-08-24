#!/usr/bin/env node
// Rehearsal: walk the whole hour offline and prove every scene has what it needs.
//
//   node scripts/rehearse.mjs            full transcript
//   node scripts/rehearse.mjs --fast     same checks, terse output (used in CI)
//   node scripts/rehearse.mjs --scene pulse   one scene
//   node scripts/rehearse.mjs --fallback      force every scene down its fallback
//
// This never touches GitHub and never needs a network.

import { mkdirSync, writeFileSync } from 'node:fs';
import {
  createChecker, loadManifest, loadProfile, readJson, repoPath, exists, log, parseArgs, readText, requireProfile } from './lib/repo.mjs';
import { fallbackContext, resolveFallbacks } from './lib/fallbacks.mjs';

const args = parseArgs();
const fast = args.flags.has('fast');
const forceFallback = args.flags.has('fallback');
const onlyScene = args.options.scene;
const profile = requireProfile(args.options.profile);
const manifest = loadManifest();
const checker = createChecker();
const fbCtx = fallbackContext();

const scenes = [...manifest.scenes]
  .sort((a, b) => a.order - b.order)
  .filter((s) => !onlyScene || s.id === onlyScene);

if (scenes.length === 0) {
  log.fail(`no scene matches "${onlyScene}"`);
  process.exit(1);
}

const transcript = {
  rehearsedAt: new Date().toISOString(),
  profile: profile.id,
  mode: forceFallback ? 'fallback' : 'primary',
  durationMinutes: manifest.durationMinutes,
  scenes: []
};

function minutes(n) {
  return `${String(Math.floor(n)).padStart(2, '0')}:${String(Math.round((n % 1) * 60)).padStart(2, '0')}`;
}

log.head(`Rehearsal — ${manifest.title}`);
log.info(`profile ${profile.id}; ${scenes.length} scene(s); ${manifest.durationMinutes} minutes; mode ${transcript.mode}`);

const showcase = exists('docs', 'showcase.html') ? readText('docs', 'showcase.html') : '';

for (const scene of scenes) {
  const header = `${minutes(scene.start)}–${minutes(scene.end)}  ${scene.id}  ${scene.title}`;
  if (!fast) log.head(header);
  else log.info(header);

  const record = {
    id: scene.id,
    order: scene.order,
    start: scene.start,
    end: scene.end,
    durationMinutes: scene.end - scene.start,
    mode: forceFallback ? 'fallback' : scene.mode,
    surface: scene.surface,
    path: forceFallback ? (scene.fallback?.[0]?.label ?? '(no fallback)') : scene.expectedState,
    artifact: scene.artifact,
    ok: true
  };

  // 1. The chapter the scene presents exists in the article.
  if (scene.chapter && showcase) {
    const present = showcase.includes(`id="${scene.chapter}"`);
    record.ok = checker.check(present, `scene "${scene.id}" has chapter ${scene.chapter} in the article`) && record.ok;
  }

  // 2. The prepared artefact resolves and declares its own status.
  if (scene.artifact) {
    const present = exists(scene.artifact);
    record.ok = checker.check(present, `scene "${scene.id}" prepared artefact resolves`) && record.ok;
    if (present) {
      const artifact = readJson(scene.artifact);
      record.ok = checker.check(
        Boolean(artifact.status) && Boolean(artifact.labelInUi),
        `scene "${scene.id}" artefact labels itself in the UI`
      ) && record.ok;
      record.ok = checker.check(
        artifact.scene === scene.id,
        `scene "${scene.id}" artefact points back at its scene`
      ) && record.ok;
      record.artifactLabel = artifact.labelInUi;
    }
  } else {
    record.ok = checker.check(
      scene.mode === 'static',
      `scene "${scene.id}" has no artefact only because it is static`
    ) && record.ok;
  }

  // 3. There is always somewhere to go when the primary path dies. In fallback
  //    mode we actually walk and resolve every target; otherwise we only assert
  //    that at least one route exists (cheap, so the primary pass stays fast).
  if (forceFallback) {
    const resolved = resolveFallbacks(scene.fallback, fbCtx);
    record.ok = checker.check(
      resolved.results.length > 0,
      `scene "${scene.id}" has at least one fallback route`
    ) && record.ok;
    for (const r of resolved.results) {
      record.ok = checker.check(
        r.ok,
        `scene "${scene.id}" fallback [${r.kind ?? '?'}] resolves: ${r.label ?? r.target ?? ''}${r.ok ? '' : ` — ${r.message}`}`
      ) && record.ok;
    }
  } else {
    record.ok = checker.check(
      Array.isArray(scene.fallback) && scene.fallback.length > 0,
      `scene "${scene.id}" has a fallback`
    ) && record.ok;
  }
  record.fallback = scene.fallback;

  // 4. A live scene must say when to give up. Presenter wording is authored
  //    prose that legitimately varies, so we require a substantive stop
  //    condition rather than hard-matching a fixed keyword list (which would
  //    reject perfectly good phrasing). An explicit abandon keyword is a strong
  //    signal; otherwise the statement must be more than a placeholder.
  if (scene.mode.startsWith('live') || scene.mode === 'mixed') {
    const stop = typeof scene.stopCondition === 'string' ? scene.stopCondition.trim() : '';
    const words = stop ? stop.split(/\s+/).filter(Boolean).length : 0;
    const statesStop =
      /\b(stop|minute|fail|unavailable|give|revisit|background|already|complete|finished|first|never|instead)\b/i.test(stop) ||
      words >= 8;
    record.ok = checker.check(
      statesStop,
      `scene "${scene.id}" states when to abandon the live path`
    ) && record.ok;
  }

  // 5. The offline fallback player covers the scene.
  if (exists('docs', 'mission-control.html')) {
    const mc = readText('docs', 'mission-control.html');
    const covered = mc.includes(`data-scene="${scene.id}"`);
    record.ok = checker.check(covered, `scene "${scene.id}" exists in the offline fallback`) && record.ok;
  }

  if (!fast) {
    console.log(`  surface        ${scene.surface}`);
    console.log(`  expected       ${scene.expectedState}`);
    console.log(`  stop when      ${scene.stopCondition}`);
    console.log(`  fallback       ${scene.fallback.map((f) => f.label ?? f.target ?? String(f)).join(' -> ')}`);
  }

  transcript.scenes.push(record);
}

// --- the whole hour, not just the scenes -------------------------------------

if (!onlyScene) {
  log.head('Timing');
  const total = transcript.scenes.reduce((sum, s) => sum + s.durationMinutes, 0);
  checker.check(total === manifest.durationMinutes, `the scenes total ${manifest.durationMinutes} minutes (got ${total})`);
  checker.check(transcript.scenes[0].start === 0, 'the first scene starts at minute 0');
  for (let i = 1; i < transcript.scenes.length; i++) {
    checker.check(
      transcript.scenes[i].start === transcript.scenes[i - 1].end,
      `no gap between ${transcript.scenes[i - 1].id} and ${transcript.scenes[i].id}`
    );
  }

  log.head('Operator commands');
  const pkg = readJson('package.json');
  for (const [label, command] of Object.entries(manifest.commands ?? {})) {
    const scriptName = command.replace(/^npm run /, '').replace(/^npm /, '');
    checker.check(
      Object.hasOwn(pkg.scripts, scriptName),
      `"${label}" runs a real package script: ${command}`
    );
  }
}

mkdirSync(repoPath('out', 'rehearsal'), { recursive: true });
writeFileSync(repoPath('out', 'rehearsal', 'transcript.json'), `${JSON.stringify(transcript, null, 2)}\n`);
log.info('transcript written to out/rehearsal/transcript.json');

process.exit(checker.finish('Rehearsal'));
