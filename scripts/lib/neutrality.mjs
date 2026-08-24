// Structural neutrality checks for a public repository.
//
// The repository is kept customer-neutral by construction, not by carrying a
// list of real names. Two rules do the work:
//
//   1. No profile may hold a concrete organisation, tenant, subscription or
//      directory value. Those fields are null or a documented placeholder, and
//      the real target is supplied on the command line.
//   2. Attendee-facing documents may use only the proper nouns the
//      configuration allows, so an unrecognised name fails the build.
//
// A presenter who needs to screen for engagement-specific terms puts them in an
// untracked .showcase.local.json. That file is never committed and this module
// only reads it when it happens to exist. The screen never reads its own
// declaration back: .showcase.local.json and the committed
// .showcase.local.example.json that documents its shape are exempt, because a
// term list necessarily contains its own terms.

import { existsSync, readFileSync } from 'node:fs';
import { loadConfig, listProfiles, loadProfile, readText, repoPath } from './repo.mjs';

// Ordinary English words that legitimately appear capitalised after a colon, a
// dash or an opening quote. They are not proper nouns, so they do not belong in
// the allowlist, but they must not be reported either.
const SENTENCE_WORDS = new Set([
  'A', 'About', 'Accepted', 'Adding', 'After', 'All', 'An', 'And', 'Any', 'Are', 'As', 'At',
  'Back', 'Be', 'Both', 'But', 'By', 'Can', 'Check', 'Checks', 'Code', 'Copied', 'Could',
  'Do', 'Does', 'Done', 'Each', 'Eight', 'End', 'Every', 'Files', 'Five', 'For', 'From',
  'Given', 'Has', 'How', 'If', 'In', 'Is', 'It', 'Its', 'Keep', 'Leave', 'Migrate', 'Mirror',
  'Most', 'Never', 'Nine', 'No', 'Not', 'Nothing', 'Now', 'On', 'One', 'Only', 'Or', 'Other',
  'Pick', 'Product', 'Ran', 'Read', 'Repository', 'Runs', 'Said', 'Say', 'Seven', 'Show',
  'Since', 'So', 'Some', 'Source', 'Still', 'Stop', 'Take', 'Tab', 'Ten', 'That', 'The',
  'Their', 'Then', 'There', 'These', 'They', 'This', 'Those', 'Three', 'To', 'Two', 'Use',
  'Was', 'We', 'What', 'When', 'Where', 'Which', 'While', 'Who', 'Why', 'Will', 'With',
  'Would', 'Write', 'You', 'Your', 'Article', 'Activity', 'Experimental', 'Expected',
  'Prepared', 'Live', 'Static', 'Verdict', 'Rule', 'Note', 'Warning', 'Question', 'Phase',
  'Cut', 'Checkpoint', 'Contents', 'Intent', 'Proposal', 'Evidence', 'Policy',
  'Accountability', 'Release', 'Feedback', 'Signal', 'Contract', 'Lane', 'Implementation',
  'Authority', 'Production', 'Observation', 'Reveals', 'Slide', 'Say', 'Watch'
]);

/** Strip code, markup and entities so only attendee-visible prose remains. */
export function proseOf(text) {
  return text
    .replace(/<(script|style|svg|pre|code)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ');
}

/**
 * Proper-noun candidates in a document: capitalised tokens that are not at the
 * start of a sentence, so ordinary prose does not flood the result.
 */
export function properNounsIn(text) {
  const found = new Map();
  const re = /(?<=[a-z0-9,;:)"'\u2019\u2014-]\s)([A-Z\u00c0-\u00de][A-Za-z0-9.+\u00c0-\u024f-]{1,24})/g;
  let match;
  while ((match = re.exec(proseOf(text)))) {
    const word = match[1].replace(/[.,;:]+$/, '');
    if (word.length < 2) continue;
    if (SENTENCE_WORDS.has(word)) continue;
    found.set(word, (found.get(word) || 0) + 1);
  }
  return found;
}

/** Rule 2: every proper noun in attendee-facing prose must be allowlisted. */
export function unknownProperNouns() {
  const config = loadConfig();
  const allowed = new Set([
    ...config.neutrality.allowedProperNouns,
    ...(config.neutrality.sceneWords || [])
  ]);
  const offenders = [];
  for (const file of config.neutrality.proseFiles) {
    let text;
    try {
      text = readText(file);
    } catch {
      continue;
    }
    for (const [word] of properNounsIn(text)) {
      if (!allowed.has(word)) offenders.push(`${file}: "${word}"`);
    }
  }
  return offenders;
}

/** Rule 1: no profile may carry a concrete identity value. */
export function concreteIdentityValues() {
  const config = loadConfig();
  const fields = new Set(config.neutrality.identityFields);
  const placeholders = new Set(config.neutrality.placeholderValues);
  const offenders = [];

  const inspect = (node, path, profileId) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      // loadProfile merges the repository configuration in under _config. Those
      // are this public repository's own coordinates, documented in the config
      // file itself, and are not a profile target.
      if (key === '_config') continue;
      const here = path ? `${path}.${key}` : key;
      if (value && typeof value === 'object') {
        inspect(value, here, profileId);
        continue;
      }
      if (!fields.has(key)) continue;
      if (value === null) continue;
      if (typeof value === 'string' && placeholders.has(value)) continue;
      offenders.push(`${profileId}: ${here} = ${JSON.stringify(value)}`);
    }
  };

  for (const id of listProfiles()) inspect(loadProfile(id), '', `config/profiles/${id}.json`);
  return offenders;
}

/**
 * The two files that declare the screen rather than being screened by it: the
 * presenter's own untracked term list, and the committed example that documents
 * its shape. Screening either one would report the declaration as a finding, so
 * a correctly configured presenter would always see a failure.
 */
const LOCAL_OVERRIDES_EXAMPLE = '.showcase.local.example.json';

export function localScreenExemptions(config = loadConfig()) {
  return new Set([config.neutrality.localOverridesFile, LOCAL_OVERRIDES_EXAMPLE]);
}

/**
 * Optional local screen. Returns null when the presenter has no local file,
 * which is the normal state and never a failure.
 */
export function localScreen(files) {
  const config = loadConfig();
  const local = repoPath(config.neutrality.localOverridesFile);
  if (!existsSync(local)) return null;
  let terms;
  try {
    terms = JSON.parse(readFileSync(local, 'utf8')).forbiddenTerms || [];
  } catch {
    return { error: `${config.neutrality.localOverridesFile} is not readable JSON` };
  }
  const exempt = localScreenExemptions(config);
  const offenders = [];
  let scanned = 0;
  for (const rel of files) {
    if (exempt.has(rel)) continue;
    let content;
    try {
      content = readText(rel).toLowerCase();
    } catch {
      continue;
    }
    scanned++;
    for (const term of terms) {
      if (term && content.includes(String(term).toLowerCase())) offenders.push(`${rel}: a locally screened term`);
    }
  }
  return { terms: terms.length, scanned, offenders, exempt: [...exempt] };
}
