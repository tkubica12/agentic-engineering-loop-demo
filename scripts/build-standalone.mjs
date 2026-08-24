/* =========================================================================
   build-standalone.mjs

   Produces the single-file export of a presentable document and makes it
   truly self-contained for a recipient who only gets that one file.

   The vendored bundler (docs/assets/bundle.js) inlines every local asset
   (CSS, JS, images) but deliberately leaves links to *other documents* alone:
   they cannot be inlined, and on their own they resolve to nothing. This
   script runs that bundler unchanged, then rewrites every such remaining
   repo-relative link into a canonical absolute GitHub URL, so the export has
   no dangling local link left. It fails non-zero if any local link survives.

     node scripts/build-standalone.mjs [input.html] [output.html]

   Defaults: docs/showcase.html -> docs/showcase.standalone.html
   ========================================================================= */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { posix, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot, repoPath, relPath, repositoryConfig, githubBlobUrl, log } from './lib/repo.mjs';

/* Same classification the bundler uses: anything matching this is left as-is
   (already absolute, a page anchor, or a non-http scheme). Everything else in
   an href/src/poster is a local reference that must resolve to a real URL. */
const EXTERNAL = /^(?:data:|https?:|\/\/|#|mailto:|tel:)/i;
const ATTR = /\b(href|src|poster)=(["'])([^"']+)\2/gi;

const BUNDLER = repoPath('docs', 'assets', 'bundle.js');

function toRepoRelative(docDirPosix, ref) {
  /* Keep any ?query / #fragment so a deep link into a Markdown file survives. */
  const match = ref.match(/^([^?#]*)([?#].*)?$/);
  const pathPart = match[1];
  const suffix = match[2] || '';
  const joined = posix.normalize(posix.join(docDirPosix, pathPart));
  return { path: joined, suffix };
}

export function buildStandalone({ input, output } = {}) {
  // Accept either a repo-relative path or an already-absolute one, so callers
  // can build into the OS temp directory without colliding with `npm run reset`,
  // which deletes and recreates `out/`.
  const resolveIn = (p, ...fallback) => (p ? (isAbsolute(p) ? p : repoPath(p)) : repoPath(...fallback));
  const inputAbs = resolveIn(input, 'docs', 'showcase.html');
  const outputAbs = output
    ? resolveIn(output)
    : inputAbs.replace(/\.html$/i, '') + '.standalone.html';

  if (!existsSync(inputAbs)) {
    throw new Error(`no such document: ${relPath(inputAbs)}`);
  }

  const inputRel = relPath(inputAbs);
  const outputRel = relPath(outputAbs);
  const docDir = posix.dirname(inputRel); // e.g. "docs"

  /* 1. Run the vendored bundler unchanged. It writes the inlined file itself
        and exits non-zero if any *asset* could not be resolved. */
  const bundlerOut = execFileSync(
    process.execPath,
    [BUNDLER, inputRel, outputRel],
    { cwd: repoRoot, encoding: 'utf8' }
  );

  const repo = repositoryConfig();

  /* 2. Post-process: rewrite every remaining local document link to a blob URL
        (blob renders both Markdown and HTML sensibly for a human reader). */
  let html = readFileSync(outputAbs, 'utf8');
  const rewrites = [];
  const unresolved = [];

  html = html.replace(ATTR, (whole, attr, quote, ref) => {
    if (EXTERNAL.test(ref)) return whole;
    const { path: rel, suffix } = toRepoRelative(docDir, ref);
    if (!rel || rel.startsWith('..')) {
      /* Resolves outside the repository — cannot be turned into a canonical
         URL, so record it and let the assertion below fail the build. */
      unresolved.push(ref);
      return whole;
    }
    const url = githubBlobUrl(rel, repo) + suffix;
    rewrites.push({ from: ref, to: url });
    return `${attr}=${quote}${url}${quote}`;
  });

  /* 3. Assert nothing local survived the rewrite. */
  const remaining = new Set();
  for (const m of html.matchAll(ATTR)) {
    const ref = m[3];
    if (!EXTERNAL.test(ref)) remaining.add(ref);
  }
  for (const ref of unresolved) remaining.add(ref);

  if (remaining.size) {
    throw new Error(
      'standalone export still contains unresolved local link(s):\n  ' +
        Array.from(remaining).join('\n  ')
    );
  }

  /* 4. Attribution must stay reachable, not silently dropped. If the source
        linked ATTRIBUTION.md, the export must now carry an absolute form. */
  const linkedAttribution = rewrites.some((r) => /ATTRIBUTION\.md/i.test(r.from));
  if (linkedAttribution && !/https?:\/\/[^"']*ATTRIBUTION\.md/i.test(html)) {
    throw new Error('ATTRIBUTION.md link was lost during standalone rewrite');
  }

  writeFileSync(outputAbs, html);

  return { input: inputRel, output: outputRel, rewrites, bundlerOut };
}

function main() {
  const [input, output] = process.argv.slice(2);
  let result;
  try {
    result = buildStandalone({ input, output });
  } catch (err) {
    log.fail(err.message);
    process.exit(1);
  }

  process.stdout.write(result.bundlerOut.trimEnd() + '\n');

  const unique = [];
  const seen = new Set();
  for (const r of result.rewrites) {
    if (seen.has(r.from)) continue;
    seen.add(r.from);
    unique.push(r);
  }

  log.head(`rewrote ${unique.length} local link(s) to absolute GitHub URLs`);
  for (const r of unique) {
    console.log(`  ${r.from}  ->  ${r.to}`);
  }
  log.ok(`${result.output} has no dangling local links`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
