import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { loadManifest, readJson, readText, exists, repoPath } from '../scripts/lib/repo.mjs';

const manifest = loadManifest();
const scenes = [...manifest.scenes].sort((a, b) => a.order - b.order);
const shape = manifest.shape;

const SCENE_IDS = ['thesis', 'pulse', 'intake', 'refine', 'lanes', 'delegate', 'evidence', 'release', 'sre', 'coexist', 'close'];
const CHAPTERS = ['ch-intent', 'ch-proposal', 'ch-outcome'];
const showcase = readText('docs', 'showcase.html');
const presenter = readText('docs', 'presenter.html');
const mission = readText('docs', 'mission-control.html');

// --- timing -----------------------------------------------------------------

test('the showcase is exactly sixty minutes and tiles without gaps', () => {
  assert.equal(manifest.durationMinutes, 60);
  assert.equal(scenes[0].start, 0);
  assert.equal(scenes[scenes.length - 1].end, 60);
  for (let i = 1; i < scenes.length; i++) {
    assert.equal(scenes[i].start, scenes[i - 1].end, `gap between ${scenes[i - 1].id} and ${scenes[i].id}`);
  }
  assert.equal(scenes.reduce((s, x) => s + (x.end - x.start), 0), 60);
});

test('the sequence matches the agreed running order and windows', () => {
  assert.deepEqual(
    scenes.map((s) => [s.id, s.start, s.end]),
    [
      ['thesis', 0, 2], ['pulse', 2, 10], ['intake', 10, 13], ['refine', 13, 17],
      ['lanes', 17, 21], ['delegate', 21, 27], ['evidence', 27, 40], ['release', 40, 45],
      ['sre', 45, 51], ['coexist', 51, 58], ['close', 58, 60]
    ]
  );
});

test('the budget preserves the agreed per-scene minutes', () => {
  const minutes = Object.fromEntries(scenes.map((s) => [s.id, s.end - s.start]));
  assert.equal(minutes.pulse, 8, 'pulse keeps eight minutes');
  assert.equal(minutes.intake, 3, 'the experimental lane is capped at three minutes');
  assert.equal(minutes.evidence, 13, 'governance evidence keeps thirteen minutes');
  assert.equal(minutes.sre, 6, 'production feedback keeps six minutes');
  assert.equal(minutes.coexist, 7, 'adoption gets seven minutes');
});

// --- the two counts ---------------------------------------------------------

test('nine lifecycle stages, eleven demo scenes, fifteen slides', () => {
  assert.equal(shape.lifecycleStages, 9);
  assert.equal(shape.demoScenes, 11);
  assert.equal(shape.codingStages, 1);
  assert.equal(shape.slides, 15);
  assert.equal(shape.stages.length, 9);
  assert.equal(scenes.length, shape.demoScenes);
  assert.deepEqual(scenes.map((s) => s.id), SCENE_IDS);
  assert.equal(
    shape.sentence,
    'A nine-stage engineering loop shown in eleven demo scenes; only one lifecycle stage is coding.'
  );
});

test('no document conflates scenes with lifecycle stages', () => {
  const wrong = [/\beleven stages\b/i, /\b11 stages\b/i, /\bten stages\b/i, /\b10 stages\b/i];
  for (const file of ['README.md', 'AGENTS.md', 'docs/showcase.html', 'docs/presenter.html', 'docs/mission-control.html', 'docs/index.html', 'fixtures/prepared/10-followup.json']) {
    const content = readText(file);
    for (const pattern of wrong) assert.ok(!pattern.test(content), `${file} conflates counts: ${pattern}`);
  }
});

test('the loop diagram names the canonical nine stages and denies a tenth', () => {
  const label = showcase.match(/aria-label="(Nine stages[^"]+)"/);
  assert.ok(label, 'the loop diagram has no nine-stage aria-label');
  for (const stage of shape.stages) {
    assert.ok(label[1].includes(stage), `the diagram label omits the canonical stage "${stage}"`);
  }
  assert.match(label[1], /not a tenth stage/i);
});

