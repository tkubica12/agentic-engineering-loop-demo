import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { loadManifest, readJson, readText, exists, repoPath } from '../scripts/lib/repo.mjs';

const manifest = loadManifest();
const scenes = [...manifest.scenes].sort((a, b) => a.order - b.order);
const shape = manifest.shape;

const SCENE_IDS = ['thesis', 'pulse', 'intake', 'refine', 'lanes', 'delegate', 'evidence', 'release', 'sre', 'coexist', 'close'];
const CHAPTERS = ['ch-intent', 'ch-proposal', 'ch-outcome'];
const CONCERN_NAMES = shape.concerns.map((c) => c.name);
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

test('nine graph concerns, eleven demo scenes, fifteen slides', () => {
  assert.equal(shape.graphConcerns, 9);
  assert.equal(shape.demoScenes, 11);
  assert.equal(shape.codingConcerns, 1);
  assert.equal(shape.slides, 15);
  assert.equal(shape.concerns.length, 9);
  assert.equal(scenes.length, shape.demoScenes);
  assert.deepEqual(scenes.map((s) => s.id), SCENE_IDS);
  assert.equal(
    shape.sentence,
    'A nine-concern engineering graph shown in eleven demo scenes; only one concern is coding.'
  );
  assert.deepEqual(CONCERN_NAMES, [
    'Signal', 'Intent', 'Contract', 'Lane', 'Implementation',
    'Evidence', 'Authority', 'Release', 'Production'
  ]);
});

test('no document conflates scenes with graph concerns', () => {
  const wrong = [/\beleven concerns\b/i, /\b11 concerns\b/i, /\bten concerns\b/i, /\b10 concerns\b/i];
  for (const file of ['README.md', 'AGENTS.md', 'docs/showcase.html', 'docs/presenter.html', 'docs/mission-control.html', 'docs/index.html', 'fixtures/prepared/10-followup.json']) {
    const content = readText(file);
    for (const pattern of wrong) assert.ok(!pattern.test(content), `${file} conflates counts: ${pattern}`);
  }
});

