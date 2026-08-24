// Resolve the structured fallback entries in the scene manifest.
//
// Each scene.fallback is an array of objects:
//   { kind: "file" | "url" | "doc-scene" | "narrate", target: string, label: string }
//
//   file       target is a repo-relative path, optionally "path#anchor".
//              The file must exist; if an anchor is given it must appear in the
//              file as id="anchor" (or name="anchor").
//   doc-scene  target is a scene id that must appear in docs/mission-control.html
//              as data-scene="<id>".
//   url        target is an external URL. Shape is validated (must parse to
//              http/https); the network is never touched.
//   narrate    target is empty; the presenter speaks. Always resolvable.
//
// The code is defensive: if it still sees the old shape (a bare string, or an
// object missing kind/target/label) it returns a failed result with a clear
// message rather than throwing, so callers can report every bad entry at once.

import { existsSync, readFileSync } from 'node:fs';
import { repoPath, readText } from './repo.mjs';

export const FALLBACK_KINDS = ['file', 'url', 'doc-scene', 'narrate'];

// Parse docs/mission-control.html once and return the set of data-scene ids.
export function loadDocScenes() {
  const html = existsSync(repoPath('docs', 'mission-control.html'))
    ? readText('docs', 'mission-control.html')
    : '';
  const ids = new Set();
  for (const m of html.matchAll(/data-scene="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

// Build the context the resolvers need. Pass it in so a whole manifest is
// resolved against a single parse of mission-control.html.
export function fallbackContext() {
  return { docScenes: loadDocScenes() };
}

function fail(entry, message) {
  return { ok: false, kind: entry?.kind, target: entry?.target, label: entry?.label, message };
}

function pass(entry, detail) {
  return { ok: true, kind: entry.kind, target: entry.target, label: entry.label, detail };
}

function anchorPresent(text, anchor) {
  const safe = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(id|name)="${safe}"`).test(text) || new RegExp(`data-scene="${safe}"`).test(text);
}

// Resolve a single fallback entry against the context. Never throws.
export function resolveFallbackEntry(entry, ctx = fallbackContext()) {
  // Old shape: a bare string, from before the structured migration.
  if (typeof entry === 'string') {
    return fail(entry, `fallback is a bare string ("${entry}"); expected { kind, target, label }. The manifest still uses the old shape.`);
  }
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return fail(entry, `fallback entry is not an object; expected { kind, target, label }`);
  }
  const { kind, target, label } = entry;
  if (typeof kind !== 'string' || typeof label !== 'string' || typeof target !== 'string') {
    return fail(entry, `fallback entry must have string kind, target and label; got ${JSON.stringify(entry)}`);
  }
  if (!FALLBACK_KINDS.includes(kind)) {
    return fail(entry, `unknown fallback kind "${kind}"; valid kinds: ${FALLBACK_KINDS.join(', ')}`);
  }

  switch (kind) {
    case 'narrate':
      // The presenter speaks; nothing to resolve, but the label must say something.
      if (label.trim().length === 0) return fail(entry, 'narrate fallback has an empty label');
      return pass(entry, 'narration');

    case 'url': {
      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        return fail(entry, `url fallback target is not a valid URL: "${target}"`);
      }
      if (!/^https?:$/.test(parsed.protocol)) {
        return fail(entry, `url fallback must be http(s); got "${parsed.protocol}" in "${target}"`);
      }
      return pass(entry, `url ${parsed.href}`);
    }

    case 'doc-scene': {
      if (target.trim().length === 0) return fail(entry, 'doc-scene fallback has an empty target');
      if (!ctx.docScenes.has(target)) {
        return fail(entry, `doc-scene "${target}" is not present in docs/mission-control.html as data-scene="${target}"`);
      }
      return pass(entry, `doc-scene ${target}`);
    }

    case 'file': {
      if (target.trim().length === 0) return fail(entry, 'file fallback has an empty target');
      const [path, anchor] = target.split('#');
      if (!existsSync(repoPath(path))) {
        return fail(entry, `file fallback target does not exist: ${path}`);
      }
      if (anchor) {
        const text = readFileSync(repoPath(path), 'utf8');
        if (!anchorPresent(text, anchor)) {
          return fail(entry, `file fallback anchor "#${anchor}" not found in ${path}`);
        }
        return pass(entry, `file ${path}#${anchor}`);
      }
      return pass(entry, `file ${path}`);
    }

    default:
      return fail(entry, `unhandled fallback kind "${kind}"`);
  }
}

// Resolve every fallback entry of a scene. Never throws; returns one result per
// entry plus an `ok` for the whole set.
export function resolveFallbacks(fallbacks, ctx = fallbackContext()) {
  if (!Array.isArray(fallbacks) || fallbacks.length === 0) {
    return { ok: false, results: [], message: 'scene has no fallback entries' };
  }
  const results = fallbacks.map((entry) => resolveFallbackEntry(entry, ctx));
  return { ok: results.every((r) => r.ok), results };
}