test('the diagrams are inline and follow the page theme, not only the operating system', () => {
  assert.match(showcase, /<svg viewBox[^>]*role="img"/, 'diagrams are not inlined');
  assert.ok(!/<img[^>]+diagrams\//.test(showcase), 'a diagram is still referenced through img and cannot follow data-theme');
  const svgStyles = [...showcase.matchAll(/<svg[\s\S]*?<\/svg>/g)].map((m) => m[0]);
  assert.ok(svgStyles.length >= 2, 'expected at least two inline diagrams');
  for (const svg of svgStyles) {
    assert.match(svg, /var\(--/, 'an inline diagram does not use theme tokens');
    assert.ok(!/prefers-color-scheme/.test(svg), 'an inline diagram still relies on the operating system theme');
    assert.ok(!/fill:\s*#[0-9a-f]{3,8}/i.test(svg), 'an inline diagram hard-codes a colour literal');
  }
});

// --- slide budget and the scene crosswalk -----------------------------------

/**
 * Counts what the html-docs runtime treats as slides: every chapter with a
 * chapter label, every `.card` that is a DIRECT child of a chapter, and the
 * takeaway. Direct-child detection is a linear tag scan tracking `div` depth,
 * which is exactly the distinction the runtime's `:scope > .card` makes.
 */
function slideList(html) {
  const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
  const sections = main.split('<section class="chapter"').slice(1);
  const list = [];
  for (const section of sections) {
    const chapterId = section.match(/id="([^"]+)"/)?.[1];
    if (section.includes('<h2 class="chapter-label">')) list.push({ kind: 'chapter', id: chapterId });
    let depth = 0;
    for (const [, closing, tag, attrs] of section.matchAll(/<(\/?)(div|article)\b([^>]*)>/g)) {
      if (tag === 'div') { depth += closing ? -1 : 1; continue; }
      if (!closing && depth === 0 && /class="card\b/.test(attrs)) {
        list.push({ kind: 'card', id: attrs.match(/id="([^"]+)"/)?.[1] });
      }
    }
  }
  if (/<p class="takeaway">/.test(html)) list.push({ kind: 'takeaway', id: 'takeaway' });
  return list;
}

const slides = slideList(showcase);

test('slides mode produces exactly fifteen slides', () => {
  assert.equal(slides.length, 15, `expected 15 slides, got ${slides.length}`);
  assert.equal(slides.filter((s) => s.kind === 'chapter').length, 3, 'expected 3 section dividers');
  assert.equal(slides.filter((s) => s.kind === 'card').length, 11, 'expected 11 scene presentation cards');
  assert.equal(slides.filter((s) => s.kind === 'takeaway').length, 1);
});

test('every manifest scene has its own stage-ready slide at the recorded index', () => {
  for (const scene of scenes) {
    assert.ok(scene.card, `${scene.id} declares no card id`);
    assert.ok(showcase.includes(`id="${scene.card}"`), `${scene.id}: card ${scene.card} is missing from the article`);
    const index = slides.findIndex((s) => s.id === scene.card);
    assert.notEqual(index, -1, `${scene.id}: card ${scene.card} is not a slide`);
    assert.equal(index + 1, scene.slideIndex, `${scene.id}: slide index is ${index + 1}, manifest says ${scene.slideIndex}`);
  }
  const cardSlides = slides.filter((s) => s.kind === 'card').map((s) => s.id);
  assert.deepEqual(cardSlides, scenes.map((s) => s.card), 'slide order does not match scene order');
});

test('every chapter divider is declared in the manifest and carries its scenes', () => {
  assert.deepEqual(manifest.chapters.map((c) => c.id), CHAPTERS);
  const declared = manifest.chapters.flatMap((c) => c.scenes);
  assert.deepEqual(declared, SCENE_IDS, 'chapter scene lists do not cover the sequence in order');
  for (const chapter of manifest.chapters) {
    assert.ok(showcase.includes(`id="${chapter.id}"`), `chapter ${chapter.id} is missing from the article`);
    for (const sceneId of chapter.scenes) {
      const scene = scenes.find((s) => s.id === sceneId);
      assert.equal(scene.chapter, chapter.id, `${sceneId} points at ${scene.chapter} but is listed under ${chapter.id}`);
    }
  }
});

test('the article still carries full depth below the presentation cards', () => {
  const total = [...showcase.matchAll(/<article class="card/g)].length;
  assert.ok(total >= 24, `only ${total} cards; depth was lost in the restructure`);
  assert.ok(total - 11 >= 12, 'not enough nested detail cards');
});

// --- question markers -------------------------------------------------------

test('every scene slide carries a persistent question marker', () => {
  for (const scene of scenes) {
    assert.ok(Array.isArray(scene.questions) && scene.questions.length > 0, `${scene.id} declares no question`);
    for (const q of scene.questions) assert.ok(q >= 1 && q <= 7, `${scene.id} references question ${q}`);
    const start = showcase.indexOf(`id="${scene.card}"`);
    const head = showcase.slice(start, start + 900);
    assert.match(head, /class="card-sub"/, `${scene.card} has no subtitle to carry the marker`);
    assert.match(
      head,
      /Question[s]? [\d, and]+ of 7|All seven questions|Q\d(?: to Q\d)?|Q1 to Q7/,
      `${scene.card} does not display which of the seven questions it answers`
    );
  }
});

test('the evidence, release and production slides visibly answer their questions', () => {
  const slice = (id, next) => showcase.slice(showcase.indexOf(`id="${id}"`), showcase.indexOf(`id="${next}"`));
  const evidence = slice('card-evidence', 'card-separation');
  assert.match(evidence, /Policy/, 'the evidence slide does not visibly answer policy');
  assert.match(evidence, /Accountability/, 'the evidence slide does not visibly answer accountability');
  assert.match(evidence, /ruleset/i);
  assert.match(evidence, /CODEOWNERS/);
  const release = slice('card-release', 'card-oidc');
  assert.match(release, /Provenance/i);
  assert.match(release, /Authority/i);
  const sre = slice('card-sre', 'card-sre-source');
  assert.match(sre, /Any operational agent/i, 'the production slide is not cloud-neutral');
  assert.match(sre, /does not prove GitHub write-back/i, 'the production slide drops the limitation');
});

// --- deterministic evidence count -------------------------------------------

test('the evidence slide renders exactly as many checks as the fixture declares', () => {
  const evidence = readJson('fixtures', 'prepared', '06-pr-evidence.json');
  const count = evidence.deterministicChecks.length;
  assert.equal(count, 8);
  const card = showcase.slice(showcase.indexOf('id="card-evidence"'), showcase.indexOf('id="card-separation"'));
  const rendered = [...card.matchAll(/<li>(?!<)/g)].length;
  assert.equal(rendered, count, `the slide renders ${rendered} checks, the fixture declares ${count}`);
  assert.match(card, /Eight checks/, 'the headline must state the same number');
  assert.match(card, /dependency.review/i);
});

// --- execution surfaces -----------------------------------------------------

test('there are exactly four execution surfaces, named consistently everywhere', () => {
  const surfaces = manifest.executionSurfaces;
  assert.equal(surfaces.length, 4);
  assert.deepEqual(surfaces.map((s) => s.id), ['ide', 'cli', 'app', 'hosted']);

  const lanes = readJson('fixtures', 'prepared', '04-lane-comparison.json');
  assert.equal(lanes.surfaces.length, 4, 'the fixture does not declare four surfaces');
  assert.deepEqual(lanes.surfaces.map((s) => s.id), surfaces.map((s) => s.id));

  const scene = scenes.find((s) => s.id === 'lanes');
  assert.match(scene.title, /Four execution surfaces/);
  assert.match(scene.expectedState, /four surfaces/i);

  const card = showcase.slice(showcase.indexOf('id="card-lanes"'), showcase.indexOf('id="card-hosted"'));
  assert.match(card, /Four execution surfaces/);
  for (const label of ['IDE', 'CLI', 'Agent app', 'Cloud agents']) {
    assert.ok(card.includes(label), `the lanes slide omits the ${label} surface`);
  }
  assert.match(presenter, /[Ff]our execution surfaces|[Ff]our surfaces/, 'the talk track does not say four');
  assert.match(mission, /IDE/, 'the offline fallback does not list the surfaces');
});

// --- presenter titles must agree with the manifest mode ---------------------

test('every presenter scene title matches the manifest mode', () => {
  const MODE_WORD = { live: 'Live', prepared: 'Prepared', static: 'Static', mixed: 'Mixed' };
  for (const scene of scenes) {
    assert.ok(scene.presenterTitle, `${scene.id} has no presenter title`);
    const expected = MODE_WORD[scene.mode];
    assert.ok(expected, `${scene.id} has unknown mode ${scene.mode}`);
    assert.ok(
      scene.presenterTitle.startsWith(`${expected} —`),
      `${scene.id} is mode "${scene.mode}" but titled "${scene.presenterTitle}"`
    );
    assert.ok(presenter.includes(scene.presenterTitle), `presenter guide does not use the title "${scene.presenterTitle}"`);
  }
});

test('the experimental intake lane is never described as live', () => {
  const intake = scenes.find((s) => s.id === 'intake');
  assert.equal(intake.mode, 'prepared');
  assert.equal(intake.presenterTitle, 'Prepared — Issue intake (experimental lane)');
  assert.ok(!/Live — Issue intake/.test(presenter), 'the presenter guide still calls intake live');
  assert.match(intake.stopCondition, /[Pp]repared only/);
});

// --- crosswalk in the presenter guide ---------------------------------------

test('the presenter guide renders a scene to slide to tab to question crosswalk', () => {
  assert.match(presenter, /id="card-crosswalk"/, 'no crosswalk card');
  for (const scene of scenes) {
    assert.ok(presenter.includes(scene.card), `crosswalk omits card ${scene.card}`);
    assert.ok(presenter.includes(scene.tab), `crosswalk omits tab "${scene.tab}" for ${scene.id}`);
  }
});

test('every scene declares a tab and it is one of the documented tabs', () => {
  const tabs = new Set(scenes.map((s) => s.tab));
  for (const scene of scenes) assert.ok(scene.tab, `${scene.id} has no tab`);
  for (const tab of tabs) assert.ok(presenter.includes(tab), `the presenter guide never mentions tab "${tab}"`);
});

// --- scenes reach every consumer --------------------------------------------

test('every scene has a card in the offline fallback and the presenter run of show', () => {
  for (const scene of scenes) {
    assert.ok(mission.includes(`data-scene="${scene.id}"`), `${scene.id} missing from the offline fallback`);
    assert.ok(presenter.includes(`id="card-scene-${scene.id}"`), `${scene.id} has no presenter card`);
  }
});

test('the presenter guide and offline fallback state the manifest windows', () => {
  for (const scene of scenes) {
    const w = `${String(scene.start).padStart(2, '0')} to ${String(scene.end).padStart(2, '0')}`;
    assert.ok(presenter.includes(w), `presenter omits window "${w}" for ${scene.id}`);
    assert.ok(mission.includes(w), `offline fallback omits window "${w}" for ${scene.id}`);
  }
});

// --- structured fallbacks ---------------------------------------------------

test('every fallback is a structured object whose target resolves', () => {
  const kinds = new Set(['file', 'url', 'doc-scene', 'narrate']);
  for (const scene of scenes) {
    assert.ok(Array.isArray(scene.fallback) && scene.fallback.length > 0, `${scene.id} has no fallback`);
    for (const fb of scene.fallback) {
      assert.equal(typeof fb, 'object', `${scene.id} still has a prose fallback`);
      assert.ok(kinds.has(fb.kind), `${scene.id} unknown fallback kind "${fb.kind}"`);
      assert.ok(fb.label, `${scene.id} fallback has no label`);
      if (fb.kind === 'file') assert.ok(exists(fb.target), `${scene.id} fallback file missing: ${fb.target}`);
      if (fb.kind === 'doc-scene') assert.ok(mission.includes(`data-scene="${fb.target}"`), `${scene.id} fallback scene missing: ${fb.target}`);
      if (fb.kind !== 'narrate') assert.ok(fb.target, `${scene.id} ${fb.kind} fallback has no target`);
    }
  }
});

// --- artefacts --------------------------------------------------------------

test('every prepared artefact labels itself, dates itself, and names its scene', () => {
  for (const scene of scenes) {
    if (!scene.artifact) continue;
    const a = readJson(scene.artifact);
    assert.equal(a.scene, scene.id);
    assert.ok(a.status && a.labelInUi);
    assert.match(a.capturedOn, /^\d{4}-\d{2}-\d{2}$/);
  }
  const files = readdirSync(repoPath('fixtures', 'prepared')).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
  const referenced = new Set(scenes.map((s) => s.artifact).filter(Boolean).map((p) => p.split('/').pop()));
  for (const f of files) assert.ok(referenced.has(f), `${f} is orphaned`);
});

// --- adoption: phases are time, dispositions are per repository -------------

test('the adoption model is rendered from the fixture and separates phases from dispositions', () => {
  const adoption = readJson('fixtures', 'prepared', '09-adoption-matrix.json');
  assert.ok(Array.isArray(adoption.phases) && adoption.phases.length === 2, 'expected two time phases');
  assert.ok(Array.isArray(adoption.dispositions) && adoption.dispositions.length === 3, 'expected three repository dispositions');
  assert.deepEqual(adoption.dispositions.map((d) => d.id), ['migrate', 'mirror', 'leave']);

  for (const doc of [showcase, presenter, mission]) {
    assert.ok(!/wave zero/i.test(doc), 'the retired "wave zero" language is still present');
  }
  for (const phase of adoption.phases) {
    assert.ok(showcase.includes(phase.label), `the article omits phase "${phase.label}"`);
  }
  for (const d of adoption.dispositions) {
    assert.ok(showcase.includes(d.label), `the article omits disposition "${d.label}"`);
  }
});

test('the adoption slide states the three cost and entitlement lines', () => {
  const adoption = readJson('fixtures', 'prepared', '09-adoption-matrix.json');
  assert.equal(adoption.costLines.length, 3);
  const card = showcase.slice(showcase.indexOf('id="card-coexist"'), showcase.indexOf('id="card-cost"'));
  assert.match(card, /Actions minutes/i);
  assert.match(card, /AI credits/i);
  assert.match(card, /Advanced Security/i);
});

test('the pilot ask names participants, artefacts, the review point and the decision', () => {
  const pilot = showcase.slice(showcase.indexOf('id="card-pilot"'), showcase.indexOf('id="card-dispositions"'));
  for (const who of ['repository owner', 'security reviewer', 'platform engineer']) {
    assert.ok(pilot.includes(who), `the pilot ask omits the ${who}`);
  }
  assert.match(pilot, /day 14|two weeks/i);
  assert.match(pilot, /decision it exists to make/i);
  assert.equal([...pilot.matchAll(/<h4>/g)].length, 5, 'the pilot must name exactly five evidence artefacts');
});

test('the platform-gap argument is incumbent-neutral', () => {
  const card = showcase.slice(showcase.indexOf('id="card-primitives"'), showcase.indexOf('id="card-pulse"'));
  assert.match(card, /native/i);
  assert.match(card, /integrated/i);
  assert.match(card, /custom/i);
  assert.equal(shape.questions.length, 7);
  for (const doc of [showcase, presenter]) {
    assert.ok(!/Bitbucket is (worse|inferior|bad)/i.test(doc));
    assert.ok(!/Jira is (worse|inferior|bad)/i.test(doc));
  }
});

// --- operator commands ------------------------------------------------------

test('every operator command in the manifest is a real package script', () => {
  const pkg = readJson('package.json');
  for (const [label, command] of Object.entries(manifest.commands)) {
    const script = command.replace(/^npm run /, '').replace(/^npm /, '');
    assert.ok(Object.hasOwn(pkg.scripts, script), `"${label}" runs a missing script: ${command}`);
  }
});

test('the presenter guide keeps its compression plan and projector rule', () => {
  assert.match(presenter, /id="card-compression"/);
  assert.match(presenter, /saves \d+ minutes?/);
  assert.match(presenter, /id="card-projector"/);
  assert.match(presenter, /Question time is after the hour/i);
});

test('the closing metric is expressed in counts, never percentages', () => {
  const f = readJson('fixtures', 'prepared', '10-followup.json');
  assert.equal(f.metricStyle.usesPercentages, false);
  assert.ok(!/%/.test(f.followUpIssue.title));
  assert.ok(!/\d\s*%/.test(f.followUpIssue.body));
});

// --- Round 3: tabs, stop conditions, trust model -----------------------------

test('the manifest defines eight clean tabs and every scene maps onto one', () => {
  assert.equal(manifest.tabs.length, 8);
  assert.deepEqual(manifest.tabs.map((t) => t.number), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const tab of manifest.tabs) {
    assert.ok(tab.label && !/^\d/.test(tab.label), `tab ${tab.number} label must not repeat its number`);
    assert.ok(tab.opens, `tab ${tab.number} does not say what it opens`);
  }
  const byNumber = new Map(manifest.tabs.map((t) => [t.number, t]));
  for (const scene of scenes) {
    const tab = byNumber.get(scene.tab);
    assert.ok(tab, `${scene.id} points at tab ${scene.tab}, which is not defined`);
    assert.equal(scene.tabLabel, `${tab.number} \u2014 ${tab.label}`, `${scene.id} tabLabel drifted from the tab definition`);
    assert.ok(scene.tabRouting, `${scene.id} has no routing text`);
    assert.ok(!scene.tabLabel.includes(scene.tabRouting), `${scene.id} conflates its label with its routing text`);
  }
});

test('there are exactly two backwards jumps to tab 1, at minute 17 and minute 45', () => {
  const jumps = scenes.filter((s) => s.backwardsJump === true);
  assert.equal(jumps.length, 2, 'the tab order claims a number of backwards jumps it does not have');
  assert.deepEqual(jumps.map((s) => s.start), [17, 45]);
  for (const jump of jumps) assert.equal(jump.tab, 1, 'a backwards jump must return to tab 1');
  assert.match(presenter, /Exactly two backwards jumps to tab 1, at minute 17 and minute 45/,
    'the tab-order card does not state the same number of jumps');
  assert.match(presenter, /Two backwards jumps to tab 1, at minute 17 and minute 45/,
    'the crosswalk card does not state the same number of jumps');
});

test('every presenter scene card carries the canonical stop condition verbatim', () => {
  for (const scene of scenes) {
    const start = presenter.indexOf(`id="card-scene-${scene.id}"`);
    assert.ok(start > -1, `no presenter card for ${scene.id}`);
    const card = presenter.slice(start, start + 4200);
    if (/^None\b/.test(scene.stopCondition)) continue;
    assert.ok(card.includes(scene.stopCondition),
      `the ${scene.id} presenter card does not carry the manifest stop condition verbatim`);
  }
});

test('the intake lane is prepared, experimental, and hard-bounded at three minutes', () => {
  const intake = scenes.find((s) => s.id === 'intake');
  assert.equal(intake.end - intake.start, 3);
  assert.equal(intake.mode, 'prepared');
  const start = presenter.indexOf('id="card-scene-intake"');
  const card = presenter.slice(start, start + 4200);
  assert.match(card, /Prepared \u2014 Issue intake \(experimental lane\)/, 'the intake heading must not read Live');
  assert.ok(!/\bLive\b/.test(card.slice(0, card.indexOf('card-body'))), 'the intake title claims a live lane');
  assert.match(card, /Three minutes, hard/);
});

test('the trust model distinguishes reviewed input from attacker-controlled input', () => {
  const pulse = scenes.find((s) => s.id === 'pulse');
  const intake = scenes.find((s) => s.id === 'intake');
  assert.equal(pulse.trustModel.attackerControlled, false);
  assert.equal(intake.trustModel.attackerControlled, true);
  assert.equal(pulse.trustModel.labelGate, false);
  assert.equal(intake.trustModel.labelGate, true);
  const card = showcase.slice(showcase.indexOf('id="card-pulse"'), showcase.indexOf('id="card-limits"'));
  assert.match(card, /reviewed repository content, not attacker-controlled/i,
    'the pulse slide does not state that committed telemetry is reviewed input');
  const gate = showcase.slice(showcase.indexOf('id="card-trust-model"'), showcase.indexOf('id="card-intake"'));
  assert.match(gate, /an issue body[\s\S]{0,400}attacker-controlled/i);
  assert.match(gate, /The pulse lane does not need this, and does not have it/);
});

test('the seven primitives are paired to the seven questions and shown on the thesis slide', () => {
  assert.equal(shape.primitives.length, 7);
  assert.equal(shape.questions.length, 7);
  const card = showcase.slice(showcase.indexOf('id="card-thesis"'), showcase.indexOf('id="card-primitives"'));
  for (const label of ['Intent', 'Proposal', 'Evidence', 'Policy', 'Accountability', 'Release', 'Feedback']) {
    assert.ok(card.includes(`${label}</strong>`) || card.includes(`${label}</span>`),
      `the thesis slide does not visibly carry the ${label} primitive`);
  }
});

test('the pulse slide shows the bounded control contract, not only the pipeline', () => {
  const card = showcase.slice(showcase.indexOf('id="card-pulse"'), showcase.indexOf('id="card-limits"'));
  for (const token of ['permissions:', 'timeout-minutes', 'max-turns', 'max-ai-credits', 'safe-outputs']) {
    assert.ok(card.includes(token), `the pulse slide does not show ${token}`);
  }
});

test('the compression plan cuts only from checkpoints, and never the close', () => {
  const card = presenter.slice(presenter.indexOf('id="card-compression"'), presenter.indexOf('id="card-projector"'));
  assert.match(card, /Checkpoint 1 &mdash; minute 10 entering intake, and again at minute 13/);
  assert.match(card, /Checkpoint 2 &mdash; minute 27 entering evidence, and again at minute 29/);
  assert.match(card, /never cut the close/i);
  assert.ok(!/Six named cuts/.test(card), 'the superseded ordered cut list survives');
  assert.ok(!/five-step adoption path/i.test(presenter), 'the presenter still points at a path that no longer exists');
  assert.ok(!/capability matrix/i.test(presenter), 'the presenter still points at a matrix that no longer exists');
});

test('the diagram directory is gone and nothing still references it', () => {
  assert.ok(!exists('docs', 'diagrams'), 'docs/diagrams is orphaned and must not be committed');
  for (const doc of [showcase, presenter, mission]) {
    assert.ok(!/docs\/diagrams|diagrams\//.test(doc), 'a document still references the removed diagram directory');
  }
});

test('the prepared evidence states the real test counts, not a stale number', () => {
  const countIn = (dir) => readdirSync(repoPath(dir))
    .filter((f) => f.endsWith('.js'))
    .reduce((n, f) => n + (readText(dir, f).match(/^test\(/gm) || []).length, 0);
  const app = countIn('app/test');
  const total = app + countIn('test');

  const proves = readJson('fixtures', 'prepared', '06-pr-evidence.json').deterministicChecks[0].proves;
  const stated = [...proves.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(stated.includes(total), `the prepared evidence claims ${stated.join(' and ')} tests; the suite has ${total}`);
  assert.ok(stated.includes(app), `the prepared evidence claims ${stated.join(' and ')} service tests; app/test has ${app}`);
});

test('mission control names every deterministic check exactly as the fixture does', () => {
  const evidence = readJson('fixtures', 'prepared', '06-pr-evidence.json');
  for (const check of evidence.deterministicChecks) {
    assert.ok(mission.includes(check.name),
      `the offline fallback does not carry the exact check name "${check.name}"`);
    assert.ok(showcase.includes(check.name),
      `the evidence slide does not carry the exact check name "${check.name}"`);
  }
});

// --- Round 4: titles, neutrality-adjacent rendering, adoption depth ----------

test('every scene renders its canonical manifest title on its own card', () => {
  for (const scene of scenes) {
    const start = showcase.indexOf(`id="${scene.card}"`);
    assert.ok(start > -1, `no card for ${scene.id}`);
    const head = showcase.slice(start, start + 1600);
    const match = head.match(/<span class="card-title">([^<]+)<\/span>/);
    assert.ok(match, `${scene.id} has no rendered card title`);
    assert.equal(match[1], scene.title,
      `${scene.id} renders a title that differs from the manifest`);
  }
});

test('the pulse scene leads with the guardrail outcome, everywhere it is named', () => {
  const pulse = scenes.find((s) => s.id === 'pulse');
  assert.match(pulse.title, /compiled contract bounds the write/i,
    'the pulse title still describes a generic mechanism');
  for (const [name, doc] of [['presenter', presenter], ['mission control', mission]]) {
    assert.ok(doc.includes(pulse.title), `${name} does not carry the canonical pulse title`);
  }
});

test('the pulse scene states the product stage and the pinned compiler version', () => {
  const card = showcase.slice(showcase.indexOf('id="card-pulse"'), showcase.indexOf('id="card-limits"'));
  assert.match(card, /public preview/i, 'the pulse slide does not state the product stage');
  assert.match(card, /v0\.86\.2/, 'the pulse slide does not state the pinned compiler version');
  assert.match(card, /ordinary committed Actions YAML/i,
    'the pulse slide does not say the compiled lock is ordinary Actions YAML');
});

test('the thesis scene reassures that nothing migrates, and labels the questions Q1 to Q7', () => {
  const card = showcase.slice(showcase.indexOf('id="card-thesis"'), showcase.indexOf('id="card-primitives"'));
  assert.match(card, /Nothing migrates for this demonstration/i);
  assert.match(card, /native, integrated, or custom/i);
  for (let n = 1; n <= 7; n++) {
    assert.ok(card.includes(`Q${n} `), `the thesis slide does not label question Q${n}`);
  }
});

test('the takeaway carries the pilot ask in one line', () => {
  const takeaway = showcase.slice(showcase.indexOf('class="takeaway"'), showcase.indexOf('class="takeaway"') + 700);
  assert.match(takeaway, /one low-risk repository/i);
  assert.match(takeaway, /two weeks/i);
  assert.match(takeaway, /five evidence artefacts/i);
  assert.match(takeaway, /day 14/i);
});

test('every row of the adoption matrix reaches attendee-visible HTML', () => {
  const matrix = readJson('fixtures', 'prepared', '09-adoption-matrix.json');
  for (const row of matrix.capabilityMatrix) {
    assert.ok(showcase.includes(row.capability),
      `the capability "${row.capability}" is not rendered anywhere in the article`);
  }
  assert.equal(matrix.capabilityMatrix.length, 14);
  for (const step of matrix.lowRiskAdoptionPath) {
    const head = step.split('.')[0];
    assert.ok(showcase.includes(head), `the adoption step "${head}" is not rendered`);
  }
  assert.equal(matrix.lowRiskAdoptionPath.length, 5);
  // Depth, not a new slide: both cards must sit inside a non-chapter wrapper.
  for (const id of ['card-capability', 'card-low-risk']) {
    assert.ok(showcase.includes(`id="${id}"`), `${id} is missing`);
  }
});

test('the purpose-built surface is described as a category, with Copilot as the example', () => {
  const card = showcase.slice(showcase.indexOf('id="card-lanes"'), showcase.indexOf('id="card-hosted"'));
  assert.match(card, /purpose-built agent application/i, 'the tile names a product instead of a category');
  assert.match(card, /Copilot app is the example/i, 'the tile does not name the demonstrated example');
});

test('inline diagram text is large enough to read from the back of a room', () => {
  // The fit zoom scales the whole slide, so a diagram that is too tall shrinks
  // its own text. Both diagrams end up occupying the same rendered width at the
  // smallest target size, 1280x720: measured in the browser sweep as 1069px for
  // the 1600-wide viewBox and 1072px for the 1000-wide one. Take the lower of
  // those as the calibration constant, so this static check agrees with what the
  // browser reports rather than guessing at the zoom twice.
  const RENDERED_WIDTH = 1069;
  const svgs = [...showcase.matchAll(/<svg viewBox="0 0 (\d+) \d+"[\s\S]*?<\/svg>/g)];
  assert.equal(svgs.length, 2, 'expected exactly two inline diagrams');
  for (const svg of svgs) {
    const viewBoxWidth = Number(svg[1]);
    const sizes = [...svg[0].matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    assert.ok(sizes.length > 0, 'a diagram declares no font sizes');
    for (const size of sizes) {
      const effective = size * RENDERED_WIDTH / viewBoxWidth;
      assert.ok(effective >= 20,
        `diagram text at ${size}px in a ${viewBoxWidth}-wide viewBox renders about ${effective.toFixed(1)}px at 1280x720, below the 20px floor`);
    }
  }
});

test('the trust model is never conflated between the two lanes', () => {
  const pulse = scenes.find((s) => s.id === 'pulse');
  const intake = scenes.find((s) => s.id === 'intake');

  // The gate belongs to the untrusted-input lane only.
  assert.equal(pulse.trustModel.labelGate, false);
  assert.equal(intake.trustModel.labelGate, true);
  assert.equal(pulse.trustModel.attackerControlled, false);
  assert.equal(intake.trustModel.attackerControlled, true);

  // No document may describe committed telemetry as attacker-controlled, nor
  // claim the pulse lane carries a label gate.
  for (const [name, doc] of [['showcase', showcase], ['presenter', presenter], ['mission control', mission]]) {
    assert.ok(!/committed telemetry is attacker-controlled/i.test(doc),
      `${name} calls committed telemetry attacker-controlled`);
    assert.ok(!/pulse[^.]{0,80}label gate/i.test(doc),
      `${name} attaches a label gate to the pulse lane`);
  }
  assert.match(showcase, /reviewed repository content, not attacker-controlled/i);
  assert.match(showcase, /The pulse lane does not need this, and does not have it/);
});