test('the hero diagram is a graph: nine concerns, four entry points, backwards edges', () => {
  const label = showcase.match(/aria-label="(The engineering graph[^"]+)"/);
  assert.ok(label, 'the hero diagram has no engineering-graph aria-label');
  for (const concern of CONCERN_NAMES) {
    assert.ok(label[1].includes(concern), `the diagram label omits the canonical concern "${concern}"`);
  }

  // The graph must not read as a queue that always starts at Signal.
  assert.match(label[1], /one path through the graph, not the definition of the system/i,
    'the diagram does not deny that the left-to-right reading defines the system');
  assert.ok(!/tenth stage|back to stage one/i.test(showcase),
    'the retired "return to stage one" framing survives somewhere in the deck');

  // Every declared entry point reaches the diagram and the concern it enters at.
  assert.equal(shape.entryPoints.length, 4);
  for (const entry of shape.entryPoints) {
    assert.ok(CONCERN_NAMES.includes(entry.entersAt), `${entry.id} enters at a concern that does not exist`);
    assert.ok(label[1].toLowerCase().includes(entry.label.toLowerCase()),
      `the diagram label omits the "${entry.label}" entry point`);
  }
  assert.ok(new Set(shape.entryPoints.map((e) => e.entersAt)).size >= 3,
    'the entry points collapse onto too few concerns to disprove a single start');

  // Feedback edges are plural, drawn, and named.
  assert.equal(shape.feedbackEdges.length, 3);
  for (const edge of shape.feedbackEdges) {
    assert.ok(edge.to.length >= 2, `the ${edge.from} feedback edge names only one target`);
    for (const target of edge.to) {
      assert.ok(CONCERN_NAMES.includes(target), `${edge.from} feeds back into "${target}", which is not a concern`);
    }
  }
  const svg = showcase.match(/<svg viewBox="0 0 1600 \d+"[\s\S]*?<\/svg>/)[0];
  const dashedHeads = [...svg.matchAll(/<polygon class="ha"/g)].length;
  assert.ok(dashedHeads >= 6, `only ${dashedHeads} feedback arrowheads; the backwards edges must be plural and drawn`);
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
  if (/<p class="takeaway"[\s>]/.test(html)) list.push({ kind: 'takeaway', id: 'card-takeaway' });
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

// --- concern and question markers -------------------------------------------

test('every scene slide carries its concern and its plain question', () => {
  const questions = new Set(shape.concerns.map((c) => c.question));
  for (const scene of scenes) {
    assert.ok(Array.isArray(scene.concerns) && scene.concerns.length > 0, `${scene.id} declares no concern`);
    for (const concern of scene.concerns) {
      assert.ok(CONCERN_NAMES.includes(concern), `${scene.id} references "${concern}", which is not a concern`);
    }
    assert.ok(scene.question, `${scene.id} declares no question`);
    if (!scene.crossCutting) {
      for (const concern of scene.concerns) {
        const canonical = shape.concerns.find((c) => c.name === concern).question;
        assert.ok(scene.question.includes(canonical),
          `${scene.id} demonstrates "${concern}" but its marker does not carry that concern's question`);
      }
    }
    const start = showcase.indexOf(`id="${scene.card}"`);
    const head = showcase.slice(start, start + 1200);
    assert.match(head, /class="card-sub"/, `${scene.card} has no subtitle to carry the marker`);
  }
  assert.equal(questions.size, 9, 'two concerns share a question, so the pairing is not one to one');
});

test('every concern and its question is rendered, and no numbered taxonomy survives', () => {
  // Each demonstrating scene projects one pair as its slide subtitle, and the
  // reader-depth card lists all nine. Both must be true: the room sees the pair
  // for the concern in front of it, and the article carries the whole set.
  const projected = scenes.filter((s) => !s.crossCutting).map((s) => s.sceneMarker);
  for (const concern of shape.concerns) {
    assert.ok(projected.some((m) => m.includes(concern.name) && m.includes(concern.question)),
      `no projected slide pairs "${concern.name}" with "${concern.question}"`);
    const grid = `<span class="summary-label">${concern.name}</span>${concern.question}`;
    assert.ok(showcase.includes(grid),
      `the reader-depth grid does not render "${concern.name} — ${concern.question}"`);
  }

  // The retired Q1..Q7 taxonomy must not reappear anywhere attendees can read it,
  // and the configuration must no longer allow the labels through the scanner.
  for (const [name, doc] of [['showcase', showcase], ['presenter', presenter], ['mission control', mission], ['index', readText('docs', 'index.html')]]) {
    assert.ok(!/\bQ[1-7]\b/.test(doc), `${name} still carries a Q1-style question label`);
    assert.ok(!/\bseven questions\b/i.test(doc), `${name} still promises seven questions`);
  }
  const sceneWords = readJson('config', 'showcase.config.json').neutrality.sceneWords;
  assert.ok(!sceneWords.some((w) => /^Q[1-7]$/.test(w)),
    'the neutrality allowlist still permits a Q1-style label');
});

test('the entry points and the backwards edges reach the attendee-facing deck', () => {
  const pulse = showcase.slice(showcase.indexOf('id="card-pulse"'), showcase.indexOf('id="card-limits"'));
  for (const entry of shape.entryPoints) {
    assert.ok(new RegExp(entry.label, 'i').test(pulse), `the entry-point slide omits "${entry.label}"`);
    assert.ok(pulse.includes(entry.entersAt), `the entry-point slide does not say where "${entry.label}" enters`);
  }
  assert.match(pulse, /this demonstration enters at telemetry/i,
    'the entry-point slide does not say which entry this hour actually uses');

  // The plural backwards edges are stated in reader depth, not only drawn.
  const counts = showcase.slice(showcase.indexOf('id="card-counts"'), showcase.indexOf('<!-- SCENE 2 -->'));
  for (const edge of shape.feedbackEdges) {
    assert.ok(counts.includes(edge.from), `the graph card does not name the ${edge.from} feedback edge`);
  }
  assert.match(counts, /Nothing says work must start at signal/i,
    'the graph card does not deny a single entry point');
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
  assert.match(sre, /GitHub write-back is the named next step, not proof/i,
    'the production slide drops the write-back limitation');
  assert.match(sre, /no GitHub connector/i,
    'the production slide drops the evidence for the write-back limitation');
});

test('each scene slide carries its own sharp line, not only the card nested below it', () => {
  // Depth cards are not slides. A line that only exists in a nested card never
  // reaches the room, so the four load-bearing lines must be on the slide.
  const slice = (id, next) => showcase.slice(showcase.indexOf(`id="${id}"`), showcase.indexOf(`id="${next}"`));

  assert.match(slice('card-pulse', 'card-limits'),
    /If you cannot read an agent's limits in a diff, you do not have limits; you have hopes\./,
    'the pulse slide does not carry the guardrail line');

  assert.match(slice('card-intake', 'card-opencode-status'),
    /Arrange the system so obeying a malicious instruction achieves nothing/,
    'the intake slide does not carry the trust-model line');

  const evidence = slice('card-evidence', 'card-separation');
  assert.match(evidence, /toPublicItem\(substitute\)/, 'the evidence slide does not show the remediation');
  assert.match(evidence, /AC-4/, 'the evidence slide does not name the check that proves the remediation');

  const thesis = slice('card-thesis', 'card-graph-questions');
  assert.match(thesis, /steering/i, 'the thesis slide does not name what the hard part actually is');
  assert.match(thesis, /maintained bridges behind the custom ones are the platform cost/i,
    'the thesis slide does not name where the platform cost sits');
});

test('no attendee-facing document addresses one audience\'s named stack', () => {
  // The projected thesis once told a specific room that its own tools could
  // remain. That is engagement wording, not a public argument, and the public
  // documents must make the coexistence point generically instead.
  const RETIRED = [
    /Nothing migrates for this demonstration/i,
    /Your Bitbucket repositories/i,
    /your Jira projects/i,
    /Keep Bitbucket and Jira/i
  ];
  for (const [name, doc] of [['showcase', showcase], ['presenter', presenter], ['mission control', mission], ['index', readText('docs', 'index.html')]]) {
    for (const pattern of RETIRED) {
      assert.ok(!pattern.test(doc), `${name} still addresses a specific audience stack: ${pattern}`);
    }
    assert.ok(!/\b(Bitbucket|Jira)\b/.test(doc),
      `${name} names an incumbent product where a generic phrase belongs`);
  }
  const coexist = showcase.slice(showcase.indexOf('id="card-coexist"'), showcase.indexOf('id="card-cost"'));
  assert.match(coexist, /source control and work management stay exactly where they are/i,
    'the adoption slide no longer makes the coexistence point generically');
});

test('the closing counts have a visible antecedent on the pulse slide', () => {
  // The close says its counts are "a different measure from the opening
  // percentages". Those percentages must therefore be shown at the opening.
  const pulse = showcase.slice(showcase.indexOf('id="card-pulse"'), showcase.indexOf('id="card-limits"'));
  assert.match(pulse, /SITE-NORTH/, 'the pulse slide does not name the synthetic pair');
  assert.match(pulse, /SKU-1001/, 'the pulse slide does not name the synthetic SKU');
  assert.match(pulse, /23%/, 'the pulse slide does not show the opening rate');
  assert.match(pulse, /78%/, 'the pulse slide does not show the closing rate');
  assert.match(pulse, /a different measure/i, 'the pulse slide does not warn that the closing counts differ in kind');

  const close = showcase.slice(showcase.indexOf('id="card-close"'), showcase.indexOf('id="card-followup"'));
  assert.match(close, /different measure from the opening percentages/i,
    'the close no longer names the measure it is not comparable with');
  for (const n of ['32', '25', '7']) {
    assert.ok(close.includes(n), `the close drops the count ${n}`);
  }

  // The percentages must be the ones the prepared signal actually carries.
  const signal = readJson('fixtures', 'prepared', '01-signal-issue.json');
  assert.match(signal.issue.title, /23% to 78%/, 'the prepared signal no longer states 23% to 78%');
  assert.match(signal.issue.body, /First third of window: 23% unavailable/);
  assert.match(signal.issue.body, /Last third of window: 78% unavailable/);
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
  assert.match(scene.title, /Change the agent, keep the contract/);
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
  assert.equal(intake.presenterTitle, 'Prepared — Issue triage');
  assert.ok(!/Live — Issue (intake|triage)/.test(presenter), 'the presenter guide still calls triage live');
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
  const card = showcase.slice(showcase.indexOf('id="card-primitives"'), showcase.indexOf('id="card-counts"'));
  assert.match(card, /native/i);
  assert.match(card, /integrated/i);
  assert.match(card, /custom/i);
  assert.equal(shape.concerns.length, 9);
  for (const doc of [showcase, presenter]) {
    assert.ok(!/\b(source control|work management) is (worse|inferior|bad)\b/i.test(doc));
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

test('the triage lane is prepared, hard-bounded at three minutes, and still discloses the engine', () => {
  const intake = scenes.find((s) => s.id === 'intake');
  assert.equal(intake.end - intake.start, 3);
  assert.equal(intake.mode, 'prepared');
  const start = presenter.indexOf('id="card-scene-intake"');
  const card = presenter.slice(start, start + 4200);
  assert.match(card, /Prepared \u2014 Issue triage/, 'the triage heading must not read Live');
  assert.ok(!/\bLive\b/.test(card.slice(0, card.indexOf('card-body'))), 'the triage title claims a live lane');
  assert.match(card, /Three minutes, hard/);
  assert.match(card, /experimental sample engine that upstream has since removed/i,
    'the presenter card no longer discloses which engine produced the prepared output');

  // The projected slide leads with triage, not with engine history.
  const slide = showcase.slice(showcase.indexOf('id="card-intake"'), showcase.indexOf('id="card-opencode-status"'));
  for (const heading of ['Classification', 'Duplicate check', 'Feasibility', 'Missing decisions', 'Safe next action']) {
    assert.ok(slide.includes(heading), `the triage slide omits "${heading}"`);
  }
  assert.ok(!/ADR-50145|OpenCode/.test(slide),
    'engine-removal history is back on the projected slide instead of in reader depth');
  assert.match(readText('docs', 'showcase.html'), /ADR-50145/,
    'the engine-removal history was dropped from the article entirely');
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

test('the nine primitives are paired to the nine concerns and reach the article', () => {
  assert.equal(shape.concerns.length, 9);
  for (const concern of shape.concerns) {
    assert.ok(concern.primitive && concern.primitive.length > 20,
      `the "${concern.name}" concern has no primitive worth stating`);
    assert.ok(showcase.includes(concern.primitive.charAt(0).toLowerCase() + concern.primitive.slice(1))
      || showcase.includes(concern.primitive),
      `the primitive for "${concern.name}" is not rendered anywhere in the article`);
  }
  const card = showcase.slice(showcase.indexOf('id="card-thesis"'), showcase.indexOf('id="card-graph-questions"'));
  for (const concern of CONCERN_NAMES) {
    assert.ok(card.includes(`>${concern}</text>`),
      `the thesis diagram does not carry the ${concern} concern`);
  }
});

test('the pulse slide shows the bounded control contract, not only the pipeline', () => {
  const card = showcase.slice(showcase.indexOf('id="card-pulse"'), showcase.indexOf('id="card-limits"'));
  for (const token of ['permissions:', 'timeout-minutes', 'max-turns', 'max-ai-credits', 'safe-outputs']) {
    assert.ok(card.includes(token), `the pulse slide does not show ${token}`);
  }
});

test('the contract scene shows the artefact chain, and names Spec Kit with a first-party source', () => {
  const slide = showcase.slice(showcase.indexOf('id="card-refine"'), showcase.indexOf('id="card-acceptance"'));
  const chain = [...slide.matchAll(/<span class="seq-title">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(chain, ['Product brief', 'Issue', 'Decision record', 'Specification', 'Tests'],
    'the contract slide does not render the artefact chain from brief to tests');
  assert.match(slide, /An issue on its own is not the contract/i,
    'the contract slide does not say that an issue alone is not the contract');
  assert.match(slide, /https:\/\/github\.com\/github\/spec-kit/,
    'the contract slide does not link Spec Kit');

  const card = showcase.slice(showcase.indexOf('id="card-spec-kit"'), showcase.indexOf('id="card-loop-patterns"'));
  assert.match(card, /https:\/\/github\.github\.io\/spec-kit\//, 'the Spec Kit card omits the documentation link');
  assert.match(card, /first-party/i, 'the Spec Kit card does not say it is first-party GitHub tooling');
  assert.match(card, /does not discover intent for you/i,
    'the Spec Kit card does not state that it cannot discover intent');
  assert.match(card, /does not close the production feedback edge/i,
    'the Spec Kit card does not state that it cannot close the feedback edge');
  assert.match(readText('ATTRIBUTION.md'), /github\/spec-kit/, 'ATTRIBUTION.md does not record the Spec Kit source');
});

test('the emerging loop patterns are labelled community, dated, and never claimed for GitHub', () => {
  const card = showcase.slice(showcase.indexOf('id="card-loop-patterns"'), showcase.indexOf('<!-- SCENE 5 -->'));
  assert.ok(card, 'the loop-patterns card is missing');
  for (const pattern of ['Loop engineering', 'The intent loop', 'The gauntlet loop', 'Spec-driven development']) {
    assert.ok(card.includes(pattern), `the loop-patterns card omits "${pattern}"`);
  }
  assert.match(card, /community or emerging pattern/i,
    'the loop-patterns card does not label the patterns as community or emerging');
  assert.match(card, /none is a GitHub or Microsoft product/i,
    'the loop-patterns card does not deny that these are products');
  assert.match(card, /None of these came from GitHub/i,
    'the loop-patterns card does not deny GitHub provenance in its source note');
  assert.match(card, /read 2026-08-24/i, 'the loop-patterns sources are undated');

  // Every claim carries a public source, and the depth stays behind a reveal.
  for (const url of [
    'https://www.ibm.com/think/topics/loop-engineering',
    'https://github.com/cobusgreyling/loop-engineering',
    'https://github.com/theparlor/intent',
    'https://github.com/robonuggets/gauntlet-loop'
  ]) {
    assert.ok(card.includes(url), `the loop-patterns card does not cite ${url}`);
    assert.ok(readText('ATTRIBUTION.md').includes(url), `ATTRIBUTION.md does not record ${url}`);
  }
  assert.match(card, /<div class="reveal">/, 'the pattern definitions are not behind a reveal');

  // And the card is depth, never a slide: it must not appear in the slide list.
  assert.ok(!slides.some((s) => s.id === 'card-loop-patterns'),
    'the loop-patterns card became a slide, which is a product tour by another name');
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

test('the pulse scene leads with the entry-point claim, everywhere it is named', () => {
  const pulse = scenes.find((s) => s.id === 'pulse');
  assert.match(pulse.title, /Work can enter from anywhere; make the next step durable\./,
    'the pulse title no longer leads with the entry-point claim');
  for (const [name, doc] of [['presenter', presenter], ['mission control', mission]]) {
    assert.ok(doc.includes(pulse.title), `${name} does not carry the canonical pulse title`);
  }
  // The numbers are supporting evidence and must not open the slide.
  const card = showcase.slice(showcase.indexOf('id="card-pulse"'), showcase.indexOf('id="card-limits"'));
  const body = card.slice(card.indexOf('card-body'));
  assert.ok(body.indexOf('Telemetry') < body.indexOf('SITE-NORTH'),
    'the pulse slide still leads with the synthetic identifiers rather than with the entry points');
});

test('the pulse scene states the product stage and the pinned compiler version', () => {
  const card = showcase.slice(showcase.indexOf('id="card-pulse"'), showcase.indexOf('id="card-limits"'));
  assert.match(card, /public preview/i, 'the pulse slide does not state the product stage');
  assert.match(card, /v0\.86\.2/, 'the pulse slide does not state the pinned compiler version');
  assert.match(card, /ordinary committed Actions YAML/i,
    'the pulse slide does not say the compiled lock is ordinary Actions YAML');
});

test('the thesis scene makes the coexistence point generically and offers three verdicts', () => {
  const card = showcase.slice(showcase.indexOf('id="card-thesis"'), showcase.indexOf('id="card-graph-questions"'));
  for (const verdict of ['native', 'integrated', 'custom']) {
    assert.match(card, new RegExp(`<strong>${verdict}</strong>`),
      `the thesis slide does not offer "${verdict}" as one of the three verdicts`);
  }
  assert.match(card, /nothing on this slide asks you to move a repository/i,
    'the thesis slide no longer reassures the room that nothing has to move');
  const primitives = showcase.slice(showcase.indexOf('id="card-primitives"'), showcase.indexOf('id="card-counts"'));
  assert.match(primitives, /Existing source control and work management can stay where they are/i,
    'the coexistence depth card lost its generic phrasing');
});

test('the commercial argument is stated as a cost to measure, never as a return', () => {
  // The thesis names where the platform cost actually sits, and the adoption
  // slide says the pilot measures that cost. Neither invents a number, and no
  // document may assert a return on investment it cannot evidence.
  const thesis = showcase.slice(showcase.indexOf('id="card-thesis"'), showcase.indexOf('id="card-graph-questions"'));
  assert.match(thesis, /maintained bridges behind the custom ones are the platform cost/i,
    'the thesis slide does not name where the platform cost sits');

  const coexist = showcase.slice(showcase.indexOf('id="card-coexist"'), showcase.indexOf('id="card-cost"'));
  assert.match(coexist, /pilot measures/i, 'the adoption slide does not say what the pilot measures');
  assert.match(coexist, /costs your team to keep the bridges/i,
    'the adoption slide does not tie the pilot to the cost the thesis named');

  for (const [name, doc] of [['showcase', showcase], ['presenter', presenter], ['mission control', mission]]) {
    assert.ok(!/\bROI\b|return on investment/i.test(doc), `${name} asserts a return on investment`);
    assert.ok(!/\b\d+\s*(%|per ?cent)\s*(faster|cheaper|saving|reduction)/i.test(doc),
      `${name} quotes an invented efficiency number`);
    assert.ok(!/pays for itself|payback period/i.test(doc), `${name} promises a payback it cannot evidence`);
  }
});

test('the takeaway carries the pilot ask in one line', () => {
  const takeaway = showcase.slice(showcase.indexOf('class="takeaway"'), showcase.indexOf('class="takeaway"') + 700);
  assert.match(takeaway, /one low-risk repository/i);
  assert.match(takeaway, /two weeks/i);
  assert.match(takeaway, /five evidence artefacts/i);
  assert.match(takeaway, /day 14/i);
});

test('the closing slide has an authored id and gives the ask its own emphasis', () => {
  // Without an authored id the runtime invents "slide-15", which cannot be deep
  // linked from the presenter guide and changes if a slide is ever inserted.
  assert.match(showcase, /<p class="takeaway" id="card-takeaway">/,
    'the takeaway has no authored id');
  assert.ok(!/id="slide-\d+"/.test(showcase), 'a slide is relying on a generated id');

  const takeaway = showcase.slice(showcase.indexOf('class="takeaway"'), showcase.indexOf('</p>', showcase.indexOf('class="takeaway"')));
  const emphasised = takeaway.match(/<strong>([^<]+)<\/strong>/);
  assert.ok(emphasised, 'the ask is not visually distinguished from the sentence before it');
  assert.match(emphasised[1], /^The ask:/, 'the emphasised line is not the ask');
  assert.match(emphasised[1], /day 14/, 'the emphasised ask does not carry the decision point');
  assert.equal(emphasised[1].split('. ').length, 1, 'the ask is not one line');

  // The stylesheet that makes it prominent must be the repository's own layer,
  // never a per-document override of the vendored runtime.
  const overlay = readText('docs', 'assets', 'slide-a11y.css');
  assert.match(overlay, /\.takeaway\[data-slide-current\] strong/,
    'nothing gives the ask its own weight on the closing slide');
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

test('the rendered capability stage is the stage the fixture declares', () => {
  // The stage word is the claim. Rendering "Preview" where the fixture says
  // "Private preview" would be a product-accuracy defect, so bind the two.
  const matrix = readJson('fixtures', 'prepared', '09-adoption-matrix.json');
  const rendered = new Map(
    [...showcase.matchAll(/<span class="detail-key">([^<]+)<\/span><span class="detail-val"><strong>([^<]+?)\.?<\/strong>/g)]
      .map((m) => [m[1], m[2]])
  );
  for (const row of matrix.capabilityMatrix) {
    if (!rendered.has(row.capability)) continue;
    assert.equal(rendered.get(row.capability), row.state,
      `"${row.capability}" renders stage "${rendered.get(row.capability)}" but the fixture declares "${row.state}"`);
  }
  const mdash = matrix.capabilityMatrix.find((r) => /MDASH/.test(r.capability));
  assert.equal(mdash.state, 'Private preview', 'MDASH must name its stage exactly, never a bare "Preview"');
  assert.equal(readJson('fixtures', 'prepared', '06-pr-evidence.json').mdash.stage, 'private preview');
  for (const doc of [showcase, mission, presenter]) {
    assert.ok(!/MDASH[^.<]{0,120}\bin preview\b/i.test(doc), 'a document still calls MDASH generically "in preview"');
  }
});

test('the purpose-built surface is described as a category, with Copilot as the example', () => {
  const card = showcase.slice(showcase.indexOf('id="card-lanes"'), showcase.indexOf('id="card-hosted"'));
  assert.match(card, /purpose-built agent application/i, 'the tile names a product instead of a category');
  assert.match(card, /Copilot app is the example/i, 'the tile does not name the demonstrated example');
});

/**
 * Advance widths of the nine hero labels, measured in Chromium at the authored
 * 32px in the document's own font stack (Segoe UI Semibold on Windows) on
 * 2026-08-24. They are recorded rather than estimated because a per-character
 * guess cannot tell "Implementation" from "Lane". Change a label and this table
 * must be re-measured; the test fails on an unknown label rather than guessing.
 */
const HERO_LABEL_WIDTHS = {
  Signal: 88.8, Intent: 86.8, Contract: 124.3, Lane: 68.0, Implementation: 232.2,
  Evidence: 128.1, Authority: 137.5, Release: 108.8, Production: 160.3
};

test('every hero concern label fits inside its own box, and the feedback lanes never cross', () => {
  const svg = showcase.match(/<svg viewBox="0 0 1600 \d+"[\s\S]*?<\/svg>/)?.[0];
  assert.ok(svg, 'the engineering-graph diagram is missing');

  const labelSize = Number(svg.match(/\.t\s*\{[^}]*font-size:\s*(\d+)px/)[1]);

  const rects = [...svg.matchAll(/<rect class="b[a]?" x="(\d+)" y="(\d+)" width="(\d+)"/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]) }));
  const labels = [...svg.matchAll(/<text class="t" x="(\d+)" y="(\d+)" text-anchor="middle">([^<]+)</g)]
    .map((m) => ({ cx: Number(m[1]), baseline: Number(m[2]), text: m[3] }));

  assert.equal(rects.length, 9, 'expected nine concern boxes');
  assert.equal(labels.length, 9, 'expected nine concern labels');
  assert.deepEqual(labels.map((l) => l.text), CONCERN_NAMES, 'the boxes do not carry the canonical concerns');
  assert.equal(new Set(rects.map((r) => r.y)).size, 1, 'the concern row is not on one baseline');

  let previousEnd = 0;
  labels.forEach((label, i) => {
    const box = rects[i];
    assert.ok(box.x > previousEnd, `the ${label.text} box overlaps the one before it`);
    previousEnd = box.x + box.w;

    assert.equal(label.cx, box.x + box.w / 2, `the ${label.text} label is not centred in its box`);

    const width = HERO_LABEL_WIDTHS[label.text];
    assert.ok(width !== undefined,
      `no measured width for the label "${label.text}"; re-measure the diagram in a browser and update HERO_LABEL_WIDTHS`);
    const rendered = width * (labelSize / 32);
    assert.ok(box.w - rendered >= 24,
      `"${label.text}" renders about ${rendered.toFixed(0)}px inside a ${box.w}px box, leaving under 12px either side`);
  });

  // Entry arrows come down into the top of the row, happy-path arrows run along
  // its middle, and feedback arrows come up into the bottom. Nothing floats.
  const rowTop = rects[0].y;
  const rowMiddle = rowTop + 31;
  const rowBottom = rowTop + 62;
  for (const [, y] of svg.matchAll(/<polygon class="h" points="\d+,(\d+) /g)) {
    assert.ok([rowTop, rowMiddle].includes(Number(y)),
      `an arrowhead at y=${y} lands on neither the top nor the middle of the concern row`);
  }
  for (const [, y] of svg.matchAll(/<polygon class="ha" points="\d+,(\d+) /g)) {
    assert.equal(Number(y), rowBottom, 'a feedback arrowhead does not land on the bottom of the concern row');
  }

  // The three feedback lanes are nested so that no line crosses another: each
  // lane further from the row must reach further left than the one above it.
  const lanes = [...svg.matchAll(/class="la" d="M(\d+) \d+ V(\d+) H(\d+) V\d+"/g)]
    .map((m) => ({ from: Number(m[1]), depth: Number(m[2]), leftmost: Number(m[3]) }));
  assert.equal(lanes.length, 3, 'expected exactly three feedback lanes');
  for (let i = 1; i < lanes.length; i++) {
    assert.ok(lanes[i].depth > lanes[i - 1].depth, 'the feedback lanes share a depth and would overlap');
    assert.ok(lanes[i].leftmost < lanes[i - 1].leftmost,
      'a deeper feedback lane stops short of a shallower one, so their stubs cross');
  }

  // Every stub that rises out of a lane must start left of the lane above it,
  // which is what keeps the whole diagram crossing-free.
  const stubs = [...svg.matchAll(/class="la" d="M(\d+) (\d+) V\d+"/g)]
    .map((m) => ({ x: Number(m[1]), depth: Number(m[2]) }));
  assert.equal(stubs.length, 3, 'expected one extra stub per feedback lane');
  for (const stub of stubs) {
    for (const lane of lanes) {
      if (lane.depth >= stub.depth) continue;
      assert.ok(stub.x < lane.leftmost,
        `a stub at x=${stub.x} crosses the lane at depth ${lane.depth}, which reaches x=${lane.leftmost}`);
    }
  }

  const viewBoxHeight = Number(svg.match(/viewBox="0 0 1600 (\d+)"/)[1]);
  const deepest = Math.max(...lanes.map((l) => l.depth));
  assert.ok(deepest < viewBoxHeight, 'a feedback lane falls outside the viewBox');
  const captions = [...svg.matchAll(/<text class="l" x="\d+" y="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(captions.length, 3, 'each feedback lane needs its own caption');
  for (const y of captions) {
    assert.ok(y + 9 < viewBoxHeight, `a lane caption reaches y=${y + 9}, outside the ${viewBoxHeight}px viewBox`);
  }
});

test('inline diagram text is large enough to read from the back of a room', () => {
  // The fit zoom scales the whole slide, so a diagram that is too tall shrinks
  // its own text. The hero diagram was measured in Chromium at 1280x720 on
  // 2026-08-24: its 1600-wide viewBox renders 1064px across. Take that as the
  // calibration constant so this static check agrees with what the browser
  // reports rather than guessing at the zoom twice.
  const RENDERED_WIDTH = 1064;
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

// --- Round 5: the cover, the presenting layer, and the preparation contract ---

test('the first divider is a cover, and it costs no extra slide', () => {
  // The cover is the document header, shown on the first divider slide. Nothing
  // is duplicated into the markup and nothing is hidden from a reader, so the
  // article and the deck cannot drift apart.
  assert.equal(slides.length, 15, 'the cover changed the slide budget');
  assert.equal(slides[0].kind, 'chapter');
  assert.equal(slides[0].id, 'ch-intent');

  const header = showcase.slice(showcase.indexOf('<header class="doc-header">'), showcase.indexOf('</header>'));
  assert.match(header, /<h1>GitHub Beyond Coding<\/h1>/, 'the cover title is not the document h1');
  const subtitles = [...header.matchAll(/<p class="subtitle">([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  assert.equal(subtitles.length, 2, 'the cover needs a subtitle and a thesis, and no more');
  assert.equal(subtitles[0], 'The Agentic Engineering Loop');
  assert.match(subtitles[1], /nine-concern engineering graph shown in eleven demo scenes/,
    'the cover thesis drops the canonical sentence');
  assert.match(subtitles[1], /business case/i, 'the cover thesis is not a business thesis');

  // Presented by the repository's own layer, guarded so an old browser falls
  // back to the plain divider rather than to a blank slide.
  const overlay = readText('docs', 'assets', 'slide-a11y.css');
  const guarded = [...overlay.matchAll(/^\[data-view="slides"\][^{]*\{/gm)].map((m) => m[0]);
  const coverRules = guarded.filter((s) => s.includes('#ch-intent'));
  assert.ok(coverRules.length >= 2, 'the cover is not implemented in the shared overlay');
  for (const rule of coverRules) {
    assert.match(rule, /:has\(#ch-intent\[data-slide-current\]\)/,
      `a cover rule is not guarded by :has(), so it would leave slide 1 blank without it: ${rule}`);
  }

  // The presenter guide must describe slide 1 as the cover.
  assert.match(presenter, /The first divider is the cover/, 'the crosswalk still calls slide 1 a section name');
});

test('the cover dateline uses a token that clears the body-text contrast floor', () => {
  // The cover is the one slide the room reads before anyone is listening, and
  // article.css puts its dateline on the faintest token on the page. The fix is
  // to choose a different EXISTING token, never to define or restate a colour:
  // the palette is fixed and the runtime owns it.
  const overlay = readText('docs', 'assets', 'slide-a11y.css');
  const rule = overlay.match(
    /\[data-view="slides"\] \.doc:has\(#ch-intent\[data-slide-current\]\) \.doc-header \.meta \{\s*color:\s*([^;]+);\s*\}/
  );
  assert.ok(rule, 'the cover dateline does not override its colour');
  assert.equal(rule[1].trim(), 'var(--text-muted)',
    'the cover dateline uses something other than the --text-muted token');

  // No colour literal and no token definition may appear anywhere in our layer.
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(overlay),
    'the overlay states a colour literal instead of using a token');
  assert.ok(!/^\s*--[a-z-]+\s*:/m.test(overlay),
    'the overlay defines a design token, which belongs to the runtime');

  // And the rationale is recorded where the next person will read it.
  const comment = overlay.slice(Math.max(0, overlay.indexOf('The cover\'s dateline') - 8), overlay.indexOf('.doc-header .meta {\n  color'));
  assert.match(comment, /WCAG/, 'the override records no accessibility rationale');
  assert.match(comment, /4\.5:1/, 'the rationale does not name the ratio it is clearing');
  assert.match(comment, /--text-faint/, 'the rationale does not say which token it is replacing');
});

test('the presented type scale is proportional and lives in the repository layer', () => {
  const overlay = readText('docs', 'assets', 'slide-a11y.css');
  const article = readText('docs', 'assets', 'article.css');

  // The vendored runtime is untouched: the overlay is the only place presented
  // sizes change, and no document carries its own override.
  assert.ok(!/data-slide-current[^{]*\{[^}]*clamp\([^)]*vh/.test(article),
    'the vendored runtime was edited instead of the overlay');
  for (const doc of ['docs/showcase.html', 'docs/presenter.html', 'docs/mission-control.html', 'docs/index.html']) {
    const head = readText(doc).split('</head>')[0];
    assert.ok(!/data-view="slides"/.test(head.replace(/d\.setAttribute\("data-view", "slides"\);/, '')),
      `${doc} carries a per-document slides override instead of using the shared layer`);
    assert.match(readText(doc), /assets\/slide-a11y\.css/, `${doc} does not load the shared overlay`);
  }

  // Every presented size is a clamp whose floor is the vendored rem value, so
  // 720p is unchanged and only the larger viewport grows.
  const rules = [...overlay.matchAll(/\[data-view="slides"\] \.card\[data-slide-current\][^{]*\{\s*font-size:\s*([^;]+);/g)]
    .map((m) => m[1].trim());
  assert.ok(rules.length >= 6, 'the type scale covers too few elements to be a scale');
  for (const value of rules) {
    assert.match(value, /^clamp\(\s*[\d.]+rem,\s*[\d.]+vh,\s*[\d.]+rem\s*\)$/,
      `a presented size is not a viewport-proportional clamp: ${value}`);
  }
});

test('the presenter guide states what the repository cannot create for you', () => {
  assert.match(presenter, /id="card-remote-evidence"/, 'the preparation chapter has no remote-evidence card');
  const card = presenter.slice(presenter.indexOf('id="card-remote-evidence"'), presenter.indexOf('id="card-t30"'));

  // What is always available, and what is not.
  assert.match(card, /Always available/, 'the card does not say what always works without a remote');
  assert.match(card, /prepared artefact/i, 'the card does not name the prepared artefacts');
  assert.match(card, /--repo OWNER\/REPO/, 'the card does not give the exact target placeholder');
  assert.match(card, /--apply/, 'the card does not say that writing needs an explicit flag');

  // The honest gap: seeding creates the issue, and nothing here creates the rest.
  assert.match(card, /nothing here creates them|no script in this repository does/i,
    'the card claims a seeding process for evidence that no script produces');
  assert.match(card, /installs <strong>no workflow<\/strong>/i,
    'the card does not say that seeding installs no workflow');
  assert.match(card, /fork or copy of this repository that you own/i,
    'the card does not state where the live pulse can actually run');
  assert.match(card, /Actions enabled and Copilot AI credits and policy/i,
    'the card does not state what the live pulse needs beyond a repository');
  assert.match(card, /<strong>optional<\/strong>/, 'the card does not mark the live remote tabs optional');
  for (const tab of ['2', '3', '5', '6', '7']) {
    assert.ok(card.includes(tab), `the card does not name tab ${tab}`);
  }

  // The tab list agrees, and so does the go/no-go condition that depends on it.
  const tabs = presenter.slice(presenter.indexOf('id="card-tabs"'), presenter.indexOf('id="card-crosswalk"'));
  assert.equal((tabs.match(/optional until/gi) || []).length, 5,
    'the tab list does not mark exactly the five remote tabs optional');
  assert.match(tabs, /2 — Actions<\/h4><p>[^<]*optional until/i,
    'the tab list does not mark the Actions tab optional');

  const gono = presenter.slice(presenter.indexOf('id="card-gono"'), presenter.indexOf('id="card-gono"') + 2600);
  assert.match(gono, /Tabs 2, 3, 5, 6 and 7/, 'the go/no-go condition does not name the tabs that need a live remote');
  assert.match(gono, /fork or copy you own/i, 'the go/no-go condition does not state the prerequisite');
  assert.match(gono, /Condition 4 failing costs the live path only/i,
    'the go/no-go card no longer says the live tabs are the soft condition');
});

test('the T-24 sequence installs the pinned toolchain before it validates with it', () => {
  const card = presenter.slice(presenter.indexOf('id="card-t24"'), presenter.indexOf('id="card-remote-evidence"'));
  const order = ['npm run setup', 'npm run preflight', 'npm test', 'npm run verify',
    'npm run aw:install', 'npm run validate:aw', 'npm run rehearse'];
  let cursor = -1;
  for (const command of order) {
    const at = card.indexOf(command);
    assert.ok(at > cursor, `${command} is missing from the T-24 block, or out of order`);
    cursor = at;
  }
  assert.match(card, /Seven commands/, 'the card still promises a different number of commands');

  // The slide walk, and what makes it a no-go.
  assert.match(card, /DevTools/, 'the T-24 card no longer says to open DevTools');
  assert.match(card, /Console tab/, 'the T-24 card no longer names the console');
  assert.match(card, /<strong>no-go<\/strong>/, 'a console warning is no longer stated as a no-go');

  // The enterprise profile rehearsal stays, and must not run verify after a
  // failed preflight: a preflight that is allowed to be ignored is decoration.
  assert.match(card, /SHOWCASE_PROFILE/, 'the enterprise profile commands were dropped');
  assert.match(card, /if \(\$LASTEXITCODE -eq 0\) \{ npm run verify \}/,
    'the PowerShell profile block runs verify even when preflight failed');
  assert.ok(!/npm run preflight; npm run verify/.test(card),
    'the PowerShell profile line still chains with a semicolon, which ignores the exit code');
  assert.match(card, /SHOWCASE_PROFILE=enterprise npm run preflight &amp;&amp;/,
    'the POSIX profile line no longer short-circuits on failure');
});

test('the offline fallback explains both directions of the presenting toggle', () => {
  const hint = mission.slice(mission.indexOf('<kbd>Escape</kbd>'), mission.indexOf('<kbd>Escape</kbd>') + 400);
  assert.match(hint, /returns you to this article view/, 'Escape is not described as returning to the article');
  assert.match(hint, /read as a list/, 'the article view is not described as the scene list');
  assert.match(hint, /<strong>Slides<\/strong>[^<]*button[\s\S]{0,80}resumes/,
    'the hint does not say the Slides button resumes presenting');
});

test('the deck runtime this repository never used is not vendored', () => {
  for (const gone of ['deck.css', 'deck.js', 'sample-diagram.svg']) {
    assert.ok(!exists('docs', 'assets', gone), `docs/assets/${gone} is unreferenced and should not be committed`);
  }
  for (const kept of ['article.css', 'article.js', 'validate.js', 'bundle.js', 'tokens.css']) {
    assert.ok(exists('docs', 'assets', kept), `docs/assets/${kept} is required and missing`);
  }
  const attribution = readText('ATTRIBUTION.md');
  assert.ok(!/`deck\.css`, `deck\.js`/.test(attribution.split('## Repository-owned')[0].replace(/standalone deck renderer[\s\S]*/, '')),
    'ATTRIBUTION.md still lists the removed files as vendored');
  assert.match(attribution, /not vendored/, 'ATTRIBUTION.md does not record why they are absent');
  assert.match(attribution, /slide-a11y\.css/, 'ATTRIBUTION.md does not claim the repository-owned overrides');
});

test('the slide budget rule names the document it applies to', () => {
  const rules = readText('AGENTS.md');
  const rule = rules.slice(rules.indexOf('Slides mode must produce'), rules.indexOf('## Remote operations'));
  assert.match(rule, /docs\/showcase\.html/, 'the slide budget rule does not name the deck it governs');
  assert.match(rule, /mission-control\.html/, 'the rule does not exempt the fallback surface');
  assert.match(rule, /scene fallback surface/, 'the rule does not say what mission control is instead');
  assert.ok(!/no slide budget applies to it[\s\S]*docs\/showcase\.html/.test(rule),
    'the exemption is stated before the rule it qualifies');
});

test('every command list that claims a count states the right one', () => {
  // Three documents publish the clean-checkout sequence. They must agree with
  // each other and with package.json, and none may promise a count it does not
  // list. A stale number here is the cheapest possible way to lose the room.
  const scripts = readJson('package.json').scripts;
  const expected = ['setup', 'preflight', 'test', 'verify', 'aw:install', 'validate:aw', 'rehearse'];
  for (const name of expected) {
    assert.ok(scripts[name], `package.json has no "${name}" script`);
  }
  const WORD = { 6: 'Six', 7: 'Seven', 8: 'Eight' };

  const index = readText('docs', 'index.html');
  for (const [doc, text, anchor] of [
    ['docs/index.html', index, 'id="card-index-commands"'],
    ['docs/presenter.html', presenter, 'id="card-t24"']
  ]) {
    const start = text.indexOf(anchor);
    assert.ok(start > -1, `${doc} has no command card`);
    const card = text.slice(start, start + 3000);
    const claimed = card.match(/\b(Six|Seven|Eight) commands\b/);
    assert.ok(claimed, `${doc} does not state how many commands it lists`);
    const listed = expected.filter((name) => card.includes(`npm run ${name}`) || (name === 'test' && card.includes('npm test')));
    assert.equal(claimed[1], WORD[listed.length],
      `${doc} promises "${claimed[1]} commands" but lists ${listed.length}`);
    for (const name of expected) {
      const command = name === 'test' ? 'npm test' : `npm run ${name}`;
      assert.ok(card.includes(command), `${doc} omits ${command}`);
    }
    assert.ok(card.indexOf('npm run aw:install') < card.indexOf('npm run validate:aw'),
      `${doc} validates with a compiler it has not pinned yet`);
  }

  const readme = readText('README.md');
  assert.ok(readme.indexOf('npm run aw:install') < readme.indexOf('npm run validate:aw'),
    'README.md validates with a compiler it has not pinned yet');
  assert.ok(!/gh-aw --pin v\d/.test(readme),
    'README.md hard-codes the pin as a command instead of pointing at the script');
});

// --- Round 6: lifecycle stages, the close, and the replayed payoff -----------

test('every scene declares which graph concern it puts on the screen', () => {
  for (const scene of scenes) {
    assert.ok(Array.isArray(scene.concerns), `${scene.id} declares no concerns array`);
    assert.ok(scene.concerns.length > 0 || scene.crossCutting,
      `${scene.id} claims no concern and is not marked cross-cutting`);
    for (const concern of scene.concerns) {
      assert.ok(CONCERN_NAMES.includes(concern), `${scene.id} claims "${concern}", which is not one of the nine`);
    }
    assert.ok(['demonstrates', 'frames', 'returns'].includes(scene.graphRole),
      `${scene.id} has an unknown graph role "${scene.graphRole}"`);
    assert.ok(scene.concernLabel, `${scene.id} has no concern label`);
    assert.ok(scene.question, `${scene.id} has no question`);
    assert.equal(scene.sceneMarker, `${scene.concernLabel} \u00b7 ${scene.question}`,
      `${scene.id} marker does not compose from its own parts`);
    assert.ok(!/\bStage \d\b/.test(scene.sceneMarker),
      `${scene.id} still numbers its concern as a lifecycle stage`);
  }
});

test('every one of the nine concerns is demonstrated by a scene that is not cross-cutting', () => {
  // Cross-cutting scenes frame the graph. If they counted, the opening diagram
  // alone would satisfy this and the check would prove nothing.
  const mapping = shape.concernMapping;
  assert.ok(mapping, 'the manifest declares no concern mapping');
  assert.equal(mapping.markerFormat, '<concernLabel> \u00b7 <question>');
  for (const concern of CONCERN_NAMES) {
    const claimed = mapping.demonstratedBy[concern];
    assert.ok(Array.isArray(claimed) && claimed.length > 0,
      `no scene demonstrates the "${concern}" concern`);
    for (const id of claimed) {
      const scene = scenes.find((s) => s.id === id);
      assert.ok(scene, `the mapping names "${id}", which is not a scene`);
      assert.ok(!scene.crossCutting, `"${concern}" is only claimed by the cross-cutting scene ${id}`);
      assert.ok(scene.concerns.includes(concern), `${id} does not actually claim "${concern}"`);
    }
  }
  // The mapping is derived, never hand-maintained: recompute and compare.
  const recomputed = Object.fromEntries(CONCERN_NAMES.map((concern) => [
    concern,
    scenes.filter((s) => !s.crossCutting && s.concerns.includes(concern)).map((s) => s.id)
  ]));
  assert.deepEqual(mapping.demonstratedBy, recomputed, 'the concern mapping has drifted from the scenes');
  assert.deepEqual(mapping.crossCuttingScenes, scenes.filter((s) => s.crossCutting).map((s) => s.id));
  assert.deepEqual(mapping.crossCuttingScenes, ['thesis', 'coexist', 'close'],
    'the set of scenes that only frame the story has changed');
});

test('the concern marker reaches both screens, identically', () => {
  for (const scene of scenes) {
    const start = showcase.indexOf(`id="${scene.card}"`);
    const head = showcase.slice(start, start + 1600);
    const sub = head.match(/<span class="card-sub">([^<]*)<\/span>/);
    assert.ok(sub, `${scene.card} has no subtitle`);
    const rendered = sub[1].replace(/&middot;/g, '\u00b7');
    assert.ok(rendered.startsWith(scene.sceneMarker),
      `${scene.card} subtitle starts "${rendered.slice(0, 60)}" but the manifest marker is "${scene.sceneMarker}"`);

    // The presenter crosswalk shows the same string, so a presenter reading the
    // second screen and the room reading the slide see one marker, not two.
    const marker = scene.sceneMarker.replace(/\u00b7/g, '&middot;');
    assert.ok(presenter.includes(marker),
      `the crosswalk does not carry the marker "${scene.sceneMarker}" for ${scene.id}`);
  }
  assert.equal(scenes.find((s) => s.id === 'delegate').concernLabel, 'Implementation');
  assert.equal(scenes.find((s) => s.id === 'pulse').concernLabel, 'Signal');
  assert.equal(scenes.find((s) => s.id === 'sre').concernLabel, 'Production');
});

test('the close remembers four things, and the graph card explains the plural edges', () => {
  const close = showcase.slice(showcase.indexOf('id="card-close"'), showcase.indexOf('id="card-followup"'));
  const labels = [...close.matchAll(/<span class="summary-label">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Why', 'What', 'Proof', 'Outcome'],
    'the close slide no longer remembers exactly why, what, proof and outcome');
  assert.match(close, /entered the graph again/i, 'the close does not say the residue re-entered the graph');

  const counts = showcase.slice(showcase.indexOf('id="card-counts"'), showcase.indexOf('<!-- SCENE 2 -->'));
  assert.match(counts, /may send work back to the contract or to the implementation/i,
    'the graph card does not state the Evidence feedback edge in full');
  assert.match(counts, /may raise a new signal, reshape intent, change what must remain true, or open a proposal/i,
    'the graph card does not state the Production feedback edge in full');
});

test('the closing payoff is recomputed from the telemetry, not restated', async () => {
  const { replayFollowUp, loadReplayInput, unmetRequests } = await import('../scripts/lib/followup.mjs');
  const input = loadReplayInput();
  const result = replayFollowUp(input);

  assert.equal(result.requestsReplayed, 32);
  assert.equal(result.answeredWithSubstitute, 25);
  assert.equal(result.unresolved, 7);
  assert.equal(result.answeredWithSubstitute + result.unresolved, result.requestsReplayed);

  // The requests are read from the telemetry the opening signal came from.
  const requests = unmetRequests(input);
  assert.equal(requests.length, 32);
  assert.ok(requests.every((r) => r.siteId === 'SITE-NORTH' && r.sku === 'SKU-1001'));
  assert.ok(requests.every((r) => r.outcome === 'unavailable'));
  assert.ok(!Array.isArray(input.replayWindow.requests),
    'the replay declares its own requests instead of reading them');

  // The article, the fallback and the artefact publish the same three numbers.
  const followup = readJson('fixtures', 'prepared', '10-followup.json');
  for (const [label, value] of [['Unmet requests in the window', 32], ['Now answered with an alternative', 25], ['Still answered with nothing', 7]]) {
    assert.ok(followup.followUpIssue.body.includes(`${label}: ${value} requests`),
      `the closing issue no longer states "${label}: ${value}"`);
    assert.ok(mission.includes(`${label}:`), `the offline fallback drops "${label}"`);
  }
  assert.ok(showcase.includes('<strong>32 unmet requests</strong>'));
  assert.ok(showcase.includes('<strong>25 are now answered</strong>'));
  assert.ok(showcase.includes('<strong>7 still are not</strong>'));
});

test('the replay is load-bearing: change the declared shelf and the numbers move', async () => {
  // A check that would pass whatever the inputs said would be decoration. Feed
  // the replay a different shelf and prove the outcome actually depends on it.
  const { replayFollowUp, loadReplayInput } = await import('../scripts/lib/followup.mjs');
  const input = loadReplayInput();

  const empty = replayFollowUp({ ...input, openingStock: { 'SKU-1002': 0, 'SKU-1003': 0, 'SKU-1004': 0 } });
  assert.equal(empty.answeredWithSubstitute, 0, 'an empty shelf still answered a request');
  assert.equal(empty.unresolved, 32);

  const plenty = replayFollowUp({ ...input, openingStock: { 'SKU-1002': 999, 'SKU-1003': 999, 'SKU-1004': 999 } });
  assert.equal(plenty.answeredWithSubstitute, 32, 'a full shelf still left a request unanswered');
  assert.equal(plenty.unresolved, 0);

  // And the withdrawn group member is excluded on status, not on stock: giving
  // it unlimited stock must change nothing.
  const withWithdrawn = replayFollowUp({
    ...input,
    openingStock: { ...input.openingStock, 'SKU-1005': 999 }
  });
  assert.equal(withWithdrawn.answeredWithSubstitute, 25,
    'stocking the withdrawn SKU changed the outcome, so status is not being enforced');
  assert.ok(!Object.keys(withWithdrawn.substitutesBySku).includes('SKU-1005'),
    'a withdrawn catalogue item was offered as a substitute');
});

test('the replayed window is never presented as a second production run', () => {
  const followup = readJson('fixtures', 'prepared', '10-followup.json');
  assert.match(followup.labelInUi, /replay/i, 'the closing artefact does not label itself a replay');
  assert.match(followup.labelInUi, /not a second production run/i,
    'the closing artefact does not deny being a second production run');
  assert.ok(followup.replay, 'the closing artefact records no replay provenance');
  assert.match(followup.replay.recomputedBy, /--only followup/, 'the artefact does not say how to recompute it');
  assert.match(followup.replay.engine, /selectSubstitute/, 'the artefact does not name the engine that produced it');

  const input = readJson('fixtures', 'telemetry', 'post-change-stock.json');
  assert.equal(input.status, 'synthetic');
  assert.match(input.labelInUi, /not a second production run/i);

  // No document may claim the workflow ran a second time.
  for (const [name, doc] of [['showcase', showcase], ['presenter', presenter], ['mission control', mission]]) {
    assert.ok(!/same pulse workflow ran again/i.test(doc),
      `${name} claims a second production run of the pulse workflow`);
    assert.match(doc, /prepared replay/i, `${name} never says "prepared replay"`);
  }
  assert.match(presenter, /Say <strong>prepared replay<\/strong>/,
    'the presenter guide does not instruct the presenter to say it out loud');
});

test('the presenting accessibility layer covers the closing slide and names the cover', () => {
  // Two defects this pins down. The takeaway is a SIBLING of <main>, so an
  // observer scoped to <main> never saw the last slide and the live region kept
  // announcing slide 14 while slide 15 was on screen. And the cover hides its
  // chapter label, so announcing that label would name something not shown.
  const layer = readText('docs', 'assets', 'slide-a11y.js');

  assert.match(layer, /var scope = document\.querySelector\("\.doc"\) \|\| document\.body;/,
    'the layer does not establish a scope wider than <main>');
  assert.match(layer, /observer\.observe\(scope, \{/,
    'the mutation observer is not scoped widely enough to see the closing slide');
  assert.match(layer, /function currentSlide\(\) \{\s*return scope\.querySelector/,
    'the current slide is looked up inside <main>, which cannot find the takeaway');
  assert.ok(!/observer\.observe\(main,/.test(layer), 'the observer is still scoped to <main>');

  assert.match(layer, /function coverHeading\(node\)/, 'the layer has no cover-heading path');
  assert.match(layer, /function slideTitle\(node\) \{\s*var cover = coverHeading\(node\);/,
    'slideTitle does not prefer the cover heading when the cover is showing');
  assert.match(layer, /getComputedStyle\(header\)\.display !== "none"/,
    'the cover is detected by something other than the header actually being shown');

  // The takeaway must be outside <main> for that to matter, and it is: the
  // runtime appends it after the chapters. If that ever changes, this test
  // should be revisited rather than silently kept.
  const main = showcase.slice(showcase.indexOf('<main>'), showcase.indexOf('</main>'));
  assert.ok(!main.includes('class="takeaway"'),
    'the takeaway moved inside <main>; the scope comment in slide-a11y.js is now stale');
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
